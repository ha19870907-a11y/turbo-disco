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

const { postToThreads, postReplyToThreads } = require('./post-thread.js');
const { resolveSlot, pickTemplate } = require('./scheduler.js');
const { readTemplateLinks, registerPostLink } = require('./monetization.js');

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

    // クイズ形式のテンプレートは、答え(answerText)をメイン投稿には含めず、
    // 自分の投稿への返信として別立てで投稿する。フィード上では答えが見えず、
    // 投稿を開いてリプ欄を見て初めて答えがわかる構成になる。
    if (template.answerText) {
      try {
        const answerResult = await postReplyToThreads(template.answerText, result.id);
        console.log(`クイズの答えをリプ欄に投稿しました（ID: ${answerResult.id}）。`);
      } catch (answerErr) {
        console.error(`クイズの答えの投稿に失敗しました(本体の投稿自体は成功しています): ${answerErr.message}`);
      }
    }

    // STEP3.5: このテンプレートに収益導線リンクが紐付けられていれば記録する(任意・追加機能)。
    // 未設定のテンプレートがほとんどのため、通常は何もしない。失敗しても投稿自体は
    // 既に成功しているので、ここでの例外は握りつぶしてログのみ出す。
    try {
      const templateLinks = readTemplateLinks();
      const linkId = templateLinks[template.id];
      if (linkId) {
        registerPostLink({
          postId: result.id,
          linkId,
          templateId: template.id,
          genre: template.genre,
          category: template.category,
          angle: template.angle,
        });
        console.log(`収益導線リンク ${linkId} を投稿 ${result.id} に紐付けて記録しました。`);
      }
    } catch (linkErr) {
      console.error(`収益導線リンクの記録に失敗しました(投稿自体は成功しています): ${linkErr.message}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
