#!/usr/bin/env node
'use strict';

// 子育て・補助金に関する投稿を、曜日・時間帯ごとに割り当てたジャンル/カテゴリー設定
// (weekly-schedule.json)に沿ってXへ自動投稿するスクリプト。
// Threads版(scripts/post-daily-thread.js)と同じテンプレート集(scripts/thread-templates.json)・
// 曜日別配分(scripts/weekly-schedule.json)・ローテーションロジック(scripts/scheduler.js)を
// そのまま再利用しつつ、投稿履歴だけは x-post-history.json に別立てで記録する。
// これにより、ThreadsとXそれぞれ独立してテンプレートのローテーション(直近との重複回避)を行う。
// GitHub Actionsのscheduleトリガー(曜日ごとに異なる時刻)から呼び出す想定。

const fs = require('node:fs');
const path = require('node:path');

const { postToX, postReplyToX } = require('./post-to-x.js');
const { resolveSlot, pickTemplate } = require('./scheduler.js');

const templates = require('./thread-templates.json');
const schedule = require('./weekly-schedule.json');

const HISTORY_FILE = path.join(__dirname, '..', 'x-post-history.json');
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
    const result = await postToX(template.text);
    console.log(
      `Xに投稿しました（${dayKey} ${slot.time}「${slot.label}」/ ` +
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
      tweetId: result.id,
      postedAt: new Date().toISOString(),
    });
    writeHistory(history);

    // クイズ形式のテンプレートは、答え(answerText)をメイン投稿には含めず、
    // 自分の投稿への返信として別立てで投稿する。フィード上では答えが見えず、
    // 投稿を開いてリプ欄を見て初めて答えがわかる構成になる。
    if (template.answerText) {
      try {
        const answerResult = await postReplyToX(template.answerText, result.id);
        console.log(`クイズの答えをリプ欄に投稿しました（ID: ${answerResult.id}）。`);
      } catch (answerErr) {
        console.error(`クイズの答えの投稿に失敗しました(本体の投稿自体は成功しています): ${answerErr.message}`);
      }
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
