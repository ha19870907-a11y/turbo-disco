#!/usr/bin/env node
'use strict';

// STEP3.5: Threads運用の状態を一目で確認できる管理画面(静的HTML)を生成するスクリプト。
// thread-insights.json / thread-follower-history.json / thread-post-history.json /
// monetization-data.json を読み取り専用で集計するだけで、元データは一切変更しない。
// 実行するたびに dashboard/index.html を新しい内容で書き出す(スナップショット)。
//
// 使い方: node scripts/generate-dashboard.js

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'dashboard');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'index.html');

const { buildCombinedRecords, classifyPosts, computeRankings, formatPercent, formatYen } = require('./monetization-report.js');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sum(records, key) {
  return records.reduce((total, r) => total + (r[key] ?? 0), 0);
}

function statTile(label, value, note) {
  return `
    <div class="stat-tile">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${esc(value)}</div>
      ${note ? `<div class="stat-note">${esc(note)}</div>` : ''}
    </div>`;
}

function barChart(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `
    <div class="bar-chart" role="img" aria-label="ジャンル別 合計views">
      ${rows
        .map(
          (r) => `
        <div class="bar-row" title="${esc(r.label)}: ${esc(r.value.toLocaleString('ja-JP'))} views">
          <div class="bar-label">${esc(r.label)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${((r.value / max) * 100).toFixed(1)}%"></div></div>
          <div class="bar-value">${esc(r.value.toLocaleString('ja-JP'))}</div>
        </div>`
        )
        .join('')}
    </div>`;
}

function rankingTable(title, rows, columns) {
  if (rows.length === 0) {
    return `<h3>${esc(title)}</h3><p class="empty">まだデータがありません。</p>`;
  }
  return `
    <h3>${esc(title)}</h3>
    <div class="table-wrap">
      <table>
        <thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>${columns.map((c) => `<td>${esc(c.render(row))}</td>`).join('')}</tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function buildHtml(data) {
  const { totals, acquisition, revenueStats, rankings, genreBars, generatedAt } = data;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Threads運用ダッシュボード</title>
<style>
  .dash-root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11,11,11,0.10);
    --series-1: #2a78d6; /* blue: reach */
    --series-2: #eb6834; /* orange: engagement */
    --series-3: #1baf7a; /* aqua: traffic */
    --series-4: #e87ba4; /* magenta: conversion */
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--page);
    color: var(--text-primary);
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .dash-root {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255,255,255,0.10);
      --series-1: #3987e5;
      --series-2: #d95926;
      --series-3: #199e70;
      --series-4: #d55181;
    }
  }
  :root[data-theme="dark"] .dash-root {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --gridline: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255,255,255,0.10);
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #d55181;
  }
  .dash-root { margin: 0; padding: 24px; }
  .dash-header { margin-bottom: 24px; }
  .dash-header h1 { font-size: 20px; margin: 0 0 4px; }
  .dash-header p { margin: 0; color: var(--text-secondary); font-size: 13px; }
  section { margin-bottom: 32px; }
  section > h2 { font-size: 15px; border-bottom: 1px solid var(--gridline); padding-bottom: 8px; margin-bottom: 16px; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .stat-tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
  .stat-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
  .stat-value { font-size: 22px; font-weight: 600; }
  .stat-note { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
  .bar-chart { display: flex; flex-direction: column; gap: 8px; }
  .bar-row { display: grid; grid-template-columns: 100px 1fr 70px; align-items: center; gap: 8px; font-size: 12px; }
  .bar-label { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-track { background: var(--gridline); border-radius: 4px; height: 12px; overflow: hidden; }
  .bar-fill { background: var(--series-1); height: 100%; border-radius: 4px; }
  .bar-value { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--gridline); white-space: nowrap; }
  th { color: var(--text-secondary); font-weight: 500; }
  .empty { color: var(--text-muted); font-size: 13px; }
  .rankings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
  .note-box { background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; font-size: 12px; color: var(--text-secondary); }
</style>
</head>
<body>
<div class="dash-root">
  <div class="dash-header">
    <h1>Threads運用ダッシュボード</h1>
    <p>生成日時: ${esc(generatedAt)}（node scripts/generate-dashboard.js で再生成できます）</p>
  </div>

  <section>
    <h2>Threads全体</h2>
    <div class="stat-grid">
      ${statTile('総投稿数(KPI取得済み)', totals.postCount)}
      ${statTile('総Views', totals.views.toLocaleString('ja-JP'))}
      ${statTile('総Likes', totals.likes.toLocaleString('ja-JP'))}
      ${statTile('総Replies', totals.replies.toLocaleString('ja-JP'))}
      ${statTile('総Reposts', totals.reposts.toLocaleString('ja-JP'))}
      ${statTile('現在のフォロワー数', totals.followers ?? 'N/A', totals.followersUpdatedAt ? `更新: ${totals.followersUpdatedAt}` : '')}
    </div>
  </section>

  <section>
    <h2>ジャンル別 合計Views</h2>
    ${barChart(genreBars)}
  </section>

  <section>
    <h2>集客（収益導線ありの投稿のみ）</h2>
    <div class="stat-grid">
      ${statTile('プロフィール訪問', 'N/A', 'Threads APIに指標が存在しないため取得不可')}
      ${statTile('リンククリック(合計)', acquisition.clicks)}
      ${statTile('CTR(全体平均)', formatPercent(acquisition.ctr))}
    </div>
  </section>

  <section>
    <h2>収益</h2>
    <div class="stat-grid">
      ${statTile('CV(合計)', revenueStats.conversions)}
      ${statTile('CVR(全体平均)', formatPercent(revenueStats.cvr))}
      ${statTile('売上(合計)', formatYen(revenueStats.revenue))}
      ${statTile('平均売上/投稿(収益導線あり)', formatYen(revenueStats.avgRevenuePerMonetizedPost))}
    </div>
  </section>

  <section>
    <h2>ランキング</h2>
    <div class="rankings-grid">
      ${rankingTable('Views TOP10', rankings.viewsTop10, [
        { label: '分類', render: (r) => r.classification },
        { label: 'ジャンル/カテゴリー', render: (r) => `${r.genre}/${r.category}` },
        { label: 'postId', render: (r) => r.postId },
        { label: 'views', render: (r) => r.views.toLocaleString('ja-JP') },
      ])}
      ${rankingTable('エンゲージメント率 TOP10', rankings.engagementTop10, [
        { label: '分類', render: (r) => r.classification },
        { label: 'ジャンル/カテゴリー', render: (r) => `${r.genre}/${r.category}` },
        { label: 'postId', render: (r) => r.postId },
        { label: '率', render: (r) => formatPercent(r.engagementRate) },
      ])}
      ${rankingTable('リンククリック TOP10', rankings.clicksTop10, [
        { label: 'ジャンル/カテゴリー', render: (r) => `${r.genre}/${r.category}` },
        { label: 'postId', render: (r) => r.postId },
        { label: 'clicks', render: (r) => r.clicks },
        { label: 'CTR', render: (r) => formatPercent(r.ctr) },
      ])}
      ${rankingTable('コンバージョン TOP10', rankings.conversionsTop10, [
        { label: 'ジャンル/カテゴリー', render: (r) => `${r.genre}/${r.category}` },
        { label: 'postId', render: (r) => r.postId },
        { label: 'CV', render: (r) => r.conversions },
        { label: 'CVR', render: (r) => formatPercent(r.cvr) },
      ])}
      ${rankingTable('売上 TOP10', rankings.revenueTop10, [
        { label: 'ジャンル/カテゴリー', render: (r) => `${r.genre}/${r.category}` },
        { label: 'postId', render: (r) => r.postId },
        { label: '売上', render: (r) => formatYen(r.revenue) },
      ])}
    </div>
  </section>

  <section>
    <div class="note-box">
      このダッシュボードは実行時点のリポジトリ内JSONを集計した静的スナップショットです。
      プロフィール訪問数はThreads APIに存在しないため常に取得不可です。
      クリック数・コンバージョン数・売上は、収益導線(monetization-links.json)を投稿に紐付け、
      外部の計測結果を scripts/update-monetization.js で反映した投稿のみ表示されます。
    </div>
  </section>
</div>
</body>
</html>`;
}

function generate() {
  const insights = readJson(path.join(ROOT_DIR, 'thread-insights.json'), []);
  const followerHistory = readJson(path.join(ROOT_DIR, 'thread-follower-history.json'), []);

  const combined = buildCombinedRecords();
  const classified = classifyPosts(combined);
  const rankings = computeRankings(classified);

  const totals = {
    postCount: insights.length,
    views: sum(insights, 'views'),
    likes: sum(insights, 'likes'),
    replies: sum(insights, 'replies'),
    reposts: sum(insights, 'reposts'),
    followers: followerHistory.length > 0 ? followerHistory[followerHistory.length - 1].followersCount : null,
    followersUpdatedAt: followerHistory.length > 0 ? followerHistory[followerHistory.length - 1].fetchedAt : null,
  };

  const monetized = classified.filter((r) => r.hasMonetization);
  const acquisition = {
    clicks: sum(monetized, 'clicks'),
    ctr: totals.views > 0 && monetized.length > 0 ? sum(monetized, 'clicks') / totals.views : null,
  };
  const revenueStats = {
    conversions: sum(monetized, 'conversions'),
    cvr: sum(monetized, 'clicks') > 0 ? sum(monetized, 'conversions') / sum(monetized, 'clicks') : null,
    revenue: sum(monetized, 'revenue'),
    avgRevenuePerMonetizedPost: monetized.length > 0 ? sum(monetized, 'revenue') / monetized.length : null,
  };

  const genreTotals = new Map();
  for (const r of insights) {
    genreTotals.set(r.genre, (genreTotals.get(r.genre) ?? 0) + r.views);
  }
  const genreBars = [...genreTotals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  const html = buildHtml({
    totals,
    acquisition,
    revenueStats,
    rankings,
    genreBars,
    generatedAt: new Date().toISOString(),
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, 'utf8');
  console.log(`ダッシュボードを生成しました: ${path.relative(ROOT_DIR, OUTPUT_FILE)}`);
}

if (require.main === module) {
  generate();
}

module.exports = { generate };
