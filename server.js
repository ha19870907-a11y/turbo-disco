const path = require("path");
const express = require("express");

const { getDay, CACHE_TTL_MS } = require("./src/turnmarkClient");
const { predictRace } = require("./src/predictor");
const { stadiumName } = require("./src/stadiums");
const { todayJst, isValidDate } = require("./src/dateUtil");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

function raceStatus(race) {
  if (race.result) return "finished";
  if (race.odds && race.odds.win) return "odds";
  if (race.preview) return "preview";
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
    const { data, source, fetchedAt, error } = await getDay(date, { forceSample: sample });
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

    res.json({ date, source, fetchedAt, error: error || null, stadiums: list });
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
    const { data, source, fetchedAt, error } = await getDay(date, { forceSample: sample });
    const stadiumData = data?.programs?.stadiums?.[stadium];
    if (!stadiumData) {
      return res.json({ date, source, fetchedAt, stadiumNumber: Number(stadium), races: [] });
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
    const { data, source, fetchedAt, error } = await getDay(date, { forceSample: sample });
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

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "サーバーエラーが発生しました" });
});

app.listen(PORT, () => {
  console.log(`競艇予想ツール起動: http://localhost:${PORT}`);
});
