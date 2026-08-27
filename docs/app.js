import { todayJst, isValidDate, getDay, buildStadiumList, buildRaceList, buildRaceDetail } from "./client.js";
import { fetchRecentDays, buildRacerHistory, DEFAULT_LOOKBACK_DAYS } from "./history.js";

const state = {
  date: null,
  sample: false,
  stadium: null,
  race: null,
  pollTimer: null,
  stadiumPollTimer: null,
  loadSeq: 0,
};

const STADIUM_RETRY_MS = 60000; // その日のデータがまだ無い場合、これくらいの間隔で自動的に再試行する

const el = {
  dateInput: document.getElementById("date-input"),
  sampleToggle: document.getElementById("sample-toggle"),
  statusBadge: document.getElementById("status-badge"),
  stadiumPanel: document.getElementById("stadium-list"),
  stadiumGrid: document.getElementById("stadium-grid"),
  racePanel: document.getElementById("race-list"),
  raceListTitle: document.getElementById("race-list-title"),
  raceGrid: document.getElementById("race-grid"),
  detailPanel: document.getElementById("race-detail"),
  detailTitle: document.getElementById("race-detail-title"),
  raceMeta: document.getElementById("race-meta"),
  weatherBox: document.getElementById("weather-box"),
  racerTableWrap: document.getElementById("racer-table-wrap"),
  historyBox: document.getElementById("history-box"),
  trifectaBox: document.getElementById("trifecta-box"),
  anaBox: document.getElementById("ana-box"),
  resultBox: document.getElementById("result-box"),
  backToStadiums: document.getElementById("back-to-stadiums"),
  backToRaces: document.getElementById("back-to-races"),
};

const STATUS_LABEL = {
  scheduled: "出走表のみ",
  preview: "直前情報あり",
  odds: "オッズ確定",
  finished: "確定",
};

function fmtPercent(v) {
  return v === null || v === undefined ? "-" : `${(v * 100).toFixed(1)}%`;
}
function fmtNum(v, digits = 2) {
  return v === null || v === undefined ? "-" : Number(v).toFixed(digits);
}

// 枠番の色は競艇の公式カラー(1白/2黒/3赤/4青/5黄/6緑)に準拠
const WAKU_COLORS = {
  1: { bg: "#ffffff", fg: "#12182a" },
  2: { bg: "#1a1a1a", fg: "#ffffff" },
  3: { bg: "#e02424", fg: "#ffffff" },
  4: { bg: "#1d4ed8", fg: "#ffffff" },
  5: { bg: "#facc15", fg: "#12182a" },
  6: { bg: "#16a34a", fg: "#ffffff" },
};

function wakuBadge(entryNumber) {
  const c = WAKU_COLORS[entryNumber];
  if (!c) return `<span class="waku-badge">${entryNumber}</span>`;
  return `<span class="waku-badge" style="background:${c.bg};color:${c.fg}">${entryNumber}</span>`;
}

function coloredCombo(combination) {
  return combination
    .split("-")
    .map((n) => wakuBadge(Number(n)))
    .join('<span class="combo-sep">-</span>');
}

async function fetchDay(params = {}) {
  const date = params.date ?? state.date;
  if (!isValidDate(date)) throw new Error("日付の形式が正しくありません");
  return getDay(date, { forceSample: state.sample });
}

function setStatusBadge(source, error) {
  el.statusBadge.classList.remove("live", "sample", "error");
  if (error) {
    el.statusBadge.textContent = `取得失敗: ${error}`;
    el.statusBadge.classList.add("error");
    return;
  }
  const labels = {
    live: "🟢 ライブ更新中",
    cache: "🟢 ライブ（キャッシュ）",
    "stale-cache": "🟡 一時的に古いデータ",
    sample: "🟠 サンプルデータ",
  };
  el.statusBadge.textContent = labels[source] || source;
  el.statusBadge.classList.add(source === "sample" ? "sample" : "live");
}

