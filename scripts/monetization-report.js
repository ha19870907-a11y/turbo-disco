#!/usr/bin/env node
'use strict';

// STEP3.5: 投稿KPI(STEP3: thread-insights.json)と収益導線データ(monetization-data.json)、
// 投稿属性(thread-post-history.json: 曜日・時間帯)を紐付けて、
//   ・投稿ごとのCTR/CVR/売上等の指標
//   ・拡散型/集客型/収益型の簡易分類
//   ・各種ランキング(views/エンゲージメント/クリック/CV/売上)
//   ・ジャンル×カテゴリー×切り口×テンプレート×時間帯のクロス集計
// を算出するレポートスクリプト。
//
// 【重要】
// - このスクリプトは既存のthread-insights.json / thread-post-history.json /
//   thread-templates.json / weekly-schedule.json を一切書き換えない(読み取り専用)。
// - クリック数・コンバージョン数・売上はmonetization-data.jsonに記録された実績値のみを使う。
//   記録が無い投稿については「対象外(収益導線なし)」として扱い、0や推測値で埋めない。
// - 拡散型/集客型/収益型の分類としきい値は、現時点のデータ量に対する簡易ヒューリスティック
//   であり、固定の重み付けで「勝敗」を断定するものではない。STEP4でデータが蓄積された後に
//   見直すことを前提とした参考値として扱う。

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..');
const INSIGHTS_FILE = path.join(ROOT_DIR, 'thread-insights.json');
const POST_HISTORY_FILE = path.join(ROOT_DIR, 'thread-post-history.json');

const { readMonetizationData } = require('./monetization.js');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

// 投稿(postId)ごとに、KPI・属性・収益実績を1レコードにまとめる。
function buildCombinedRecords() {
  const insights = readJson(INSIGHTS_FILE, []);
  const postHistory = readJson(POST_HISTORY_FILE, []);
  const monetizationRecords = readMonetizationData();

  const historyByThreadId = new Map(postHistory.map((h) => [h.threadId, h]));

  const monetizationByPostId = new Map();
  for (const m of monetizationRecords) {
    const list = monetizationByPostId.get(m.postId) ?? [];
    list.push(m);
    monetizationByPostId.set(m.postId, list);
  }

  return insights.map((post) => {
    const history = historyByThreadId.get(post.id) ?? null;
    const monetization = monetizationByPostId.get(post.id) ?? [];

    const hasMonetization = monetization.length > 0;
    const clicks = hasMonetization ? monetization.reduce((sum, m) => sum + (m.clicks ?? 0), 0) : null;
    const conversions = hasMonetization ? monetization.reduce((sum, m) => sum + (m.conversions ?? 0), 0) : null;
    const revenue = hasMonetization ? monetization.reduce((sum, m) => sum + (m.revenue ?? 0), 0) : null;

    const engagement = post.likes + post.replies + post.reposts + post.quotes;
    const ctr = hasMonetization && post.views > 0 ? clicks / post.views : null;
    const cvr = hasMonetization && clicks > 0 ? conversions / clicks : hasMonetization ? 0 : null;
    const revenuePer1000Views = hasMonetization && post.views > 0 ? (revenue / post.views) * 1000 : null;
    const revenuePerClick = hasMonetization && clicks > 0 ? revenue / clicks : null;

    return {
      postId: post.id,
      templateId: post.templateId,
      genre: post.genre,
      category: post.category,
      angle: post.angle,
      dayKey: history?.dayKey ?? null,
      time: history?.time ?? null,
      label: history?.label ?? null,
      postedAt: post.postedAt,
      views: post.views,
      likes: post.likes,
      replies: post.replies,
      reposts: post.reposts,
      quotes: post.quotes,
      engagement,
      engagementRate: post.engagementRate,
      // Threads APIにプロフィール訪問数の指標は存在しないため常にnull(取得不可)。
      profileVisits: null,
      hasMonetization,
      linkIds: monetization.map((m) => m.linkId),
      clicks,
      conversions,
      revenue,
      currency: hasMonetization ? monetization[0]?.currency ?? 'JPY' : null,
      ctr,
      cvr,
      revenuePer1000Views,
      revenuePerClick,
      scores: {
        reachScore: post.views,
        engagementScore: engagement,
        trafficScore: clicks,
        conversionScore: conversions,
        revenueScore: revenue,
        // STEP4で実データに基づく重み付けが決まるまでは算出しない(固定ウェイトの決め打ちを避ける)。
        totalScore: null,
      },
    };
  });
}

