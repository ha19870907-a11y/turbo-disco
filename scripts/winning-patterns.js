#!/usr/bin/env node
'use strict';

// STEP4: 蓄積されたKPIデータ(thread-insights.json)から「勝ちパターン」を判定し、
// テンプレート選択(scheduler.js)に反映する重みを算出するスクリプト。
//
// 【設計方針】
// - STEP1(曜日・時間帯別ジャンル配分/weekly-schedule.json)、
//   STEP2(テンプレート・ジャンル×切り口の重複回避/scheduler.jsのpickTemplate)は
//   一切変更しない。スロットに投稿できるジャンル/カテゴリーの範囲はSTEP1のまま、
//   直近投稿との重複回避もSTEP2のまま行われた「候補プール」の中から、
//   どれを選びやすくするか(重み付け抽選)だけに介入する。
// - サンプル数が少ないジャンル/カテゴリーほど「勝ち」「負け」の判定を弱め(1.0に近づけ)、
//   偶然の外れ値(閲覧数の突出など)で極端な判定にならないようにする(縮小推定)。
// - 実測データ(views/engagementRate)のみを使い、架空の指標は作らない。

const fs = require('node:fs');
const path = require('node:path');

const INSIGHTS_FILE = path.join(__dirname, '..', 'thread-insights.json');
const OUTPUT_FILE = path.join(__dirname, 'pattern-weights.json');

const MIN_SAMPLE_FOR_LABEL = 3; // これ未満は「データ不足」として重み1.0固定
const SHRINKAGE_K = 8; // 縮小推定の強さ(サンプル数がこの値に近いほど縮小が効く)
const COMPONENT_CLAMP = [0.4, 2.5]; // views比・engagement比それぞれの外れ値クランプ
const SCORE_CLAMP = [0.5, 2.0]; // ジャンル/カテゴリー単体スコアのクランプ
const FINAL_WEIGHT_CLAMP = [0.4, 2.5]; // ジャンル×カテゴリーを掛け合わせた最終重みのクランプ

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function clamp(value, [min, max]) {
  return Math.min(max, Math.max(min, value));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// key(ジャンル名 or カテゴリー名)ごとに、全体平均比のスコアを縮小推定込みで算出する。
function computeGroupScores(records, keyFn, baseline) {
  const groups = new Map();
  for (const r of records) {
    const key = keyFn(r);
    if (!key || key === '不明') continue;
    const g = groups.get(key) ?? { n: 0, views: [], engRates: [] };
    g.n += 1;
    g.views.push(r.views ?? 0);
    if (r.engagementRate != null) g.engRates.push(r.engagementRate);
    groups.set(key, g);
  }

  const result = {};
  for (const [key, g] of groups) {
    const viewsRatio = clamp(median(g.views) / baseline.medianViews, COMPONENT_CLAMP);
    const engRatio =
      g.engRates.length > 0
        ? clamp(
            g.engRates.reduce((a, b) => a + b, 0) / g.engRates.length / baseline.meanEngagement,
            COMPONENT_CLAMP
          )
        : 1;
    const rawScore = 0.6 * viewsRatio + 0.4 * engRatio;

    // 縮小推定: サンプル数が少ないほど1.0(平均並み)に近づける。
    const shrinkFactor = g.n / (g.n + SHRINKAGE_K);
    const shrunkScore = 1 + (rawScore - 1) * shrinkFactor;

    result[key] = {
      n: g.n,
      medianViews: median(g.views),
      avgEngagementRate: g.engRates.length > 0 ? g.engRates.reduce((a, b) => a + b, 0) / g.engRates.length : null,
      score: Number(clamp(shrunkScore, SCORE_CLAMP).toFixed(3)),
      label: g.n < MIN_SAMPLE_FOR_LABEL ? 'データ不足' : classify(shrunkScore),
    };
  }
  return result;
}

function classify(score) {
  if (score >= 1.3) return '勝ちパターン';
  if (score <= 0.75) return '負けパターン';
  return '標準';
}

function buildWeights() {
  const insights = readJson(INSIGHTS_FILE, []);
  const valid = insights.filter((r) => r.genre && r.genre !== '不明');

  if (valid.length === 0) {
    throw new Error('thread-insights.jsonに有効なデータがありません。');
  }

  const baseline = {
    medianViews: median(valid.map((r) => r.views ?? 0)) || 1,
    meanEngagement:
      valid.filter((r) => r.engagementRate != null).reduce((a, r) => a + r.engagementRate, 0) /
        valid.filter((r) => r.engagementRate != null).length || 0.001,
  };

  const byGenre = computeGroupScores(valid, (r) => r.genre, baseline);
  const byCategory = computeGroupScores(valid, (r) => r.category, baseline);

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: valid.length,
    minSampleForLabel: MIN_SAMPLE_FOR_LABEL,
    baseline,
    byGenre,
    byCategory,
  };
}

// テンプレート(genre/category)に対応する最終重みを算出する。
// scheduler.jsのpickTemplateから呼ばれる想定。weightsファイルが無い/該当が無い場合は1.0(無補正)。
function getTemplateWeight(weights, template) {
  if (!weights) return 1;
  const genreScore = weights.byGenre?.[template.genre]?.score ?? 1;
  const categoryScore = weights.byCategory?.[template.category]?.score ?? 1;
  return clamp(genreScore * categoryScore, FINAL_WEIGHT_CLAMP);
}

function printReport(weights) {
  console.log(`\n=== STEP4 勝ちパターン判定（サンプル数: ${weights.sampleSize}件） ===`);
  console.log(`基準値: 閲覧数中央値=${weights.baseline.medianViews} / 平均エンゲージメント率=${(weights.baseline.meanEngagement * 100).toFixed(2)}%`);

  for (const [name, groups] of [
    ['ジャンル別', weights.byGenre],
    ['カテゴリー別', weights.byCategory],
  ]) {
    console.log(`\n--- ${name} ---`);
    const rows = Object.entries(groups).sort((a, b) => b[1].score - a[1].score);
    for (const [key, g] of rows) {
      const eng = g.avgEngagementRate != null ? `${(g.avgEngagementRate * 100).toFixed(2)}%` : 'N/A';
      console.log(
        `${key}\t件数:${g.n}\t閲覧中央値:${g.medianViews}\tエンゲージ:${eng}\t重み:${g.score}\t判定:${g.label}`
      );
    }
  }
}

function main() {
  const weights = buildWeights();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(weights, null, 2) + '\n', 'utf8');
  printReport(weights);
  console.log(`\npattern-weights.jsonを更新しました。`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { buildWeights, getTemplateWeight, classify };