function showPanel(name) {
  el.stadiumPanel.classList.toggle("hidden", name !== "stadiums");
  el.racePanel.classList.toggle("hidden", name !== "races");
  el.detailPanel.classList.toggle("hidden", name !== "detail");
  if (name !== "detail" && state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  if (name !== "stadiums" && state.stadiumPollTimer) {
    clearInterval(state.stadiumPollTimer);
    state.stadiumPollTimer = null;
  }
}

function scheduleStadiumRetry() {
  // 当日分のデータがまだ提供元で生成されていないだけのケースがあるため、
  // 「今日」を表示中でエラー/空だった場合は自動的に再試行する。
  if (state.stadiumPollTimer || state.sample || state.date !== todayJst()) return;
  state.stadiumPollTimer = setInterval(loadStadiums, STADIUM_RETRY_MS);
}

async function loadStadiums() {
  showPanel("stadiums");
  el.stadiumGrid.innerHTML = `<div class="empty-state">読み込み中…</div>`;
  const seq = ++state.loadSeq;
  try {
    const { data, source, error } = await fetchDay();
    if (seq !== state.loadSeq) return;
    setStatusBadge(source, error);
    const stadiums = buildStadiumList(data);
    if (stadiums.length === 0) {
      el.stadiumGrid.innerHTML = `
        <div class="empty-state">
          この日の開催データがまだありません。実際にレースが開催中でも、データ提供元
          （非公式）側の生成が追いついていない場合があります。60秒ごとに自動で再確認しますが、
          今すぐ確認したい場合は下のボタンを押してください。
        </div>
        <div style="text-align:center"><button id="stadium-retry-btn" class="ghost-btn" type="button">今すぐ再確認する</button></div>
      `;
      document.getElementById("stadium-retry-btn")?.addEventListener("click", loadStadiums);
      scheduleStadiumRetry();
      return;
    }
    if (state.stadiumPollTimer) {
      clearInterval(state.stadiumPollTimer);
      state.stadiumPollTimer = null;
    }
    el.stadiumGrid.innerHTML = "";
    for (const s of stadiums) {
      const card = document.createElement("button");
      card.className = "card";
      card.innerHTML = `<div class="name">${s.name}</div><div class="sub">${s.finishedCount}/${s.raceCount} R 確定</div>`;
      card.addEventListener("click", () => {
        state.stadium = s.stadiumNumber;
        loadRaces();
      });
      el.stadiumGrid.appendChild(card);
    }
  } catch (err) {
    if (seq !== state.loadSeq) return;
    setStatusBadge(null, err.message);
    const isToday = state.date === todayJst() && !state.sample;
    el.stadiumGrid.innerHTML = `
      <div class="empty-state">${err.message}${isToday ? "（60秒ごとに自動で再確認します）" : ""}</div>
      ${isToday ? `<div style="text-align:center"><button id="stadium-retry-btn" class="ghost-btn" type="button">今すぐ再確認する</button></div>` : ""}
    `;
    document.getElementById("stadium-retry-btn")?.addEventListener("click", loadStadiums);
    scheduleStadiumRetry();
  }
}

async function loadRaces() {
  showPanel("races");
  el.raceGrid.innerHTML = `<div class="empty-state">読み込み中…</div>`;
  const seq = ++state.loadSeq;
  try {
    const { data, source, error } = await fetchDay();
    if (seq !== state.loadSeq) return;
    setStatusBadge(source, error);
    const result = buildRaceList(data, state.stadium);
    el.raceListTitle.textContent = `${result.stadiumName} - ${state.date}`;
    el.raceGrid.innerHTML = "";
    for (const r of result.races) {
      const card = document.createElement("button");
      card.className = "card race-card";
      card.innerHTML = `
        <span class="race-num">${r.raceNumber}R</span>
        <span class="title">${r.title || ""}</span>
        <span class="tag ${r.status}">${STATUS_LABEL[r.status]}</span>
      `;
      card.addEventListener("click", () => {
        state.race = r.raceNumber;
        loadRaceDetail();
      });
      el.raceGrid.appendChild(card);
    }
  } catch (err) {
    if (seq !== state.loadSeq) return;
    setStatusBadge(null, err.message);
    el.raceGrid.innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function renderWeather(weather) {
  if (!weather) {
    el.weatherBox.innerHTML = `<div class="note">直前情報はまだ公開されていません（レース開始が近づくと表示されます）</div>`;
    return;
  }
  const items = [
    ["天候", weather.weatherText],
    ["風向", weather.windDirectionText],
    ["風速", weather.windSpeed !== null ? `${weather.windSpeed}m` : "-"],
    ["波高", weather.waveHeight !== null ? `${weather.waveHeight}cm` : "-"],
    ["気温", weather.airTemperature !== null ? `${weather.airTemperature}℃` : "-"],
    ["水温", weather.waterTemperature !== null ? `${weather.waterTemperature}℃` : "-"],
  ];
  el.weatherBox.innerHTML = items
    .map(([label, value]) => `<div class="item"><span class="label">${label}</span>${value}</div>`)
    .join("");
}

function renderRacerTable(prediction) {
  const rows = prediction.racers
    .map((r) => {
      const markClass = r.predictedRank <= 3 ? `mark-${r.predictedRank}` : "";
      const evClass = r.expectedValue !== null && r.expectedValue !== undefined
        ? r.expectedValue >= 1.0 ? "ev-good" : "ev-bad"
        : "";
      const evText = r.expectedValue !== null && r.expectedValue !== undefined
        ? r.expectedValue.toFixed(2)
        : "-";
      const isAna = r.predictedRank >= 3 && r.expectedValue !== null && r.expectedValue !== undefined && r.expectedValue >= 1.0;
      return `
      <tr>
        <td class="mark ${markClass}">${r.mark}</td>
        <td>${wakuBadge(r.entryNumber)}</td>
        <td class="name-cell">
          <div class="rname">${r.name}${isAna ? '<span class="ana-tag">穴</span>' : ""}</div>
          <div class="rmeta">${r.rank ?? ""} ${r.branch ?? ""}</div>
        </td>
        <td>${r.courseNumber ?? "-"}</td>
        <td>${fmtNum(r.nationalWinRate)}</td>
        <td>${fmtNum(r.localWinRate)}</td>
        <td>${fmtNum(r.motorTop2, 1)}%</td>
        <td>${r.startTiming !== null ? fmtNum(r.startTiming) : fmtNum(r.averageStartTiming)}</td>
        <td>${fmtNum(r.exhibitionTime)}</td>
        <td>
          <div class="prob-bar-wrap"><div class="prob-bar" style="width:${(r.winProbability * 100).toFixed(0)}%"></div></div>
          ${fmtPercent(r.winProbability)}
        </td>
        <td>${r.winOdds ?? "-"}</td>
        <td class="${evClass}">${evText}</td>
      </tr>`;
    })
    .join("");

  el.racerTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>印</th><th>枠</th><th>選手</th><th>コース</th>
          <th>全国勝率</th><th>当地勝率</th><th>モーター2連率</th>
          <th>ST</th><th>展示T</th><th>予想勝率</th><th>単勝odds</th><th>期待値</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="note">
      期待値 = 予想勝率 × 単勝オッズ。1.00 を上回るほど「妙味あり」の目安です（緑字）。
      コース欄は直前情報公開前は枠番を暫定表示しています。
    </div>
  `;
}

const PLACE_BADGE_CLASS = { 1: "place-1", 2: "place-2", 3: "place-3" };

function renderHistoryPlaceholder(racers) {
  if (state.sample) {
    el.historyBox.innerHTML = `
      <h3>過去実績・得意コース</h3>
      <div class="note">サンプルデータ表示中は利用できません（サンプルは1日分のみのため）。</div>
    `;
    return;
  }
  el.historyBox.innerHTML = `
    <h3>過去実績・得意コース</h3>
    <div class="note">
      直近${DEFAULT_LOOKBACK_DAYS}日分のレース結果を取得して、選手ごとの直近成績と得意コースを集計します。
      日別データ(数MB)をまとめて取得するため、初回は少し時間がかかります。
    </div>
    <button id="history-load-btn" class="ghost-btn" type="button">過去実績を取得する</button>
  `;
  document.getElementById("history-load-btn")?.addEventListener("click", () => loadHistory(racers));
}

async function loadHistory(racers) {
  const btn = document.getElementById("history-load-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "取得中… (0/" + DEFAULT_LOOKBACK_DAYS + "日)";
  }
  const seq = state.loadSeq; // 現在表示中のレースを離れたら結果を破棄する
  try {
    const days = await fetchRecentDays(state.date, DEFAULT_LOOKBACK_DAYS, (done, total) => {
      if (btn) btn.textContent = `取得中… (${done}/${total}日)`;
    });
    if (seq !== state.loadSeq) return;
    if (days.length === 0) {
      el.historyBox.innerHTML = `<h3>過去実績・得意コース</h3><div class="note">過去データを取得できませんでした。</div>`;
      return;
    }
    renderHistoryResults(racers, days);
  } catch (err) {
    if (seq !== state.loadSeq) return;
    el.historyBox.innerHTML = `<h3>過去実績・得意コース</h3><div class="note">取得に失敗しました: ${err.message}</div>`;
  }
}

function renderHistoryResults(racers, days) {
  const rows = racers
    .map((r) => {
      const h = buildRacerHistory(days, r.registrationNumber);
      const recentBadges = h.recentResults
        .map((e) => {
          const cls = PLACE_BADGE_CLASS[e.placeNumber] || "place-other";
          return `<span class="place-badge ${cls}" title="${e.date} ${e.stadiumName}${e.raceNumber}R ${e.courseNumber ?? "-"}コース">${e.placeNumber}</span>`;
        })
        .join("");
      const bestCourseText = h.bestCourse
        ? (() => {
            const s = h.courseStats[h.bestCourse];
            return `${wakuBadge(h.bestCourse)}コース得意 (勝率${((s.wins / s.races) * 100).toFixed(0)}% ${s.races}走)`;
          })()
        : "データ不足";
      return `<div class="combo-row history-row">
        <span class="combo">${wakuBadge(r.entryNumber)} ${r.name}</span>
        <span>${bestCourseText}</span>
        <span class="place-badges">${recentBadges || "直近成績なし"}</span>
        <span class="note-inline">直近${DEFAULT_LOOKBACK_DAYS}日中 ${h.totalRaces}走</span>
      </div>`;
    })
    .join("");

  el.historyBox.innerHTML = `
    <h3>過去実績・得意コース（直近${DEFAULT_LOOKBACK_DAYS}日）</h3>
    <div class="combo-list">${rows}</div>
    <div class="note">得意コースは同一コースで2走以上ある場合のみ判定しています。母数が少ないため参考程度にご覧ください。</div>
  `;
}

function renderTrifecta(prediction) {
  if (!prediction.trifectaBox || prediction.trifectaBox.length === 0) {
    el.trifectaBox.innerHTML = "";
    return;
  }
  const rows = prediction.trifectaBox
    .map((c) => {
      const oddsText = c.odds !== null && c.odds !== undefined ? `${c.odds}倍` : "オッズ未公開";
      const evText = c.expectedValue !== null && c.expectedValue !== undefined
        ? `期待値 ${c.expectedValue.toFixed(2)}`
        : "";
      return `<div class="combo-row">
        <span class="combo">${coloredCombo(c.combination)}</span>
        <span>予想確率 ${fmtPercent(c.probability)}</span>
        <span>${oddsText}</span>
        <span>${evText}</span>
      </div>`;
    })
    .join("");
  el.trifectaBox.innerHTML = `
    <h3>3連単 上位3艇ボックス（推奨買い目）</h3>
    <div class="combo-list">${rows}</div>
    ${prediction.roughWeather ? `<div class="note">⚠️ 強風・高波のためコース有利差が縮まり荒れる可能性があります。</div>` : ""}
  `;
}

function renderAna(prediction) {
  if (!prediction.hasOdds) {
    el.anaBox.innerHTML = `
      <h3>穴狙い</h3>
      <div class="note">オッズが公開されると、期待値の高い穴候補がここに表示されます。</div>
    `;
    return;
  }
  const hasLongshots = prediction.longshotRacers && prediction.longshotRacers.length > 0;
  const hasCombos = prediction.anaCombos && prediction.anaCombos.length > 0;
  if (!hasLongshots && !hasCombos) {
    el.anaBox.innerHTML = `<h3>穴狙い</h3><div class="note">期待値の高い穴候補は見つかりませんでした。</div>`;
    return;
  }

  const racerRows = (prediction.longshotRacers || [])
    .map((r) => `<div class="combo-row">
      <span class="combo">${wakuBadge(r.entryNumber)} ${r.name}</span>
      <span>予想勝率 ${fmtPercent(r.winProbability)}</span>
      <span>単勝 ${r.winOdds ?? "-"}倍</span>
      <span>${r.expectedValue !== null && r.expectedValue !== undefined ? `期待値 ${r.expectedValue.toFixed(2)}` : ""}</span>
    </div>`)
    .join("");

  const comboRows = (prediction.anaCombos || [])
    .map((c) => `<div class="combo-row">
      <span class="combo">${coloredCombo(c.combination)}</span>
      <span>予想確率 ${fmtPercent(c.probability)}</span>
      <span>${c.odds !== null && c.odds !== undefined ? `${c.odds}倍` : "オッズ未公開"}</span>
      <span>${c.expectedValue !== null && c.expectedValue !== undefined ? `期待値 ${c.expectedValue.toFixed(2)}` : ""}</span>
    </div>`)
    .join("");

  el.anaBox.innerHTML = `
    <h3>穴狙い</h3>
    ${hasLongshots ? `<div class="ana-subtitle">単勝の穴候補</div><div class="combo-list">${racerRows}</div>` : ""}
    ${hasCombos ? `<div class="ana-subtitle">3連単の穴目（本命が1着以外）</div><div class="combo-list">${comboRows}</div>` : ""}
    <div class="note">期待値(予想勝率×オッズ)が高い順に表示しています。あくまで参考値です。</div>
  `;
}

function renderResult(result) {
  if (!result) {
    el.resultBox.innerHTML = "";
    return;
  }
  const rows = result.racers
    .map((r) => `<tr><td>${r.place_number_source}</td><td>${wakuBadge(r.entry_number)}</td><td>${r.name}</td></tr>`)
    .join("");
  const trifectaPayout = result.payouts?.trifecta?.[0];
  el.resultBox.innerHTML = `
    <h3>レース結果（確定）</h3>
    <table>
      <thead><tr><th>着</th><th>枠</th><th>選手</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${trifectaPayout ? `<div class="note">3連単 ${trifectaPayout.combination ?? "-"} : ${trifectaPayout.amount ?? "-"}円　決まり手: ${result.techniqueText ?? "-"}</div>` : ""}
  `;
}

async function loadRaceDetail() {
  showPanel("detail");
  el.racerTableWrap.innerHTML = `<div class="empty-state">読み込み中…</div>`;
  el.weatherBox.innerHTML = "";
  el.historyBox.innerHTML = "";
  el.trifectaBox.innerHTML = "";
  el.anaBox.innerHTML = "";
  el.resultBox.innerHTML = "";
  const seq = ++state.loadSeq;
  try {
    const { data, source, error } = await fetchDay();
    if (seq !== state.loadSeq) return;
    setStatusBadge(source, error);
    const detail = buildRaceDetail(data, state.stadium, state.race);
    if (!detail) throw new Error("指定されたレースが見つかりません");

    el.detailTitle.textContent = `${detail.stadiumName} ${detail.raceNumber}R ${detail.title || ""}`;
    el.raceMeta.innerHTML = `
      <span>締切: <b>${detail.closedAt ?? "-"}</b></span>
      <span>状態: <b>${STATUS_LABEL[detail.status]}</b></span>
    `;
    renderWeather(detail.prediction.weather);
    renderRacerTable(detail.prediction);
    renderHistoryPlaceholder(detail.prediction.racers);
    renderTrifecta(detail.prediction);
    renderAna(detail.prediction);
    renderResult(detail.result);

    if (state.pollTimer) clearInterval(state.pollTimer);
    if (detail.status !== "finished" && !state.sample) {
      state.pollTimer = setInterval(loadRaceDetail, 30000);
    }
  } catch (err) {
    if (seq !== state.loadSeq) return;
    setStatusBadge(null, err.message);
    el.racerTableWrap.innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function toDateInputValue(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
function toApiDate(dateInputValue) {
  return dateInputValue.replace(/-/g, "");
}

el.dateInput.addEventListener("change", () => {
  state.date = toApiDate(el.dateInput.value);
  loadStadiums();
});

let dateBeforeSample = null;
el.sampleToggle.addEventListener("click", () => {
  state.sample = !state.sample;
  el.sampleToggle.classList.toggle("active", state.sample);
  el.sampleToggle.textContent = state.sample ? "サンプルデータ表示中" : "サンプルデータ表示";
  el.dateInput.disabled = state.sample;
  if (state.sample) {
    dateBeforeSample = state.date;
    state.date = "20260401";
  } else {
    state.date = dateBeforeSample || state.date;
  }
  el.dateInput.value = toDateInputValue(state.date);
  loadStadiums();
});

el.backToStadiums.addEventListener("click", loadStadiums);
el.backToRaces.addEventListener("click", loadRaces);

(function init() {
  state.date = todayJst();
  el.dateInput.value = toDateInputValue(state.date);
  loadStadiums();
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // オフライン対応は付加価値のため、登録失敗時も本体機能は継続する
    });
  });
}