function percentileRank(value, sortedAsc) {
  if (sortedAsc.length === 0) return 0;
  const countBelow = sortedAsc.filter((v) => v < value).length;
  return countBelow / sortedAsc.length;
}

// 拡散型/集客型/収益型の簡易分類(v1ヒューリスティック)。
// - 母集団に対する相対的な位置(上位1/3かどうか)で判定する簡易ロジックであり、
//   固定の点数配分によるスコアリングではない。データが増えたらSTEP4で精緻化する前提。
function classifyPosts(records) {
  const withViews = records.filter((r) => r.views > 0);
  const viewsSorted = withViews.map((r) => r.views).sort((a, b) => a - b);
  const engagementSorted = withViews.map((r) => r.engagement).sort((a, b) => a - b);

  const monetized = records.filter((r) => r.hasMonetization);
  const ctrSorted = monetized.filter((r) => r.ctr != null).map((r) => r.ctr).sort((a, b) => a - b);
  const cvrSorted = monetized.filter((r) => r.cvr != null).map((r) => r.cvr).sort((a, b) => a - b);
  const revenueSorted = monetized.map((r) => r.revenue ?? 0).sort((a, b) => a - b);

  const TOP_THIRD = 2 / 3; // 上位1/3をおおよその閾値とする

  return records.map((r) => {
    if (!r.hasMonetization) {
      const reachHigh = r.views > 0 && percentileRank(r.views, viewsSorted) >= TOP_THIRD;
      const engagementHigh = r.views > 0 && percentileRank(r.engagement, engagementSorted) >= TOP_THIRD;
      return {
        ...r,
        classification: reachHigh || engagementHigh ? '拡散型(参考)' : 'データ不足(収益導線なし)',
        classificationNote: '収益導線(リンク)が設定されていないため、集客型・収益型の判定はできません。',
      };
    }

    const revenueHigh = (r.revenue ?? 0) > 0 && percentileRank(r.revenue, revenueSorted) >= TOP_THIRD;
    const cvrHigh = r.cvr != null && r.cvr > 0 && percentileRank(r.cvr, cvrSorted) >= TOP_THIRD;
    const ctrHigh = r.ctr != null && percentileRank(r.ctr, ctrSorted) >= TOP_THIRD;
    const reachHigh = r.views > 0 && percentileRank(r.views, viewsSorted) >= TOP_THIRD;

    let classification = '通常';
    if (revenueHigh || cvrHigh) {
      classification = '収益型';
    } else if (ctrHigh) {
      classification = '集客型';
    } else if (reachHigh) {
      classification = '拡散型';
    }

    return { ...r, classification, classificationNote: null };
  });
}

function topN(records, key, n = 10) {
  return [...records]
    .filter((r) => r[key] != null)
    .sort((a, b) => b[key] - a[key])
    .slice(0, n);
}

function computeRankings(records) {
  return {
    viewsTop10: topN(records, 'views'),
    engagementTop10: topN(
      records.filter((r) => r.engagementRate != null),
      'engagementRate'
    ),
    clicksTop10: topN(
      records.filter((r) => r.hasMonetization),
      'clicks'
    ),
    conversionsTop10: topN(
      records.filter((r) => r.hasMonetization),
      'conversions'
    ),
    revenueTop10: topN(
      records.filter((r) => r.hasMonetization),
      'revenue'
    ),
  };
}

