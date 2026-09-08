#!/usr/bin/env node
'use strict';

// 自分のThreads投稿のKPI(閲覧数・いいね等)とアカウントのフォロワー数推移を記録するスクリプト。
// ジャンル別・投稿別の反応を「見える化」するためのもので、投稿比率などを自動で調整するものではない
// (自動調整はSTEP5で扱う想定。現時点ではデータ蓄積のみ)。
//
// 【Threads APIで取得できる指標】
//   - 投稿単位: views / likes / replies / reposts / quotes
//     (GET /{threads-media-id}/insights?metric=views,likes,replies,reposts,quotes)
//   - アカウント単位: views / likes / replies / reposts / quotes の期間集計、
//     followers_count(フォロワー数。Instagram連携アカウントが必須)、
//     follower_demographics(フォロワー100人以上必要)
//     (GET /{threads-user-id}/threads_insights?metric=...)
//
// 【Threads APIで取得できない指標(2026年時点で確認済み・代替不可)】
//   - プロフィール閲覧数: Threads APIには存在しない指標(ネイティブアプリの
//     インサイト画面にのみ表示され、APIでは提供されていない)。
//   - 投稿ごとのフォロー増加数・フォロー率: 「どの投稿がきっかけでフォローされたか」を
//     示す指標はThreads APIに存在しない(Instagram Graph APIにも同種の指標はない)。
//     アカウント全体のフォロワー数(followers_count)は取得できるため、本スクリプトでは
//     それを定期的に記録して期間ごとの純増減を追う。特定の投稿への因果関係付けは行わない。
// これらは無理に推定値を作らず、明確に「取得不可」として扱う。

const fs = require('node:fs');
const path = require('node:path');

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';
const STATE_FILE = path.join(__dirname, '..', 'thread-insights.json');
const FOLLOWER_HISTORY_FILE = path.join(__dirname, '..', 'thread-follower-history.json');
const TEMPLATES_FILE = path.join(__dirname, 'thread-templates.json');
const MEDIA_INSIGHT_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes'];
const FOLLOWER_HISTORY_KEEP = 500;

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
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

async function fetchMediaInsights(postId, accessToken) {
  const body = await threadsGet(`/${postId}/insights`, {
    metric: MEDIA_INSIGHT_METRICS.join(','),
    access_token: accessToken,
  });
  const values = {};
  for (const metric of body.data ?? []) {
    values[metric.name] = metric.values?.[0]?.value ?? metric.total_value?.value ?? 0;
  }
  return values;
}

// followers_countは「期間の終了時点での合計フォロワー数」を返す仕様のため、
// 直近1日分の期間を指定して最新の合計値を取得する。Instagram未連携のアカウントでは
// 失敗することがあるため、呼び出し側でエラーを捕捉してスキップ可能にしている。
async function fetchFollowersCount(userId, accessToken) {
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceSec = nowSec - 86400;
  const body = await threadsGet(`/${userId}/threads_insights`, {
    metric: 'followers_count',
    since: String(sinceSec),
    until: String(nowSec),
    access_token: accessToken,
  });
  const metric = (body.data ?? []).find((m) => m.name === 'followers_count');
  if (!metric) return null;
  if (typeof metric.total_value?.value === 'number') {
    return metric.total_value.value;
  }
  const values = metric.values ?? [];
  if (values.length > 0) {
    return values[values.length - 1].value;
  }
  return null;
}

function computeEngagementRate({ views, likes, replies, reposts, quotes }) {
  if (!views || views <= 0) return null;
  return Number(((likes + replies + reposts + quotes) / views).toFixed(4));
}

async function updatePostInsights(userId, accessToken, templateByText) {
  const log = readJsonFile(STATE_FILE, []);
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
      insights = await fetchMediaInsights(post.id, accessToken);
    } catch (err) {
      console.error(`投稿 ${post.id} のインサイト取得に失敗: ${err.message}`);
      continue;
    }

    const template = templateByText.get(post.text);
    const existing = byId.get(post.id);
    const metrics = {
      views: insights.views ?? 0,
      likes: insights.likes ?? 0,
      replies: insights.replies ?? 0,
      reposts: insights.reposts ?? 0,
      quotes: insights.quotes ?? 0,
    };

    const previous = existing
      ? {
          views: existing.views,
          likes: existing.likes,
          replies: existing.replies,
          reposts: existing.reposts,
          quotes: existing.quotes,
          fetchedAt: existing.fetchedAt,
        }
      : null;

    const delta = previous
      ? {
          views: metrics.views - previous.views,
          likes: metrics.likes - previous.likes,
          replies: metrics.replies - previous.replies,
          reposts: metrics.reposts - previous.reposts,
          quotes: metrics.quotes - previous.quotes,
        }
      : null;

    byId.set(post.id, {
      id: post.id,
      templateId: template?.id ?? null,
      genre: template?.genre ?? '不明',
      category: template?.category ?? '不明',
      angle: template?.angle ?? '不明',
      text: post.text ?? '',
      postedAt: post.timestamp,
      permalink: post.permalink,
      ...metrics,
      engagementRate: computeEngagementRate(metrics),
      previous,
      delta,
      firstFetchedAt: existing?.firstFetchedAt ?? new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    });
    updated += 1;
  }

  const records = [...byId.values()].sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));
  writeJsonFile(STATE_FILE, records);
  console.log(`${updated}件の投稿のインサイトを更新しました（記録件数: ${records.length}）。`);
  return records;
}

