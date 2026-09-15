#!/usr/bin/env node
'use strict';

// 事前に用意したnote記事のネタ(scripts/note-topics.json)を、週替わりで
// 順番にnote-drafts/フォルダへ下書きファイルとして書き出すスクリプト。
// 実際のnoteへの投稿は手動で行う(下書きファイルをコピペする)前提。

const fs = require('node:fs');
const path = require('node:path');

const topics = require('./note-topics.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'note-drafts');

function weekOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const diff = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start;
  return Math.floor(diff / (7 * 86400000));
}

function slugify(title) {
  return title
    .replace(/[「」『』？?！!、。,.]/g, '')
    .split(/\s+/)
    .join('-')
    .slice(0, 40);
}

function main() {
  const today = new Date();
  const index = weekOfYear(today) % topics.length;
  const topic = topics[index];

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const dateStr = today.toISOString().slice(0, 10);
  const filename = `${dateStr}-${slugify(topic.title)}.md`;
  const filePath = path.join(OUTPUT_DIR, filename);

  const content = `# ${topic.title}\n\n${topic.body}\n`;
  fs.writeFileSync(filePath, content, 'utf8');

  console.log(`下書きを作成しました（${index + 1}/${topics.length}件目）: note-drafts/${filename}`);
}

main();
