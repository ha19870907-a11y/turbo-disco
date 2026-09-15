// 競艇予想スコアリングエンジン（ブラウザ版 / ESモジュール）。
// ロジックは src/predictor.js（Node/サーバー版）と同一。変更する場合は両方に反映してください。
//
// 統計値（全国/当地勝率、モーター/ボート成績）に加え、直前情報が公開された時点で
// 進入コース・展示タイム・スタート展示を取り込んで再計算する。予想は目安であり、
// 的中を保証するものではない。

// 全国平均のコース別1着率（%）。競艇はイン逃げの決着率が突出して高く、
// 単独の説明変数としては最も強いため、コース確定後は大きめの重みを与える。
export const COURSE_WIN_RATE = { 1: 55, 2: 14, 3: 12, 4: 10, 5: 6, 6: 3 };

// 場番号(stadium_number)ごとの1コース1着率（%）の目安値。
// 淡水・静水面の場（大村・徳山・下関・びわこ・住之江・尼崎など）はインの決着率が高く、
// 汽水・潮位差の大きい場（戸田・江戸川・鳴門・平和島など）はインが弱く荒れやすい傾向がある。
// 各種公開統計（艇国データバンク等）で公表されている水準の目安であり、シーズン・集計期間に
// よって変動するため、あくまで参考値として扱う。
export const STADIUM_COURSE1_RATE = {
  1: 55, // 桐生
  2: 43, // 戸田
  3: 44, // 江戸川
  4: 49, // 平和島
  5: 52, // 多摩川
  6: 52, // 浜名湖
  7: 55, // 蒲郡
  8: 51, // 常滑
  9: 51, // 津
  10: 51, // 三国
  11: 58, // びわこ
  12: 57, // 住之江
  13: 57, // 尼崎
  14: 49, // 鳴門
  15: 51, // 丸亀
  16: 54, // 児島
  17: 50, // 宮島
  18: 62, // 徳山
  19: 61, // 下関
  20: 54, // 若松
  21: 51, // 芦屋
  22: 54, // 福岡
  23: 55, // 唐津
  24: 63, // 大村
};

// 場ごとの2〜6コースの内訳統計までは公開データから精度良く得られないため、
// 全国平均の2〜6コースの分布形状を保ったまま、その場の1コース1着率に合わせて
// 比例配分する。1コースが強い場ほど2〜6コースの取り分は相対的に小さくなる。
function courseWinRateForStadium(stadiumNumber) {
  const course1Rate = STADIUM_COURSE1_RATE[stadiumNumber];
  if (!course1Rate) return COURSE_WIN_RATE;
  const nationalRemaining = 100 - COURSE_WIN_RATE[1];
  const remaining = 100 - course1Rate;
  const rate = { 1: course1Rate };
  for (let c = 2; c <= 6; c++) {
    rate[c] = (COURSE_WIN_RATE[c] / nationalRemaining) * remaining;
  }
  return rate;
}

// 競艇はイン(1コース)の決着率が突出して高く、選手・モーター成績が多少劣っていても
// 進入コースの優位性が上回るケースが大半のため、コース関連の重みを他の指標の合計より
// 大きく取ることで「大外の好成績艇がイン逃げを過大に上回る」誤判定を避けている。
export const WEIGHTS = {
  nationalWinRate: 14,
  localWinRate: 10,
  motorTop2: 10,
  boatTop2: 5,
  avgStartTiming: 6, // 直前情報が無いときのみ使用
  course: 38, // 直前情報が公開されてから使用。単独では最大の重みだが、他艇が
  // 各指標で軒並み上回る場合には逆転しうる程度に留めている。
  previewStartTiming: 8, // 直前情報が公開されてから avgStartTiming の代わりに使用
  exhibitionTime: 8,
  tiltAdjustment: 2,
};

const SOFTMAX_TEMPERATURE = 16;

function minMaxNormalize(values) {
  const present = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (present.length === 0) return values.map(() => 0.5);
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) =>
    v === null || v === undefined || Number.isNaN(v) ? 0.5 : (v - min) / (max - min)
  );
}

function isRoughWeather(preview) {
  if (!preview) return false;
  const windRough = typeof preview.wind_speed === "number" && preview.wind_speed >= 6;
  const waveRough = typeof preview.wave_height === "number" && preview.wave_height >= 5;
  return windRough || waveRough;
}

// 代替データソース(boatraceopenapi/api)は、直前情報がまだスクレイピングされていない
// レースでも preview オブジェクト自体は(全フィールドnullの状態で)存在することがある。
// racers 配下が「オブジェクトとしてある」だけでなく実際に値が入っているかまで確認する。
function hasRealPreview(preview) {
  return !!(
    preview &&
    preview.racers &&
    Object.values(preview.racers).some((r) => r.course_number !== null && r.course_number !== undefined)
  );
}

