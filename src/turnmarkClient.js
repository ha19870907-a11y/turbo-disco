const fs = require("fs");
const path = require("path");
const { splitDate } = require("./dateUtil");

// Turnmark Boatrace Open API: 出走表/直前情報/オッズ/結果を約3分間隔で更新して公開している
// 非公式データソース。GitHub Pages と、その配信元である raw.githubusercontent.com の
// 2系統をミラーとして順に試す（どちらかが到達不能な環境でも動くようにするため）。
const PRIMARY_BASE = "https://turnmark.github.io/api/v1";
const MIRROR_BASE =
  "https://raw.githubusercontent.com/turnmark/api/gh-pages/docs/v1";

const CACHE_TTL_MS = 60 * 1000; // 元データの更新間隔(約3分)より短い周期でポーリングして反映を早める
const FETCH_TIMEOUT_MS = 10 * 1000;

const cache = new Map(); // date -> { data, fetchedAt, source }

function urlFor(base, date) {
  const { year } = splitDate(date);
  return `${base}/${year}/${date}.json`;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
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
      errors.push(`${base}: ${err.message}`);
    }
  }
  throw new Error(`データ取得に失敗しました: ${errors.join(" / ")}`);
}

function loadFixture() {
  const fixturePath = path.join(__dirname, "..", "fixtures", "sample-20260401.json");
  const raw = fs.readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * 指定日のレースデータを取得する。
 * @param {string} date YYYYMMDD
 * @param {{forceSample?: boolean}} opts
 * @returns {Promise<{data: object, source: "live"|"cache"|"sample", fetchedAt: number}>}
 */
async function getDay(date, opts = {}) {
  if (opts.forceSample) {
    return { data: loadFixture(), source: "sample", fetchedAt: Date.now() };
  }

  const cached = cache.get(date);
  const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (isFresh) {
    return { ...cached, source: "cache" };
  }

  try {
    const data = await fetchLive(date);
    const entry = { data, fetchedAt: Date.now() };
    cache.set(date, entry);
    return { ...entry, source: "live" };
  } catch (err) {
    if (cached) {
      // 直近取得分が残っていれば、多少古くてもそれを返す（完全に落とすよりまし）
      return { ...cached, source: "stale-cache", error: err.message };
    }
    throw err;
  }
}

module.exports = { getDay, CACHE_TTL_MS };
