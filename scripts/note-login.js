#!/usr/bin/env node
'use strict';

// note.comへログインし、ログイン状態（Cookie等）をファイルに保存するスクリプト。
// noteには公式APIが無く、メールアドレス/パスワードの自動入力はデバイス確認メールや
// reCAPTCHAでブロックされやすいため、ブラウザを実際に開いて「手動でログインしてもらう」
// 方式にしている。一度ログインしておけば、post-note.js はそのログイン状態を使い回して
// 記事の投稿だけを自動化できる。
//
// 使い方:
//   npm run login:note
// ブラウザが開くので note.com に手動でログインし、マイページ等が表示されたら
// ターミナルに戻って Enter を押す（自動検出もするが、確実を期すため待ち受ける）。
//
// 保存先: note-session.json（.gitignore済み。他人と共有しないこと）
// GitHub Actionsなど非対話環境で使う場合は、生成された note-session.json の中身を
// base64化して NOTE_STORAGE_STATE シークレットに設定する（README参照）。

const path = require('node:path');
const readline = require('node:readline');

const OUTPUT_PATH = process.env.NOTE_STORAGE_STATE_PATH || path.join(__dirname, '..', 'note-session.json');
const LOGIN_URL = 'https://note.com/login';

function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(promptText, () => { rl.close(); resolve(); }));
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error(
      'playwright がインストールされていません。先に `npm install` と ' +
        '`npx playwright install chromium` を実行してください。'
    );
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL);

  console.log('ブラウザで note.com のログインを完了してください。');
  console.log('（メール/パスワード、二段階認証など、表示される手順に従ってください）');
  await waitForEnter('ログインが完了したら Enter キーを押してください... ');

  await context.storageState({ path: OUTPUT_PATH });
  await browser.close();

  console.log(`ログイン状態を保存しました: ${OUTPUT_PATH}`);
  console.log('このファイルはパスワード同様に機密情報です。第三者と共有しないでください。');
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
