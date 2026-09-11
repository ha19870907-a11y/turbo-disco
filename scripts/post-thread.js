#!/usr/bin/env node
'use strict';

// Threads(Meta)への投稿を自動化するスクリプト。
// 使い方: THREADS_USER_ID / THREADS_ACCESS_TOKEN を環境変数に設定し、
//         node scripts/post-thread.js "投稿したいテキスト"

const API_BASE = 'https://graph.threads.net/v1.0';
const MAX_TEXT_LENGTH = 500;

function requireCredentials({ userId, accessToken }) {
  userId = (userId || process.env.THREADS_USER_ID || '').trim();
  accessToken = (accessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();
  console.log(`THREADS_USER_ID: ${userId.length}文字 / THREADS_ACCESS_TOKEN: ${accessToken.length}文字`);

  if (!userId || !accessToken) {
    throw new Error('THREADS_USER_ID と THREADS_ACCESS_TOKEN の環境変数を設定してください。');
  }
  return { userId, accessToken };
}

// コンテナ作成→公開の2ステップを共通化。replyToIdを指定すると、そのID宛の返信として投稿する。
// /{userId}/...ではなく/me/...を使う(アクセストークン自身のアカウントを直接指すため、
// THREADS_USER_IDとトークンの紐付けがずれていても影響を受けない。詳細はfetch-thread-insights.js参照)。
async function createAndPublish(text, accessToken, { replyToId } = {}) {
  const createUrl = new URL(`${API_BASE}/me/threads`);
  createUrl.searchParams.set('media_type', 'TEXT');
  createUrl.searchParams.set('text', text);
  if (replyToId) {
    createUrl.searchParams.set('reply_to_id', replyToId);
  }
  createUrl.searchParams.set('access_token', accessToken);

  const createRes = await fetch(createUrl, { method: 'POST' });
  const createBody = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`投稿の作成に失敗しました: ${JSON.stringify(createBody)}`);
  }

  // コンテナ作成直後は公開に失敗することがあるため、少し待ってから公開する。
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const publishUrl = new URL(`${API_BASE}/me/threads_publish`);
  publishUrl.searchParams.set('creation_id', createBody.id);
  publishUrl.searchParams.set('access_token', accessToken);

  const publishRes = await fetch(publishUrl, { method: 'POST' });
  const publishBody = await publishRes.json();
  if (!publishRes.ok) {
    throw new Error(`投稿の公開に失敗しました: ${JSON.stringify(publishBody)}`);
  }

  return publishBody;
}

async function postToThreads(text, { userId, accessToken } = {}) {
  ({ userId, accessToken } = requireCredentials({ userId, accessToken }));
  if (!text || !text.trim()) {
    throw new Error('投稿するテキストを指定してください。');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Threadsの投稿は${MAX_TEXT_LENGTH}文字までです（現在${text.length}文字）。`);
  }

  return createAndPublish(text, accessToken);
}

// 自分の投稿(replyToId)への返信として投稿する。クイズの答えなど、
// メインの投稿では見せず、タップして開かないと見えない形で内容を出したい場合に使う。
async function postReplyToThreads(text, replyToId, { userId, accessToken } = {}) {
  ({ userId, accessToken } = requireCredentials({ userId, accessToken }));
  if (!replyToId) {
    throw new Error('返信先のreplyToIdを指定してください。');
  }
  if (!text || !text.trim()) {
    throw new Error('返信するテキストを指定してください。');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Threadsの投稿は${MAX_TEXT_LENGTH}文字までです（現在${text.length}文字）。`);
  }

  return createAndPublish(text, accessToken, { replyToId });
}

async function main() {
  const text = process.argv.slice(2).join(' ');
  try {
    const result = await postToThreads(text);
    console.log(`Threadsに投稿しました（ID: ${result.id}）`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { postToThreads, postReplyToThreads };