/**
 * @param {object} race turnmark API の races.{n} オブジェクト
 * @returns {object} 予想結果
 */
export function predictRace(race) {
  const entries = Object.keys(race.racers).sort((a, b) => Number(a) - Number(b));
  const preview = hasRealPreview(race.preview) ? race.preview : null;
  const odds = race.odds || null;
  const hasPreview = !!(preview && preview.racers);
  const rough = isRoughWeather(preview);
  const courseWeight = rough ? WEIGHTS.course * 0.7 : WEIGHTS.course;
  const courseWinRate = courseWinRateForStadium(race.stadium_number);

  const raw = {
    nationalWinRate: [],
    localWinRate: [],
    motorTop2: [],
    boatTop2: [],
    avgStartTiming: [],
    startTiming: [],
    exhibitionTime: [],
    tiltAdjustment: [],
  };

  for (const key of entries) {
    const r = race.racers[key];
    const p = hasPreview ? preview.racers[key] : null;
    raw.nationalWinRate.push(r.national_win_rate ?? null);
    raw.localWinRate.push(r.local_win_rate ?? null);
    raw.motorTop2.push(r.motor_top_2_percent ?? null);
    raw.boatTop2.push(r.boat_top_2_percent ?? null);
    raw.avgStartTiming.push(r.average_start_timing ?? null);
    raw.startTiming.push(p ? p.start_timing ?? null : null);
    raw.exhibitionTime.push(p ? p.exhibition_time ?? null : null);
    raw.tiltAdjustment.push(p ? p.tilt_adjustment ?? null : null);
  }

  const n = {
    nationalWinRate: minMaxNormalize(raw.nationalWinRate),
    localWinRate: minMaxNormalize(raw.localWinRate),
    motorTop2: minMaxNormalize(raw.motorTop2),
    boatTop2: minMaxNormalize(raw.boatTop2),
    // ST・展示タイムは速いほど良いので反転
    avgStartTiming: minMaxNormalize(raw.avgStartTiming.map((v) => (v === null ? null : -v))),
    startTiming: minMaxNormalize(raw.startTiming.map((v) => (v === null ? null : -v))),
    exhibitionTime: minMaxNormalize(raw.exhibitionTime.map((v) => (v === null ? null : -v))),
    tiltAdjustment: minMaxNormalize(raw.tiltAdjustment),
  };

  const results = entries.map((key, i) => {
    const r = race.racers[key];
    const p = hasPreview ? preview.racers[key] : null;
    const courseNumber = hasPreview && p ? p.course_number : Number(key);

    let score =
      WEIGHTS.nationalWinRate * n.nationalWinRate[i] +
      WEIGHTS.localWinRate * n.localWinRate[i] +
      WEIGHTS.motorTop2 * n.motorTop2[i] +
      WEIGHTS.boatTop2 * n.boatTop2[i];

    if (hasPreview) {
      const coursePoint = courseNumber ? courseWinRate[courseNumber] ?? 3 : 3;
      score += courseWeight * (coursePoint / courseWinRate[1]);
      score += WEIGHTS.previewStartTiming * n.startTiming[i];
      score += WEIGHTS.exhibitionTime * n.exhibitionTime[i];
      score += WEIGHTS.tiltAdjustment * n.tiltAdjustment[i];
    } else {
      score += WEIGHTS.avgStartTiming * n.avgStartTiming[i];
      // 直前情報が無い段階では枠番をそのまま暫定コースとして軽めに加点
      const coursePoint = courseWinRate[Number(key)] ?? 3;
      score += (courseWeight * 0.5) * (coursePoint / courseWinRate[1]);
    }

    return {
      entryNumber: Number(key),
      name: r.name,
      registrationNumber: r.number,
      rank: r.rank_number_source,
      branch: r.branch_number_source,
      motorNumber: r.motor_number,
      boatNumber: r.boat_number,
      nationalWinRate: r.national_win_rate,
      localWinRate: r.local_win_rate,
      motorTop2: r.motor_top_2_percent,
      boatTop2: r.boat_top_2_percent,
      averageStartTiming: r.average_start_timing,
      courseNumber,
      startTiming: p ? p.start_timing : null,
      exhibitionTime: p ? p.exhibition_time : null,
      tiltAdjustment: p ? p.tilt_adjustment : null,
      propellerChanged: p ? p.propeller !== null : null,
      score,
    };
  });

  // Softmax で勝率(%)に変換
  const maxScore = Math.max(...results.map((r) => r.score));
  const expScores = results.map((r) => Math.exp((r.score - maxScore) / SOFTMAX_TEMPERATURE));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  results.forEach((r, i) => {
    r.winProbability = expScores[i] / sumExp;
  });

  results.sort((a, b) => b.winProbability - a.winProbability);
  const marks = ["◎", "○", "▲", "△", "×", "×"];
  results.forEach((r, i) => {
    r.mark = marks[i] ?? "";
    r.predictedRank = i + 1;
  });

  // 単勝オッズがあれば期待値(EV = 勝率 × オッズ)を算出し、妙味のある艇を検出
  if (odds && odds.win) {
    for (const r of results) {
      const winOdds = odds.win[String(r.entryNumber)];
      if (typeof winOdds === "number") {
        r.winOdds = winOdds;
        r.expectedValue = r.winProbability * winOdds;
      } else {
        r.winOdds = null;
        r.expectedValue = null;
      }
    }
  }

  const hasOdds = !!(odds && odds.win);
  const trifectaBox = buildComboProbabilities(results.slice(0, 3).map((r) => r.entryNumber), 3, results, odds);
  trifectaBox.sort((a, b) => b.probability - a.probability);

  const ana = buildAnaPicks(results, odds, hasOdds);

  return {
    hasPreview,
    roughWeather: rough,
    weather: preview
      ? {
          weatherText: preview.weather_number_source,
          windSpeed: preview.wind_speed,
          windDirectionText: preview.wind_direction_number_source,
          waveHeight: preview.wave_height,
          airTemperature: preview.air_temperature,
          waterTemperature: preview.water_temperature,
        }
      : null,
    racers: results,
    trifectaBox,
    longshotRacers: ana.longshotRacers,
    anaCombos: ana.anaCombos,
    hasOdds,
  };
}

