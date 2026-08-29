#!/usr/bin/env node
'use strict';

// 子育て・補助金に関する投稿を、日替わりで順番にThreadsへ自動投稿するスクリプト。
// GitHub Actionsのscheduleトリガーから毎日呼び出す想定。

const { postToThreads } = require('./post-thread.js');

const topics = require('./thread-topics.json');

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const diff = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start;
  return Math.floor(diff / 86400000);
}

async function main() {
  const index = dayOfYear(new Date()) % topics.length;
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