// ジャンル×カテゴリー×切り口×テンプレート×時間帯でクロス集計する。
function computeCrossTab(records) {
  const groups = new Map();
  for (const r of records) {
    const key = [r.genre, r.category, r.angle, r.templateId, r.time].join('|');
    const g = groups.get(key) ?? {
      genre: r.genre,
      category: r.category,
      angle: r.angle,
      templateId: r.templateId,
      time: r.time,
      count: 0,
      views: 0,
      engagement: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      hasMonetizationCount: 0,
    };
    g.count += 1;
    g.views += r.views;
    g.engagement += r.engagement;
    if (r.hasMonetization) {
      g.hasMonetizationCount += 1;
      g.clicks += r.clicks ?? 0;
      g.conversions += r.conversions ?? 0;
      g.revenue += r.revenue ?? 0;
    }
    groups.set(key, g);
  }

  return [...groups.values()].map((g) => ({
    ...g,
    avgViews: g.views / g.count,
    ctr: g.hasMonetizationCount > 0 && g.views > 0 ? g.clicks / g.views : null,
    cvr: g.hasMonetizationCount > 0 && g.clicks > 0 ? g.conversions / g.clicks : null,
    lowSampleWarning: g.count < 3,
  }));
}

function formatPercent(value) {
  return value == null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
}

function formatYen(value) {
  return value == null ? 'N/A' : `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

function printReport() {
  const combined = buildCombinedRecords();
  const classified = classifyPosts(combined);
  const rankings = computeRankings(classified);
  const crossTab = computeCrossTab(classified);

  const monetizedCount = classified.filter((r) => r.hasMonetization).length;
  console.log(`対象投稿数: ${classified.length}件（うち収益導線あり: ${monetizedCount}件）`);
  console.log('※ プロフィール訪問数はThreads APIに指標が存在しないため常に取得不可です。\n');

  console.log('--- Views TOP10 ---');
  for (const r of rankings.viewsTop10) {
    console.log(`[${r.classification}] ${r.genre}/${r.category} ${r.postId}: ${r.views} views`);
  }

  console.log('\n--- エンゲージメント率 TOP10 ---');
  for (const r of rankings.engagementTop10) {
    console.log(`[${r.classification}] ${r.genre}/${r.category} ${r.postId}: ${formatPercent(r.engagementRate)}`);
  }

  console.log('\n--- リンククリック TOP10（収益導線ありの投稿のみ） ---');
  if (rankings.clicksTop10.length === 0) {
    console.log('（収益導線が設定された投稿がまだありません）');
  }
  for (const r of rankings.clicksTop10) {
    console.log(`${r.genre}/${r.category} ${r.postId}: ${r.clicks} clicks (CTR ${formatPercent(r.ctr)})`);
  }

  console.log('\n--- コンバージョン TOP10 ---');
  for (const r of rankings.conversionsTop10) {
    console.log(`${r.genre}/${r.category} ${r.postId}: ${r.conversions}件 (CVR ${formatPercent(r.cvr)})`);
  }

  console.log('\n--- 売上 TOP10 ---');
  for (const r of rankings.revenueTop10) {
    console.log(`${r.genre}/${r.category} ${r.postId}: ${formatYen(r.revenue)}`);
  }

  console.log('\n--- クロス集計(ジャンル×カテゴリー×切り口×テンプレート×時間帯) 上位(売上順) ---');
  const sortedCrossTab = [...crossTab].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0) || b.views - a.views);
  for (const g of sortedCrossTab.slice(0, 10)) {
    const sampleNote = g.lowSampleWarning ? '（サンプル数少）' : '';
    console.log(
      `${g.genre}/${g.category}/${g.angle}/${g.templateId}/${g.time} n=${g.count}${sampleNote}: ` +
        `平均views ${g.avgViews.toFixed(1)}, CTR ${formatPercent(g.ctr)}, CVR ${formatPercent(g.cvr)}, 売上 ${formatYen(g.revenue)}`
    );
  }
}

if (require.main === module) {
  printReport();
}

module.exports = {
  buildCombinedRecords,
  classifyPosts,
  computeRankings,
  computeCrossTab,
  formatPercent,
  formatYen,
};
