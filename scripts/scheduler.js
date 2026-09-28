'use strict';

// 曜日別スケジュール(weekly-schedule.json)と投稿テンプレート(thread-templates.json)から、
// 「今何を投稿すべきか」を決めるための純粋なロジック集。
// - resolveSlot: 現在時刻(JST)から曜日・スロット番号を判定する
// - pickTemplate: スロットの条件(ジャンル/カテゴリー)に合い、かつ直近の投稿と
//   テンプレート・ジャンル×切り口が被らないテンプレートを選ぶ
//   (STEP4: weightsを渡すと、候補プール内での抽選確率をwinning-patterns.jsが
//    算出した実績スコアで重み付けする。スロットの条件判定・重複回避の範囲は
//    一切変えず、絞り込んだ候補プールの中でどれを選びやすくするかだけに影響する。
//    weights省略時は従来通りの完全ランダム抽選のまま。)

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HISTORY_LOOKBACK = 15;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function resolveSlot(schedule, now = new Date()) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const dayKey = DAY_KEYS[jst.getUTCDay()];
  const daySlots = schedule[dayKey];
  if (!daySlots || daySlots.length === 0) {
    throw new Error(`weekly-schedule.jsonに${dayKey}の設定がありません。`);
  }

  const nowMinutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const times = daySlots.map((s) => toMinutes(s.time));

  // 各スロットの境界は、隣り合うスロット時刻の中間点に置く(実行が多少遅延しても
  // その時刻にふさわしいスロットが選ばれるようにするため)。
  let slotIndex = 0;
  for (let i = 1; i < times.length; i += 1) {
    const boundary = (times[i - 1] + times[i]) / 2;
    if (nowMinutes >= boundary) slotIndex = i;
  }

  const date = `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;

  return { dayKey, slotIndex, date, slot: daySlots[slotIndex] };
}

function weightedPick(pool, weightFn) {
  const weights = pool.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) {
    // 重みが全て0以下など異常な場合は従来通りの一様ランダムにフォールバックする。
    return pool[Math.floor(Math.random() * pool.length)];
  }
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function pickTemplate(templates, history, slotConfig, getWeight) {
  const lookback = history.slice(-HISTORY_LOOKBACK);
  const recentTemplateIds = new Set(lookback.map((h) => h.templateId));
  const lastAngleByGenre = new Map();
  for (const entry of lookback) {
    lastAngleByGenre.set(entry.genre, entry.angle);
  }
  const lastEntry = history[history.length - 1];

  function matches(template, opts) {
    if (opts.requireCategory && slotConfig.categories && !slotConfig.categories.includes(template.category)) {
      return false;
    }
    if (opts.requireGenre && slotConfig.genres && !slotConfig.genres.includes(template.genre)) {
      return false;
    }
    // 直前の投稿と全く同じテンプレートは、条件をどれだけ緩めても選ばない。
    if (lastEntry && lastEntry.templateId === template.id) return false;
    if (opts.avoidRecent && recentTemplateIds.has(template.id)) return false;
    if (opts.avoidGenreAngle && lastAngleByGenre.get(template.genre) === template.angle) return false;
    return true;
  }

  // 条件に合う候補が見つからない場合は、優先順位を保ちながら段階的に条件を緩める。
  const attempts = [
    { requireCategory: true, requireGenre: true, avoidRecent: true, avoidGenreAngle: true },
    { requireCategory: true, requireGenre: true, avoidRecent: true, avoidGenreAngle: false },
    { requireCategory: true, requireGenre: true, avoidRecent: false, avoidGenreAngle: false },
    { requireCategory: true, requireGenre: false, avoidRecent: true, avoidGenreAngle: false },
    { requireCategory: false, requireGenre: true, avoidRecent: true, avoidGenreAngle: false },
    { requireCategory: false, requireGenre: false, avoidRecent: false, avoidGenreAngle: false },
  ];

  for (const opts of attempts) {
    const pool = templates.filter((template) => matches(template, opts));
    if (pool.length > 0) {
      return typeof getWeight === 'function' ? weightedPick(pool, getWeight) : pool[Math.floor(Math.random() * pool.length)];
    }
  }

  throw new Error('条件に合う投稿テンプレートが見つかりませんでした。');
}

module.exports = { DAY_KEYS, resolveSlot, pickTemplate };