async function updateFollowerHistory(userId, accessToken) {
  let followersCount;
  try {
    followersCount = await fetchFollowersCount(userId, accessToken);
  } catch (err) {
    console.error(
      `フォロワー数の取得に失敗しました（Instagramと連携していないアカウントでは取得できません）: ${err.message}`
    );
    return null;
  }
  if (followersCount == null) {
    console.log('フォロワー数を取得できませんでした（followers_countメトリクスが空でした）。');
    return null;
  }

  const history = readJsonFile(FOLLOWER_HISTORY_FILE, []);
  const previousEntry = history[history.length - 1] ?? null;
  const entry = {
    fetchedAt: new Date().toISOString(),
    followersCount,
    deltaFromPrevious: previousEntry ? followersCount - previousEntry.followersCount : null,
  };
  history.push(entry);
  writeJsonFile(FOLLOWER_HISTORY_FILE, history.slice(-FOLLOWER_HISTORY_KEEP));
  return entry;
}

function printGenreSummary(records) {
  const byGenre = new Map();
  for (const record of records) {
    const stats = byGenre.get(record.genre) ?? { count: 0, views: 0, likes: 0, replies: 0, engagementSum: 0, engagementCount: 0 };
    stats.count += 1;
    stats.views += record.views;
    stats.likes += record.likes;
    stats.replies += record.replies;
    if (record.engagementRate != null) {
      stats.engagementSum += record.engagementRate;
      stats.engagementCount += 1;
    }
    byGenre.set(record.genre, stats);
  }

  console.log('\n--- ジャンル別 平均反応（参考値） ---');
  for (const [genre, stats] of [...byGenre.entries()].sort((a, b) => b[1].views / b[1].count - a[1].views / a[1].count)) {
    const avgViews = (stats.views / stats.count).toFixed(1);
    const avgLikes = (stats.likes / stats.count).toFixed(1);
    const avgReplies = (stats.replies / stats.count).toFixed(1);
    const avgEngagement = stats.engagementCount > 0 ? `${((stats.engagementSum / stats.engagementCount) * 100).toFixed(1)}%` : 'N/A';
    console.log(
      `${genre}\t投稿数:${stats.count}\t平均閲覧:${avgViews}\t平均いいね:${avgLikes}\t平均返信:${avgReplies}\t平均エンゲージメント率:${avgEngagement}`
    );
  }
}

function printGrowthSummary(records) {
  const withDelta = records.filter((r) => r.delta != null);
  if (withDelta.length === 0) {
    console.log('\n--- 伸び幅の比較 ---\n（2回目以降の取得がまだ無いため、今回は比較対象がありません）');
    return;
  }
  const sorted = [...withDelta].sort((a, b) => b.delta.views - a.delta.views);
  console.log('\n--- 前回取得からの伸び幅(views) 上位 ---');
  for (const r of sorted.slice(0, 5)) {
    const sign = r.delta.views >= 0 ? '+' : '';
    console.log(`[${r.genre}/${r.category}] ${r.templateId ?? r.id}: ${sign}${r.delta.views} views (合計${r.views})`);
  }
  console.log('\n--- 前回取得からの伸び幅(views) 下位 ---');
  for (const r of sorted.slice(-5).reverse()) {
    const sign = r.delta.views >= 0 ? '+' : '';
    console.log(`[${r.genre}/${r.category}] ${r.templateId ?? r.id}: ${sign}${r.delta.views} views (合計${r.views})`);
  }
}

async function main() {
  const userId = (process.env.THREADS_USER_ID || '').trim();
  const accessToken = (process.env.THREADS_ACCESS_TOKEN || '').trim();
  if (!userId || !accessToken) {
    throw new Error('THREADS_USER_ID と THREADS_ACCESS_TOKEN の環境変数を設定してください。');
  }

  console.log(
    '※ プロフィール閲覧数、投稿ごとのフォロー増加数・フォロー率は、Threads APIで提供されていないため取得していません（取得不可）。'
  );

  const templateByText = buildTemplateLookup();
  const records = await updatePostInsights(userId, accessToken, templateByText);
  printGenreSummary(records);
  printGrowthSummary(records);

  const followerEntry = await updateFollowerHistory(userId, accessToken);
  if (followerEntry) {
    const deltaText = followerEntry.deltaFromPrevious == null ? '(初回記録)' : `(前回比 ${followerEntry.deltaFromPrevious >= 0 ? '+' : ''}${followerEntry.deltaFromPrevious})`;
    console.log(`\n--- フォロワー数 ---\n現在のフォロワー数: ${followerEntry.followersCount} ${deltaText}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { fetchMediaInsights, fetchFollowersCount, computeEngagementRate };
