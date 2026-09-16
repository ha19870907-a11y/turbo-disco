const fs = require("fs");
const path = require("path");
const { splitDate } = require("./dateUtil");

// Turnmark(単勝/3連単オッズ込み)を優先し、その日のファイルが無い場合のみ
// 同系統・同スキーマのboatraceopenapi/api(オッズ非対応)にフォールバックする。
// 実際に運用中、Turnmark側だけ当日分の生成が数時間遅れる事象が確認されたため導入。
const SOURCES = [
  { base: "https://turnmark.github.io/api/v1", label: "本サーバー", hasOdds: true },
  { base: "https://raw.githubusercontent.com/turnmark/api/gh-pages/docs/v1", label: "ミラー", hasOdds: true },
  { base: "https://boatraceopenapi.github.io/api/v1", label: "代替データ", hasOdds: false },
  { base: "https://raw.githubusercontent.com/boatraceopenapi/api/gh-pages/docs/v1", label: "代替データミラー", hasOdds: false },
];

// メインデータ源にオッズが無い場合(=fallback使用時)に補完する、別プロジェクトのオッズ専用API。
// BoatraceOpenAPI/previews を元に約30分間隔で更新されており、単勝/3連単ともスキーマがTurnmarkと同じ形。
const ODDS_SOURCES = [
  { base: "https://lamrongol.github.io/BoatraceOdds/v3", label: "オッズ補完" },
  { base: "https://raw.githubusercontent.com/lamrongol/BoatraceOdds/gh-pages/docs/v3", label: "オッズ補完ミラー" },
];

// 元データの更新間隔(約3分)より短い周期でポーリングして反映を早める。
// 画面側の自動更新間隔(30秒)より確実に短くし、毎回のポーリングで必ずキャッシュが
// 失効している状態にすることで、「更新されたのに画面には1周期遅れで反映される」事故を防ぐ。
const CACHE_TTL_MS = 25 * 1000;
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
  for (const src of SOURCES) {
    try {
      const data = await fetchWithTimeout(urlFor(src.base, date));
      return { data, usedFallback: !src.hasOdds };
    } catch (err) {
      errors.push(`${src.label}: ${err.message}`);
    }
  }
  throw new Error(`データ取得に失敗しました: ${errors.join(" / ")}`);
}

// BoatraceOddsのフィールド名(*_odds)をTurnmark側のキー名に合わせて変換する。
const ODDS_FIELD_MAP = {
  win_odds: "win",
  place_odds: "place",
  exacta_odds: "exacta",
  quinella_odds: "quinella",
  quinella_place_odds: "quinella_place",
  trifecta_odds: "trifecta",
  trio_odds: "trio",
};

async function fetchSupplementalOdds(date) {
  for (const src of ODDS_SOURCES) {
    try {
      const data = await fetchWithTimeout(urlFor(src.base, date));
      if (Array.isArray(data?.odds)) return data.odds;
    } catch {
      // 補完データは無くてもアプリは動くので、失敗は無視して次のソースへ
    }
  }
  return null;
}

// メインデータ源(usedFallback時)に odds が無いレースへ、補完APIの単勝/3連単等を差し込む。
// 1件でも実際に補えたら true を返す(true の場合のみ「補完データ使用」の表示に切り替える)。
function mergeSupplementalOdds(dayData, oddsList) {
  if (!Array.isArray(oddsList) || oddsList.length === 0) return false;
  const stadiums = dayData?.programs?.stadiums || {};
  let merged = false;
  for (const entry of oddsList) {
    const race = stadiums[String(entry.stadium_number)]?.races?.[String(entry.number)];
    if (!race || race.odds) continue;
    const odds = {};
    for (const [srcKey, destKey] of Object.entries(ODDS_FIELD_MAP)) {
      if (entry[srcKey] != null) odds[destKey] = entry[srcKey];
    }
    if (Object.keys(odds).length === 0) continue;
    race.odds = odds;
    merged = true;
  }
  return merged;
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
    const { data, usedFallback } = await fetchLive(date);
    let oddsSupplemented = false;
    if (usedFallback) {
      const oddsList = await fetchSupplementalOdds(date);
      oddsSupplemented = mergeSupplementalOdds(data, oddsList);
    }
    const entry = { data, fetchedAt: Date.now(), usedFallback, oddsSupplemented };
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
