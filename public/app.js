(() => {
  const state = {
    date: null,
    sample: false,
    stadium: null,
    race: null,
    pollTimer: null,
    loadSeq: 0,
  };

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
    trifectaBox: document.getElementById("trifecta-box"),
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

  async function api(pathname, params = {}) {
    const url = new URL(pathname, window.location.origin);
    Object.entries({ date: state.date, sample: state.sample ? "1" : undefined, ...params })
      .filter(([, v]) => v !== undefined && v !== null)
      .forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
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
  }

  async function loadStadiums() {
    showPanel("stadiums");
    el.stadiumGrid.innerHTML = `<div class="empty-state">読み込み中…</div>`;
    const seq = ++state.loadSeq;
    try {
      const data = await api("/api/stadiums");
      if (seq !== state.loadSeq) return;
      setStatusBadge(data.source, data.error);
      if (data.stadiums.length === 0) {
        el.stadiumGrid.innerHTML = `<div class="empty-state">この日の開催データがありません</div>`;
        return;
      }
      el.stadiumGrid.innerHTML = "";
      for (const s of data.stadiums) {
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
      el.stadiumGrid.innerHTML = `<div class="empty-state">${err.message}</div>`;
    }
  }

  async function loadRaces() {
    showPanel("races");
    el.raceGrid.innerHTML = `<div class="empty-state">読み込み中…</div>`;
    const seq = ++state.loadSeq;
    try {
      const data = await api("/api/races", { stadium: state.stadium });
      if (seq !== state.loadSeq) return;
      setStatusBadge(data.source, data.error);
      el.raceListTitle.textContent = `${data.stadiumName} - ${data.date}`;
      el.raceGrid.innerHTML = "";
      for (const r of data.races) {
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
        return `
        <tr>
          <td class="mark ${markClass}">${r.mark}</td>
          <td>${r.entryNumber}</td>
          <td class="name-cell">
            <div class="rname">${r.name}</div>
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

  function renderTrifecta(prediction, hasOdds) {
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
          <span class="combo">${c.combination}</span>
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

  function renderResult(result) {
    if (!result) {
      el.resultBox.innerHTML = "";
      return;
    }
    const rows = result.racers
      .map((r) => `<tr><td>${r.place_number_source}</td><td>${r.entry_number}</td><td>${r.name}</td></tr>`)
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
    el.trifectaBox.innerHTML = "";
    el.resultBox.innerHTML = "";
    const seq = ++state.loadSeq;
    try {
      const data = await api("/api/race", { stadium: state.stadium, race: state.race });
      if (seq !== state.loadSeq) return;
      setStatusBadge(data.source, data.error);
      el.detailTitle.textContent = `${data.stadiumName} ${data.raceNumber}R ${data.title || ""}`;
      el.raceMeta.innerHTML = `
        <span>締切: <b>${data.closedAt ?? "-"}</b></span>
        <span>状態: <b>${STATUS_LABEL[data.status]}</b></span>
      `;
      renderWeather(data.prediction.weather);
      renderRacerTable(data.prediction);
      renderTrifecta(data.prediction, data.prediction.hasOdds);
      renderResult(data.result);

      if (state.pollTimer) clearInterval(state.pollTimer);
      if (data.status !== "finished" && !state.sample) {
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

  (async function init() {
    try {
      const meta = await fetch("/api/meta").then((r) => r.json());
      state.date = meta.todayJst;
      el.dateInput.value = toDateInputValue(state.date);
    } catch {
      const fallback = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      state.date = fallback;
      el.dateInput.value = toDateInputValue(fallback);
    }
    loadStadiums();
  })();
})();
