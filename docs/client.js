// ブラウザから直接 Turnmark Boatrace Open API を取得するクライアント。
// GitHub Pages は静的ホスティングのみのため、サーバーを介さずここで
// フェッチ・キャッシュ・日付処理・レース一覧の組み立てまで行う。
import { predictRace } from "./predictor.js";
import { stadiumName } from "./stadiums.js";

const PRIMARY_BASE = "https://turnmark.github.io/api/v1";
const MIRROR_BASE = "https://raw.githubusercontent.com/turnmark/api/gh-pages/docs/v1";
const CACHE_TTL_MS = 60 * 1000; // 元データの更新間隔(約3分)より短い周期でポーリングして反映を早める
const FETCH_TIMEOUT_MS = 10 * 1000;

const memoryCache = new Map(); // date -> { data, fetchedAt }

export function todayJst() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function isValidDate(dateStr) {
  return /^\d{8}$/.test(dateStr);
}

function urlFor(base, date) {
  const year = date.slice(0, 4);
  return `${base}/${year}/${date}.json`;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLive(date) {
  const errors = [];
  for (const base of [PRIMARY_BASE, MIRROR_BASE]) {
    try {
      return await fetchWithTimeout(urlFor(base, date));
    } catch (err) {
      errors.push(`${base.includes("githubusercontent") ? "ミラー" : "本サーバー"}: ${err.message}`);
    }
  }
  throw new Error(`データ取得に失敗しました (${errors.join(" / ")})`);
}

let fixturePromise = null;
function loadFixture() {
  if (!fixturePromise) {
    fixturePromise = fetch("fixtures/sample-20260401.json").then((r) => {
      if (!r.ok) throw new Error(`サンプルデータの読み込みに失敗しました (HTTP ${r.status})`);
      return r.json();
    });
  }
  return fixturePromise;
}

/**
 * @param {string} date YYYYMMDD
 * @param {{forceSample?: boolean}} opts
 */
export async function getDay(date, opts = {}) {
  if (opts.forceSample) {
    const data = await loadFixture();
    return { data, source: "sample", fetchedAt: Date.now() };
  }

  const cached = memoryCache.get(date);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached, source: "cache" };
  }

  try {
    const data = await fetchLive(date);
    const entry = { data, fetchedAt: Date.now() };
    memoryCache.set(date, entry);
    return { ...entry, source: "live" };
  } catch (err) {
    if (cached) {
      return { ...cached, source: "stale-cache", error: err.message };
    }
    throw err;
  }
}

function raceStatus(race) {
  if (race.result) return "finished";
  if (race.odds && race.odds.win) return "odds";
  if (race.preview) return "preview";
  return "scheduled";
}

export function buildStadiumList(dayData) {
  const stadiums = dayData?.programs?.stadiums || {};
  return Object.keys(stadiums)
    .map((num) => {
      const races = stadiums[num].races || {};
      const raceNumbers = Object.keys(races);
      const statuses = raceNumbers.map((rn) => raceStatus(races[rn]));
      return {
        stadiumNumber: Number(num),
        name: stadiumName(num),
        raceCount: raceNumbers.length,
        finishedCount: statuses.filter((s) => s === "finished").length,
      };
    })
    .sort((a, b) => a.stadiumNumber - b.stadiumNumber);
}

export function buildRaceList(dayData, stadium) {
  const stadiumData = dayData?.programs?.stadiums?.[stadium];
  if (!stadiumData) return { stadiumNumber: Number(stadium), stadiumName: stadiumName(stadium), races: [] };
  const races = Object.keys(stadiumData.races)
    .sort((a, b) => Number(a) - Number(b))
    .map((rn) => {
      const race = stadiumData.races[rn];
      return {
        raceNumber: Number(rn),
        title: race.title,
        subtitle: race.subtitle,
        closedAt: race.closed_at,
        status: raceStatus(race),
      };
    });
  return { stadiumNumber: Number(stadium), stadiumName: stadiumName(stadium), races };
}

export function buildRaceDetail(dayData, stadium, raceNumber) {
  const race = dayData?.programs?.stadiums?.[stadium]?.races?.[raceNumber];
  if (!race) return null;

  const prediction = predictRace(race);

  return {
    stadiumNumber: Number(stadium),
    stadiumName: stadiumName(stadium),
    raceNumber: Number(raceNumber),
    title: race.title,
    subtitle: race.subtitle,
    closedAt: race.closed_at,
    status: raceStatus(race),
    result: race.result
      ? {
          techniqueText: race.result.technique_number_source,
          racers: Object.values(race.result.racers).sort((a, b) => a.place_number - b.place_number),
          payouts: race.result.payouts,
        }
      : null,
    prediction,
  };
}
