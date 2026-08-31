#!/usr/bin/env node
'use strict';

// 子育て・補助金に関する投稿を、1日3回(8:00/13:00/20:00 JST)順番にThreadsへ自動投稿するスクリプト。
// GitHub Actionsのscheduleトリガーから、SLOT環境変数(0/1/2)付きで呼び出す想定。
// SLOTが無い場合(手動実行時など)は0番目のスロットとして扱う。

const { postToThreads } = require('./post-thread.js');

const topics = require('./thread-topics.json');
const SLOTS_PER_DAY = 3;

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const diff = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start;
  return Math.floor(diff / 86400000);
}

async function main() {
  const slot = Number.parseInt(process.env.SLOT, 10) || 0;
  const index = (dayOfYear(new Date()) * SLOTS_PER_DAY + slot) % topics.length;
  const text = topics[index];
  try {
    const result = await postToThreads(text);
    console.log(`Threadsに投稿しました（${index + 1}/${topics.length}件目, ID: ${result.id}）`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
