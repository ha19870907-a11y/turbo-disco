// 過去の実績・得意コース集計(Node版)。
// Turnmark APIには「選手の過去成績」を直接返すエンドポイントが無いため、
// 直近N日分の日別データを取得して該当選手(登録番号)のレースを横断的に検索する。
// 過去の確定済みの日のデータは内容が変わらないため、プロセス存続中は無期限にキャッシュする。
const { stadiumName } = require("./stadiums");

const PRIMARY_BASE = "https://turnmark.github.io/api/v1";
const MIRROR_BASE = "https://raw.githubusercontent.com/turnmark/api/gh-pages/docs/v1";
const FETCH_TIMEOUT_MS = 12000;
const FETCH_CONCURRENCY = 3;
const DEFAULT_LOOKBACK_DAYS = 10;

const dayCache = new Map(); // date -> data

function urlFor(base, date) {
  return `${base}/${date.slice(0, 4)}/${date}.json`;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDayRaw(date) {
  for (const base of [PRIMARY_BASE, MIRROR_BASE]) {
    try {
      return await fetchWithTimeout(urlFor(base, date));
    } catch {
      // 次のミラーを試す。両方失敗したらその日は諦める(欠損として扱う)。
    }
  }
  return null;
}

function shiftDate(dateStr, deltaDays) {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(4, 6)) - 1;
  const d = Number(dateStr.slice(6, 8));
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/**
 * baseDate（表示中のレース日）より前の lookbackDays 日分を取得する。
 */
async function fetchRecentDays(baseDate, lookbackDays) {
  const dates = [];
  for (let i = 1; i <= lookbackDays; i++) dates.push(shiftDate(baseDate, -i));

  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < dates.length) {
      const date = dates[idx++];
      let data = dayCache.get(date);
      if (!data) {
        data = await fetchDayRaw(date);
        if (data) dayCache.set(date, data);
      }
      if (data) results.push({ date, data });
    }
  }

  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  return results;
}

/**
 * 指定した登録番号の選手について、複数日分のデータから直近成績・コース別成績を集計する。
 * フライング・出遅れ・欠場などの異常着(place_numberが1〜6以外)は集計対象から除外する。
 */
function buildRacerHistory(dayDatasets, registrationNumber) {
  const entries = [];
  for (const { date, data } of dayDatasets) {
    const stadiums = data?.programs?.stadiums || {};
    for (const [stNum, stadium] of Object.entries(stadiums)) {
      for (const [raceNum, race] of Object.entries(stadium.races || {})) {
        if (!race.result) continue;
        const racerEntry = Object.values(race.racers || {}).find((r) => r.number === registrationNumber);
        if (!racerEntry) continue;
        const resultEntry = race.result.racers?.[String(racerEntry.entry_number)];
        if (!resultEntry) continue;
        const place = resultEntry.place_number;
        if (typeof place !== "number" || place < 1 || place > 6) continue;
        entries.push({
          date,
          stadiumNumber: Number(stNum),
          stadiumName: stadiumName(stNum),
          raceNumber: Number(raceNum),
          courseNumber: resultEntry.course_number ?? null,
          placeNumber: place,
        });
      }
    }
  }

  entries.sort((a, b) => (a.date === b.date ? b.raceNumber - a.raceNumber : a.date < b.date ? 1 : -1));

  const courseStats = {};
  for (const e of entries) {
    if (!e.courseNumber) continue;
    const s = courseStats[e.courseNumber] || { races: 0, wins: 0, top3: 0, placeSum: 0 };
    s.races += 1;
    if (e.placeNumber === 1) s.wins += 1;
    if (e.placeNumber <= 3) s.top3 += 1;
    s.placeSum += e.placeNumber;
    courseStats[e.courseNumber] = s;
  }

  let bestCourse = null;
  let bestRate = -1;
  for (const [course, s] of Object.entries(courseStats)) {
    if (s.races < 2) continue;
    const rate = s.wins / s.races;
    const currentBestRaces = bestCourse !== null ? courseStats[bestCourse].races : 0;
    if (rate > bestRate || (rate === bestRate && s.races > currentBestRaces)) {
      bestRate = rate;
      bestCourse = Number(course);
    }
  }

  return {
    totalRaces: entries.length,
    recentResults: entries.slice(0, 8),
    courseStats,
    bestCourse,
  };
}

module.exports = { fetchRecentDays, buildRacerHistory, DEFAULT_LOOKBACK_DAYS };
