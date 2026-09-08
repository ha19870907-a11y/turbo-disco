#!/usr/bin/env node
'use strict';

// 子育て・補助金に関する投稿を、曜日・時間帯ごとに割り当てたジャンル/カテゴリー設定
// (weekly-schedule.json)に沿ってThreadsへ自動投稿するスクリプト。
// GitHub Actionsのscheduleトリガー(曜日ごとに異なる時刻)から呼び出す想定。
// 実行時刻(JST)から自動で曜日・スロットを判定するため、scheduleが多少遅延したり
// 手動で再実行しても、常にその時刻にふさわしいジャンルが選ばれる。
// 直近の投稿履歴(thread-post-history.json)を見て、同じテンプレート・同じ制度×切り口の
// 連続使用を避けるローテーションを行う(scripts/scheduler.js)。

const fs = require('node:fs');
const path = require('node:path');

const { postToThreads } = require('./post-thread.js');
const { resolveSlot, pickTemplate } = require('./scheduler.js');

const templates = require('./thread-templates.json');
const schedule = require('./weekly-schedule.json');

const HISTORY_FILE = path.join(__dirname, '..', 'thread-post-history.json');
const HISTORY_KEEP = 200;

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeHistory(history) {
  const trimmed = history.slice(-HISTORY_KEEP);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2) + '\n', 'utf8');
}

async function main() {
  const history = readHistory();
  const { dayKey, slotIndex, date, slot } = resolveSlot(schedule);

  // 同じ日・同じスロットに既に投稿済みなら、Actionsの再実行等による二重投稿を避ける。
  const alreadyPosted = history.some(
    (entry) => entry.date === date && entry.dayKey === dayKey && entry.slotIndex === slotIndex
  );
  if (alreadyPosted) {
    console.log(`${date}(${dayKey}) ${slot.time}「${slot.label}」は投稿済みのためスキップします。`);
    return;
  }

  const template = pickTemplate(templates, history, slot);

  try {
    const result = await postToThreads(template.text);
    console.log(
      `Threadsに投稿しました（${dayKey} ${slot.time}「${slot.label}」/ ` +
        `テンプレート${template.id} [${template.genre}/${template.category}/${template.angle}] / ID: ${result.id}）`
    );

    history.push({
      date,
      dayKey,
      slotIndex,
      time: slot.time,
      label: slot.label,
      templateId: template.id,
      genre: template.genre,
      category: template.category,
      angle: template.angle,
      threadId: result.id,
      postedAt: new Date().toISOString(),
    });
    writeHistory(history);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
