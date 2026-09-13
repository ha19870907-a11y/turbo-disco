#!/usr/bin/env node
'use strict';

// X(旧Twitter)への投稿を自動化するスクリプト。
// 使い方: X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET を
//         環境変数に設定し、node scripts/post-to-x.js "投稿したいテキスト"
//
// X API v2 (POST /2/tweets) は投稿にOAuth 1.0a User Contextでの署名が必要なため、
// 外部ライブラリを使わずcryptoモジュールだけで署名を生成している。

const crypto = require('node:crypto');

const API_URL = 'https://api.twitter.com/2/tweets';
const MAX_TEXT_LENGTH = 280;

function requireCredentials({ apiKey, apiSecret, accessToken, accessTokenSecret } = {}) {
  apiKey = (apiKey || process.env.X_API_KEY || '').trim();
  apiSecret = (apiSecret || process.env.X_API_SECRET || '').trim();
  accessToken = (accessToken || process.env.X_ACCESS_TOKEN || '').trim();
  accessTokenSecret = (accessTokenSecret || process.env.X_ACCESS_TOKEN_SECRET || '').trim();
  console.log(
    `X_API_KEY: ${apiKey.length}文字 / X_API_SECRET: ${apiSecret.length}文字 / ` +
      `X_ACCESS_TOKEN: ${accessToken.length}文字 / X_ACCESS_TOKEN_SECRET: ${accessTokenSecret.length}文字`
  );

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    throw new Error(
      'X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET の環境変数を設定してください。'
    );
  }
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

// RFC3986に準拠したパーセントエンコード(OAuth 1.0aの仕様上、encodeURIComponentだけでは
// !*'() がエンコードされずに残ってしまうため追加で変換する)。
function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// OAuth 1.0a (HMAC-SHA1)の署名付きAuthorizationヘッダーを生成する。
// /2/tweetsはJSONボディでパラメータを送るため、署名対象のパラメータはoauth_*のみでよい。
function buildOAuthHeader({ method, url, apiKey, apiSecret, accessToken, accessTokenSecret }) {
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(oauthParams[key])}`)
    .join('&');

  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join('&');
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  const headerParams = { ...oauthParams, oauth_signature: signature };
  return (
    'OAuth ' +
    Object.keys(headerParams)
      .sort()
      .map((key) => `${percentEncode(key)}="${percentEncode(headerParams[key])}"`)
      .join(', ')
  );
}

// ツイート投稿の共通処理。replyToIdを指定すると、そのツイートID×宛の返信として投稿する。
async function createTweet(text, { apiKey, apiSecret, accessToken, accessTokenSecret }, { replyToId } = {}) {
  const authHeader = buildOAuthHeader({
    method: 'POST',
    url: API_URL,
    apiKey,
    apiSecret,
    accessToken,
    accessTokenSecret,
  });

  const payload = { text };
  if (replyToId) {
    payload.reply = { in_reply_to_tweet_id: replyToId };
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`投稿に失敗しました: ${JSON.stringify(body)}`);
  }

  return body.data;
}

async function postToX(text, { apiKey, apiSecret, accessToken, accessTokenSecret } = {}) {
  const creds = requireCredentials({ apiKey, apiSecret, accessToken, accessTokenSecret });
  if (!text || !text.trim()) {
    throw new Error('投稿するテキストを指定してください。');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Xの投稿は${MAX_TEXT_LENGTH}文字までです（現在${text.length}文字）。`);
  }

  return createTweet(text, creds);
}

// 自分の投稿(replyToId)への返信として投稿する。クイズの答えなど、
// メインの投稿では見せず、タップして開かないと見えない形で内容を出したい場合に使う。
async function postReplyToX(text, replyToId, { apiKey, apiSecret, accessToken, accessTokenSecret } = {}) {
  const creds = requireCredentials({ apiKey, apiSecret, accessToken, accessTokenSecret });
  if (!replyToId) {
    throw new Error('返信先のreplyToIdを指定してください。');
  }
  if (!text || !text.trim()) {
    throw new Error('返信するテキストを指定してください。');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Xの投稿は${MAX_TEXT_LENGTH}文字までです（現在${text.length}文字）。`);
  }

  return createTweet(text, creds, { replyToId });
}

async function main() {
  const text = process.argv.slice(2).join(' ');
  try {
    const result = await postToX(text);
    console.log(`Xに投稿しました（ID: ${result.id}）`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { postToX, postReplyToX };
