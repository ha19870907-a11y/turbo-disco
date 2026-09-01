#!/usr/bin/env node
'use strict';

// Threadsの自分の投稿についたコメントに、AI(Claude)が内容を読んで自動返信するスクリプト。
// GitHub Actionsのscheduleトリガーから定期的に呼び出す想定。
// 一度返信したコメントはreplied-comments.jsonに記録し、二重返信を防ぐ。

const fs = require('node:fs');
const path = require('node:path');

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const STATE_FILE = path.join(__dirname, '..', 'replied-comments.json');
const MAX_REPLY_LENGTH = 480;

const SYSTEM_PROMPT = `あなたは、子育て・補助金・助成金に関する情報を発信しているThreadsアカウントの中の人として、
自分の投稿についたコメントに短く返信するアシスタントです。以下のルールを厳守してください。

- 日本語で、親しみやすく丁寧な1〜2文で返信する（絵文字は0〜1個まで）
- 480文字以内に必ず収める
- コメントへのお礼や共感を基本にする
- 具体的な金額・所得制限・法律の細かい要件など、間違えると実害が出る可能性のある質問には、
  断定的に数字を答えず「お住まいの市区町村の窓口や公式サイトでの確認をおすすめします」と案内する
- 投資商品・金融商品・特定のサービスや事業者を勧めない
- 自分が知らない・確認できないことは「詳しくは公式窓口でご確認ください」と正直に案内する
- コメントが誹謗中傷やスパムの場合は、返信せず本文だけで "SKIP" とだけ出力する`;

function readState() {
  try {
    return new Set(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

function writeState(repliedIds) {
  fs.writeFileSync(STATE_FILE, JSON.stringify([...repliedIds], null, 2) + '\n', 'utf8');
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

async function generateReply(commentText) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `次のコメントに返信してください:\n\n${commentText}` }],
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Anthropic API失敗: ${JSON.stringify(body)}`);
  }
  const text = body.content?.[0]?.text?.trim() ?? '';
  return text;
}

async function postReply(userId, accessToken, replyToId, text) {
  const createUrl = new URL(`${THREADS_API_BASE}/${userId}/threads`);
  createUrl.searchParams.set('media_type', 'TEXT');
  createUrl.searchParams.set('text', text);
  createUrl.searchParams.set('reply_to_id', replyToId);
  createUrl.searchParams.set('access_token', accessToken);

  const createRes = await fetch(createUrl, { method: 'POST' });
  const createBody = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`返信の作成に失敗しました: ${JSON.stringify(createBody)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const publishUrl = new URL(`${THREADS_API_BASE}/${userId}/threads_publish`);
  publishUrl.searchParams.set('creation_id', createBody.id);
  publishUrl.searchParams.set('access_token', accessToken);

  const publishRes = await fetch(publishUrl, { method: 'POST' });
  const publishBody = await publishRes.json();
  if (!publishRes.ok) {
    throw new Error(`返信の公開に失敗しました: ${JSON.stringify(publishBody)}`);
  }
  return publishBody;
}

async function main() {
  const userId = (process.env.THREADS_USER_ID || '').trim();
  const accessToken = (process.env.THREADS_ACCESS_TOKEN || '').trim();
  if (!userId || !accessToken) {
    throw new Error('THREADS_USER_ID と THREADS_ACCESS_TOKEN の環境変数を設定してください。');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY の環境変数を設定してください。');
  }

  const me = await threadsGet(`/me`, { fields: 'username', access_token: accessToken });
  const myUsername = me.username;

  const repliedIds = readState();

  const posts = await threadsGet(`/${userId}/threads`, {
    fields: 'id',
    limit: '25',
    access_token: accessToken,
  });

  let repliedCount = 0;

  for (const post of posts.data ?? []) {
    let replies;
    try {
      replies = await threadsGet(`/${post.id}/replies`, {
        fields: 'id,text,username,hide_status',
        access_token: accessToken,
      });
    } catch (err) {
      console.error(`投稿 ${post.id} の返信取得に失敗: ${err.message}`);
      continue;
    }

    for (const reply of replies.data ?? []) {
      if (repliedIds.has(reply.id)) continue;
      if (reply.username === myUsername) continue;
      if (reply.hide_status && reply.hide_status !== 'NOT_HIDDEN') continue;
      if (!reply.text) continue;

      try {
        const replyText = await generateReply(reply.text);
        if (!replyText || replyText === 'SKIP') {
          console.log(`コメント ${reply.id} はスキップしました。`);
          repliedIds.add(reply.id);
          continue;
        }
        const finalText = replyText.slice(0, MAX_REPLY_LENGTH);
        const result = await postReply(userId, accessToken, reply.id, finalText);
        console.log(`コメント ${reply.id} に返信しました（ID: ${result.id}）`);
        repliedIds.add(reply.id);
        repliedCount += 1;
      } catch (err) {
        console.error(`コメント ${reply.id} への返信に失敗: ${err.message}`);
      }
    }
  }

  writeState(repliedIds);
  console.log(`合計 ${repliedCount} 件のコメントに返信しました。`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