// 配列 arr から重複無しで k 個選んで並べる順列をすべて列挙する（k=3, arrの長さ=nなら n×(n-1)×(n-2) 通り）
function permutationsOfSize(arr, k) {
  if (k === 0) return [[]];
  const out = [];
  arr.forEach((item, i) => {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutationsOfSize(rest, k - 1)) out.push([item, ...p]);
  });
  return out;
}

// entryNumbers の中から3艇を選ぶ全順列について、Plackett-Luceモデルで3連単の確率・
// オッズ・期待値を算出する。
function buildComboProbabilities(entryNumbers, size, results, odds) {
  if (entryNumbers.length < size) return [];
  const strengths = {};
  for (const r of results) strengths[r.entryNumber] = Math.max(r.winProbability, 1e-6);
  const totalStrength = Object.values(strengths).reduce((a, b) => a + b, 0);

  return permutationsOfSize(entryNumbers, size).map((order) => {
    let remaining = totalStrength;
    let prob = 1;
    for (const entry of order) {
      const s = strengths[entry];
      prob *= s / remaining;
      remaining -= s;
    }
    const oddsValue = odds && odds.trifecta
      ? odds.trifecta?.[String(order[0])]?.[String(order[1])]?.[String(order[2])] ?? null
      : null;
    return {
      combination: order.join("-"),
      probability: prob,
      odds: oddsValue,
      expectedValue: typeof oddsValue === "number" ? prob * oddsValue : null,
    };
  });
}

// 「穴」候補を抽出する。
// - longshotRacers: 本命(1位)以外の艇のうち、単勝の期待値(オッズ公開後)または予想勝率が高い順
// - anaCombos: 上位5艇の中から、1着が本命以外になる3連単の組み合わせを期待値/確率順に抽出
// オッズが未公開の間は期待値を出せないため、予想勝率ベースの参考表示に留める。
function buildAnaPicks(results, odds, hasOdds) {
  const longshotRacers = results
    .filter((r) => r.predictedRank >= 3)
    .filter((r) => !hasOdds || typeof r.expectedValue === "number")
    .sort((a, b) => (hasOdds ? (b.expectedValue ?? 0) - (a.expectedValue ?? 0) : b.winProbability - a.winProbability))
    .slice(0, 3);

  const topPickEntry = results[0]?.entryNumber;
  const pool = results.slice(0, 5).map((r) => r.entryNumber);
  const anaCombos = buildComboProbabilities(pool, 3, results, odds)
    .filter((c) => Number(c.combination.split("-")[0]) !== topPickEntry)
    .sort((a, b) => (hasOdds ? (b.expectedValue ?? 0) - (a.expectedValue ?? 0) : b.probability - a.probability))
    .slice(0, 5);

  return { longshotRacers, anaCombos };
}
