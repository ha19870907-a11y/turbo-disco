const path = require("path");
const express = require("express");

const { getDay, CACHE_TTL_MS } = require("./src/turnmarkClient");
const { predictRace } = require("./src/predictor");
const { stadiumName } = require("./src/stadiums");
const { todayJst, isValidDate } = require("./src/dateUtil");
const { fetchRecentDays, buildRacerHistory, DEFAULT_LOOKBACK_DAYS } = require("./src/history");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// 代替データソース(boatraceopenapi/api)は、まだ確定していないレースでも
// result/preview オブジェクト自体は(全フィールドnullの状態で)存在することがある。
// 実際に値が入っているかまで確認しないと「確定」等と誤判定してしまう。
function hasRealResult(race) {
  return !!(
    race.result &&
    race.result.racers &&
    Object.values(race.result.racers).some((r) => typeof r.place_number === "number")
  );
}

function hasRealPreview(race) {
  return !!(
    race.preview &&
    race.preview.racers &&
    Object.values(race.preview.racers).some((r) => r.course_number !== null && r.course_number !== undefined)
  );
}

function raceStatus(race) {
  if (hasRealResult(race)) return "finished";
  if (race.odds && race.odds.win) return "odds";
  if (hasRealPreview(race)) return "preview";
  return "scheduled";
}

function parseDateParam(req) {
  const date = req.query.date || todayJst();
  if (!isValidDate(date)) {
    const err = new Error("date は YYYYMMDD 形式で指定してください");
    err.status = 400;
    throw err;
  }
  return date;
}

app.get("/api/meta", (req, res) => {
  res.json({ todayJst: todayJst(), cacheTtlMs: CACHE_TTL_MS });
});

app.get("/api/stadiums", async (req, res, next) => {
  try {
    const date = parseDateParam(req);
    const sample = req.query.sample === "1";
    const { data, source, fetchedAt, error, usedFallback } = await getDay(date, { forceSample: sample });
    const stadiums = data?.programs?.stadiums || {};

    const list = Object.keys(stadiums)
      .map((num) => {
        const races = stadiums[num].races || {};
        const raceNumbers = Object.keys(races).sort((a, b) => Number(a) - Number(b));
        const statuses = raceNumbers.map((rn) => raceStatus(races[rn]));
        return {
          stadiumNumber: Number(num),
          name: stadiumName(num),
          raceCount: raceNumbers.length,
          finishedCount: statuses.filter((s) => s === "finished").length,
        };
      })
      .sort((a, b) => a.stadiumNumber - b.stadiumNumber);

    res.json({ date, source, fetchedAt, error: error || null, usedFallback, stadiums: list });
  } catch (err) {
    next(err);
  }
});

app.get("/api/races", async (req, res, next) => {
  try {
    const date = parseDateParam(req);
    const stadium = req.query.stadium;
    const sample = req.query.sample === "1";
    if (!stadium) {
      const err = new Error("stadium は必須です");
      err.status = 400;
      throw err;
    }
    const { data, source, fetchedAt, error, usedFallback } = await getDay(date, { forceSample: sample });
    const stadiumData = data?.programs?.stadiums?.[stadium];
    if (!stadiumData) {
      return res.json({ date, source, fetchedAt, usedFallback, stadiumNumber: Number(stadium), races: [] });
    }
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
    res.json({
      date,
      source,
      fetchedAt,
      error: error || null,
      usedFallback,
      stadiumNumber: Number(stadium),
      stadiumName: stadiumName(stadium),
      races,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/race", async (req, res, next) => {
  try {
    const date = parseDateParam(req);
    const { stadium, race: raceNumber } = req.query;
    const sample = req.query.sample === "1";
    if (!stadium || !raceNumber) {
      const err = new Error("stadium と race は必須です");
      err.status = 400;
      throw err;
    }
    const { data, source, fetchedAt, error, usedFallback } = await getDay(date, { forceSample: sample });
    const race = data?.programs?.stadiums?.[stadium]?.races?.[raceNumber];
    if (!race) {
      const err = new Error("指定されたレースが見つかりません");
      err.status = 404;
      throw err;
    }

    const prediction = predictRace(race);

    res.json({
      date,
      source,
      fetchedAt,
      error: error || null,
      usedFallback,
      stadiumNumber: Number(stadium),
      stadiumName: stadiumName(stadium),
      raceNumber: Number(raceNumber),
      title: race.title,
      subtitle: race.subtitle,
      closedAt: race.closed_at,
      status: raceStatus(race),
      result: hasRealResult(race)
        ? {
            techniqueText: race.result.technique_number_source,
            racers: Object.values(race.result.racers).sort(
              (a, b) => a.place_number - b.place_number
            ),
            payouts: race.result.payouts,
          }
        : null,
      prediction,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/history", async (req, res, next) => {
  try {
    const date = parseDateParam(req);
    const { stadium, race: raceNumber } = req.query;
    const sample = req.query.sample === "1";
    const lookbackDays = Math.min(Math.max(Number(req.query.lookbackDays) || DEFAULT_LOOKBACK_DAYS, 1), 30);
    if (!stadium || !raceNumber) {
      const err = new Error("stadium と race は必須です");
      err.status = 400;
      throw err;
    }
    if (sample) {
      return res.json({ lookbackDays, daysFetched: 0, racers: [], note: "サンプルモードでは利用できません" });
    }

    const { data } = await getDay(date, {});
    const race = data?.programs?.stadiums?.[stadium]?.races?.[raceNumber];
    if (!race) {
      const err = new Error("指定されたレースが見つかりません");
      err.status = 404;
      throw err;
    }

    const days = await fetchRecentDays(date, lookbackDays);
    const racers = Object.values(race.racers).map((r) => ({
      entryNumber: r.entry_number,
      name: r.name,
      ...buildRacerHistory(days, r.number),
    }));

    res.json({ lookbackDays, daysFetched: days.length, racers });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "サーバーエラーが発生しました" });
});

app.listen(PORT, () => {
  console.log(`競艇予想ツール起動: http://localhost:${PORT}`);
});
