#!/usr/bin/env node
'use strict';

// 自分のThreads投稿のインサイト(閲覧数・いいね等)を取得し、thread-insights.jsonに記録するスクリプト。
// ジャンル別の反応を「見える化」するためのもので、投稿比率などを自動で調整するものではない。
// 集計結果はコンソールに出力するので、投稿ネタを選ぶ際の参考にしてください。

const fs = require('node:fs');
const path = require('node:path');

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';
const STATE_FILE = path.join(__dirname, '..', 'thread-insights.json');
const TEMPLATES_FILE = path.join(__dirname, 'thread-templates.json');
const INSIGHT_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes'];

function readInsightLog() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeInsightLog(records) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(records, null, 2) + '\n', 'utf8');
}

function buildTemplateLookup() {
  const templates = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
  const lookup = new Map();
  for (const template of templates) {
    lookup.set(template.text, template);
  }
  return lookup;
}

async function threadsGet(urlPath, params) {
  const url = new URL(`${THREADS_API_BASE}${urlPath}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Threads API GET失敗: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchInsightsFor(postId, accessToken) {
  const body = await threadsGet(`/${postId}/insights`, {
    metric: INSIGHT_METRICS.join(','),
    access_token: accessToken,
  });
  const values = {};
  for (const metric of body.data ?? []) {
    values[metric.name] = metric.values?.[0]?.value ?? metric.total_value?.value ?? 0;
  }
  return values;
}

async function main() {
  const userId = (process.env.THREADS_USER_ID || '').trim();
  const accessToken = (process.env.THREADS_ACCESS_TOKEN || '').trim();
  if (!userId || !accessToken) {
    throw new Error('THREADS_USER_ID と THREADS_ACCESS_TOKEN の環境変数を設定してください。');
  }

  const templateByText = buildTemplateLookup();
  const log = readInsightLog();
  const byId = new Map(log.map((record) => [record.id, record]));

  const posts = await threadsGet(`/${userId}/threads`, {
    fields: 'id,text,timestamp,permalink',
    limit: '50',
    access_token: accessToken,
  });

  let updated = 0;
  for (const post of posts.data ?? []) {
    let insights;
    try {
      insights = await fetchInsightsFor(post.id, accessToken);
    } catch (err) {
      console.error(`投稿 ${post.id} のインサイト取得に失敗: ${err.message}`);
      continue;
    }

    const template = templateByText.get(post.text);
    byId.set(post.id, {
      id: post.id,
      templateId: template?.id ?? null,
      genre: template?.genre ?? '不明',
      category: template?.category ?? '不明',
      angle: template?.angle ?? '不明',
      timestamp: post.timestamp,
      permalink: post.permalink,
      views: insights.views ?? 0,
      likes: insights.likes ?? 0,
      replies: insights.replies ?? 0,
      reposts: insights.reposts ?? 0,
      quotes: insights.quotes ?? 0,
      fetched_at: new Date().toISOString(),
    });
    updated += 1;
  }

  const records = [...byId.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  writeInsightLog(records);
  console.log(`${updated}件の投稿のインサイトを更新しました（記録件数: ${records.length}）。`);

  printGenreSummary(records);
}

function printGenreSummary(records) {
  const byGenre = new Map();
  for (const record of records) {
    const stats = byGenre.get(record.genre) ?? { count: 0, views: 0, likes: 0, replies: 0 };
    stats.count += 1;
    stats.views += record.views;
    stats.likes += record.likes;
    stats.replies += record.replies;
    byGenre.set(record.genre, stats);
  }

  console.log('\n--- ジャンル別 平均反応（参考値） ---');
  for (const [genre, stats] of [...byGenre.entries()].sort((a, b) => b[1].views / b[1].count - a[1].views / a[1].count)) {
    const avgViews = (stats.views / stats.count).toFixed(1);
    const avgLikes = (stats.likes / stats.count).toFixed(1);
    const avgReplies = (stats.replies / stats.count).toFixed(1);
    console.log(`${genre}\t投稿数:${stats.count}\t平均閲覧:${avgViews}\t平均いいね:${avgLikes}\t平均返信:${avgReplies}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { fetchInsightsFor };
