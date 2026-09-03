#!/usr/bin/env node
'use strict';

// 子育て・補助金に関する投稿を、1日3回(8:00/13:00/20:00 JST)順番にThreadsへ自動投稿するスクリプト。
// 実行時刻(JST)から自動でどのスロット(0/1/2)かを判定するため、GitHub Actionsの
// scheduleが多少遅延したり、手動で再実行しても、常にその時刻にふさわしい内容が選ばれる。

const { postToThreads } = require('./post-thread.js');

const topics = require('./thread-topics.json');
const SLOTS_PER_DAY = 3;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function slotForNow(now = new Date()) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const hour = jst.getUTCHours();
  // 8:00 JST枠 / 13:00 JST枠 / 20:00 JST枠 の境界はそれぞれの中間点に置く
  const slot = hour < 10 ? 0 : hour < 16 ? 1 : 2;

  const start = Date.UTC(jst.getUTCFullYear(), 0, 1);
  const diff = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - start;
  const dayOfYear = Math.floor(diff / 86400000);

  return { dayOfYear, slot };
}

async function main() {
  const { dayOfYear, slot } = slotForNow();
  const index = (dayOfYear * SLOTS_PER_DAY + slot) % topics.length;
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
