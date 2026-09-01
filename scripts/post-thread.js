#!/usr/bin/env node
'use strict';

// Threads(Meta)への投稿を自動化するスクリプト。
// 使い方: THREADS_USER_ID / THREADS_ACCESS_TOKEN を環境変数に設定し、
//         node scripts/post-thread.js "投稿したいテキスト"

const API_BASE = 'https://graph.threads.net/v1.0';
const MAX_TEXT_LENGTH = 500;

async function postToThreads(text, { userId, accessToken } = {}) {
  userId = (userId || process.env.THREADS_USER_ID || '').trim();
  accessToken = (accessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();
  console.log(`THREADS_USER_ID: ${userId.length}文字 / THREADS_ACCESS_TOKEN: ${accessToken.length}文字`);

  if (!userId || !accessToken) {
    throw new Error('THREADS_USER_ID と THREADS_ACCESS_TOKEN の環境変数を設定してください。');
  }
  if (!text || !text.trim()) {
    throw new Error('投稿するテキストを指定してください。');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Threadsの投稿は${MAX_TEXT_LENGTH}文字までです（現在${text.length}文字）。`);
  }

  const createUrl = new URL(`${API_BASE}/${userId}/threads`);
  createUrl.searchParams.set('media_type', 'TEXT');
  createUrl.searchParams.set('text', text);
  createUrl.searchParams.set('access_token', accessToken);

  const createRes = await fetch(createUrl, { method: 'POST' });
  const createBody = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`投稿の作成に失敗しました: ${JSON.stringify(createBody)}`);
  }

  // コンテナ作成直後は公開に失敗することがあるため、少し待ってから公開する。
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const publishUrl = new URL(`${API_BASE}/${userId}/threads_publish`);
  publishUrl.searchParams.set('creation_id', createBody.id);
  publishUrl.searchParams.set('access_token', accessToken);

  const publishRes = await fetch(publishUrl, { method: 'POST' });
  const publishBody = await publishRes.json();
  if (!publishRes.ok) {
    throw new Error(`投稿の公開に失敗しました: ${JSON.stringify(publishBody)}`);
  }

  return publishBody;
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

module.exports = { postToThreads };
