#!/usr/bin/env node
'use strict';

// note.comへ記事を自動投稿するスクリプト。
// noteには公式の投稿APIが無いため、あらかじめ note-login.js で保存したログイン状態
// （note-session.json）を使ってブラウザを操作し、記事エディタへの入力〜投稿までを
// 自動化する。note側のページ構造(HTML)が変わると動かなくなる可能性がある、非公式の
// 手段であることに注意。
//
// 使い方:
//   npm run post:note                          # note-drafts/ 内の最新ファイルを下書き保存
//   npm run post:note -- note-drafts/xxx.md     # ファイルを指定
//   npm run post:note -- note-drafts/xxx.md --publish   # 下書きでなく公開まで行う
//
// 記事ファイルの形式（scripts/generate-note-draft.jsが生成するもの）:
//   # タイトル
//
//   本文...
//
// 環境変数:
//   NOTE_STORAGE_STATE_PATH  ログイン状態ファイルのパス（既定: note-session.json）
//   NOTE_STORAGE_STATE_B64   ログイン状態JSONをbase64化した文字列（CI向け。設定時はこちらを優先）

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DRAFTS_DIR = path.join(__dirname, '..', 'note-drafts');
const NEW_NOTE_URL = 'https://note.com/notes/new';

function parseArgs(argv) {
  const args = { publish: false, file: null };
  for (const arg of argv) {
    if (arg === '--publish') args.publish = true;
    else if (!arg.startsWith('--')) args.file = arg;
  }
  return args;
}

function resolveDraftFile(explicitFile) {
  if (explicitFile) {
    const p = path.resolve(explicitFile);
    if (!fs.existsSync(p)) throw new Error(`ファイルが見つかりません: ${p}`);
    return p;
  }
  if (!fs.existsSync(DRAFTS_DIR)) {
    throw new Error(`${DRAFTS_DIR} が存在しません。投稿する記事ファイルをパスで指定してください。`);
  }
  const files = fs
    .readdirSync(DRAFTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  if (files.length === 0) {
    throw new Error(`${DRAFTS_DIR} に .md ファイルがありません。投稿する記事ファイルをパスで指定してください。`);
  }
  return path.join(DRAFTS_DIR, files[files.length - 1]);
}

function parseArticle(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const lines = raw.split('\n');
  let title = '';
  let bodyStartIndex = 0;
  const titleLineIndex = lines.findIndex((l) => l.trim().startsWith('# '));
  if (titleLineIndex !== -1) {
    title = lines[titleLineIndex].replace(/^#\s*/, '').trim();
    bodyStartIndex = titleLineIndex + 1;
  }
  const body = lines
    .slice(bodyStartIndex)
    .join('\n')
    .replace(/^\n+/, '')
    .trimEnd();

  if (!title) throw new Error(`記事タイトル（# で始まる行）が見つかりません: ${filePath}`);
  if (!body) throw new Error(`本文が空です: ${filePath}`);
  return { title, body };
}

function resolveStorageStatePath() {
  const b64 = process.env.NOTE_STORAGE_STATE_B64;
  if (b64 && b64.trim()) {
    const tmpPath = path.join(os.tmpdir(), `note-session-${Date.now()}.json`);
    fs.writeFileSync(tmpPath, Buffer.from(b64.trim(), 'base64'));
    return { statePath: tmpPath, isTemp: true };
  }
  const statePath = process.env.NOTE_STORAGE_STATE_PATH || path.join(__dirname, '..', 'note-session.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(
      `ログイン状態ファイルが見つかりません: ${statePath}\n` +
        '先に `npm run login:note` を実行してnoteにログインしてください。'
    );
  }
  return { statePath, isTemp: false };
}

async function postToNote({ title, body, publish }) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error(
      'playwright がインストールされていません。先に `npm install` と ' +
        '`npx playwright install chromium` を実行してください。'
    );
  }

  const { statePath, isTemp } = resolveStorageStatePath();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();

  try {
    await page.goto(NEW_NOTE_URL, { waitUntil: 'domcontentloaded' });

    if (/\/login/.test(page.url())) {
      throw new Error(
        'ログインが切れているようです。`npm run login:note` を再実行して、' +
          'ログイン状態を更新してください。'
      );
    }

    const titleBox = page.getByPlaceholder(/タイトル/).first();
    await titleBox.waitFor({ state: 'visible', timeout: 30000 });
    await titleBox.click();
    await titleBox.fill(title);

    const bodyBox = page.locator('[contenteditable="true"]').last();
    await bodyBox.click();
    await bodyBox.type(body, { delay: 5 });

    // 少し待ってnote側の自動保存を確実にする
    await page.waitForTimeout(1500);

    if (publish) {
      const proceedButton = page.getByRole('button', { name: /公開に進む/ });
      await proceedButton.click();
      const publishButton = page.getByRole('button', { name: /^投稿する$/ });
      await publishButton.waitFor({ state: 'visible', timeout: 15000 });
      await publishButton.click();
      await page.waitForTimeout(3000);
      return { url: page.url(), publish: true };
    }

    return { url: page.url(), publish: false };
  } finally {
    await browser.close();
    if (isTemp) fs.rmSync(statePath, { force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const draftFile = resolveDraftFile(args.file);
  const { title, body } = parseArticle(draftFile);

  console.log(`投稿元ファイル: ${draftFile}`);
  console.log(`タイトル: ${title}`);
  console.log(args.publish ? 'モード: 公開' : 'モード: 下書き保存のみ（--publish で公開されます）');

  const result = await postToNote({ title, body, publish: args.publish });
  console.log(result.publish ? '記事を公開しました。' : '記事を下書き保存しました。');
  console.log(`URL: ${result.url}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { postToNote, parseArticle, resolveDraftFile };
