(function () {
  "use strict";

  const SCENARIO_COLORS = {
    r0: "#ff9d3d",
    r3: "#4fd1c5",
    r6: "#4ade80",
    custom: "#f87171",
  };

  const yen = (n) => `${Math.round(n).toLocaleString("ja-JP")}円`;

  const form = document.getElementById("sim-form");
  const errorBox = document.getElementById("error-box");
  const resultsSection = document.getElementById("results");
  const specialAccountSelect = document.getElementById("specialAccount");
  const customMgmtFeeField = document.getElementById("customMgmtFeeField");

  let lastScenarioResults = null;
  let lastParams = null;
  let activeScenarioKey = "r3";

  function initSpecialAccountOptions() {
    InsuranceCalc.SPECIAL_ACCOUNTS.forEach((account) => {
      const opt = document.createElement("option");
      opt.value = account.key;
      opt.textContent = account.key === "custom"
        ? account.label
        : `${account.label}（資産運用関係費用 年率${(account.mgmtFeeAnnualRate * 100).toFixed(1)}%）`;
      specialAccountSelect.appendChild(opt);
    });
    specialAccountSelect.value = "balanced";
    updateCustomMgmtFeeVisibility();
  }

  function updateCustomMgmtFeeVisibility() {
    customMgmtFeeField.hidden = specialAccountSelect.value !== "custom";
  }

  specialAccountSelect.addEventListener("change", updateCustomMgmtFeeVisibility);

  function readMgmtFeeAnnualRate() {
    const account = InsuranceCalc.SPECIAL_ACCOUNTS.find((a) => a.key === specialAccountSelect.value);
    if (!account) throw new Error("特別勘定を選択してください");
    if (account.key === "custom") {
      const rate = Number(document.getElementById("customMgmtFee").value) / 100;
      if (!Number.isFinite(rate) || rate < 0) {
        throw new Error("カスタムの資産運用関係費用を正しく入力してください");
      }
      return rate;
    }
    return account.mgmtFeeAnnualRate;
  }

  function readReturnScenarios() {
    const scenarios = [];
    if (document.getElementById("scn-r0").checked) {
      scenarios.push({ key: "r0", label: "年率0%", rate: 0 });
    }
    if (document.getElementById("scn-r3").checked) {
      scenarios.push({ key: "r3", label: "年率3%（標準）", rate: 0.03 });
    }
    if (document.getElementById("scn-r6").checked) {
      scenarios.push({ key: "r6", label: "年率6%", rate: 0.06 });
    }
    if (document.getElementById("scn-custom").checked) {
      const rateInput = document.getElementById("scn-custom-rate").value;
      const rate = Number(rateInput) / 100;
      if (!Number.isFinite(rate)) {
        throw new Error("カスタム運用利回りを正しく入力してください");
      }
      scenarios.push({ key: "custom", label: `カスタム（年率${rateInput}%）`, rate });
    }
    if (scenarios.length === 0) {
      throw new Error("運用利回りシナリオを1つ以上選択してください");
    }
    return scenarios;
  }

  function readParams() {
    const issueAge = Number(document.getElementById("issueAge").value);
    const gender = document.querySelector('input[name="gender"]:checked').value;
    const sumAssuredMan = Number(document.getElementById("sumAssuredMan").value);
    const payPeriodValue = document.getElementById("payPeriod").value;
    const payToAge = payPeriodValue === "whole" ? null : Number(payPeriodValue);

    const pricingAnnualRate = Number(document.getElementById("pricingRate").value) / 100;
    const expenseLoadingRate = Number(document.getElementById("expenseLoading").value) / 100;
    const mgmtFeeAnnualRate = readMgmtFeeAnnualRate();
    const maintenanceFeeMonthly = Number(document.getElementById("maintenanceFee").value);
    const initialCostRate = Number(document.getElementById("initialCost").value) / 100;
    const coiLoadingFactor = Number(document.getElementById("coiLoading").value) / 100;

    if (!Number.isFinite(issueAge) || issueAge < 0 || issueAge > 90) {
      throw new Error("契約年齢は0〜90の範囲で入力してください");
    }
    if (payToAge !== null && issueAge >= payToAge) {
      throw new Error("契約年齢は保険料払込満了年齢より小さくしてください");
    }
    if (!Number.isFinite(sumAssuredMan) || sumAssuredMan <= 0) {
      throw new Error("死亡保障額は正の値を入力してください");
    }
    if (issueAge >= InsuranceCalc.SIM_END_AGE) {
      throw new Error(`契約年齢は${InsuranceCalc.SIM_END_AGE}歳未満にしてください`);
    }

    return {
      issueAge,
      gender,
      sumAssured: sumAssuredMan * 10000,
      payToAge,
      pricingAnnualRate,
      expenseLoadingRate,
      mgmtFeeAnnualRate,
      maintenanceFeeMonthly,
      initialCostRate,
      coiLoadingFactor,
    };
  }

  function renderPremiumSummary(params, premium) {
    document.getElementById("out-monthly").textContent = yen(premium.monthlyPremium);
    document.getElementById("out-annual").textContent = yen(premium.annualPremium);

    const account = InsuranceCalc.SPECIAL_ACCOUNTS.find((a) => a.key === specialAccountSelect.value);
    document.getElementById("out-special-account").textContent =
      `${account.label}（資産運用関係費用 年率${(params.mgmtFeeAnnualRate * 100).toFixed(2)}%）`;

    const endAge = params.payToAge !== null ? params.payToAge : InsuranceCalc.SIM_END_AGE;
    const years = endAge - params.issueAge;
    const totalPaid = premium.monthlyPremium * 12 * years;
    const label = params.payToAge !== null
      ? yen(totalPaid)
      : `${yen(totalPaid)}（100歳まで生存した場合）`;
    document.getElementById("out-total-paid").textContent = label;
  }

  function buildChart(params, scenarioResults) {
    const svg = document.getElementById("chart");
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const width = 900;
    const height = 360;
    const padLeft = 80;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 40;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const ages = scenarioResults[0].result.rows.map((r) => r.age);
    const minAge = ages[0];
    const maxAge = ages[ages.length - 1];

    let maxValue = params.sumAssured;
    scenarioResults.forEach((s) => {
      s.result.rows.forEach((r) => {
        if (r.accountValue > maxValue) maxValue = r.accountValue;
      });
    });
    maxValue *= 1.1;

    const xScale = (age) => padLeft + ((age - minAge) / (maxAge - minAge)) * plotW;
    const yScale = (v) => padTop + plotH - (v / maxValue) * plotH;

    const ns = "http://www.w3.org/2000/svg";
    function el(tag, attrs) {
      const e = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
      return e;
    }

    // 背景グリッド（横方向、5分割）
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i += 1) {
      const v = (maxValue / gridCount) * i;
      const y = yScale(v);
      svg.appendChild(el("line", { x1: padLeft, x2: width - padRight, y1: y, y2: y, stroke: "#2a3a5f", "stroke-width": 1 }));
      const label = el("text", { x: padLeft - 8, y: y + 4, fill: "#93a3c4", "font-size": 11, "text-anchor": "end" });
      label.textContent = `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;
      svg.appendChild(label);
    }

    // x軸ラベル（5年刻み）
    for (let age = minAge; age <= maxAge; age += 5) {
      const x = xScale(age);
      svg.appendChild(el("line", { x1: x, x2: x, y1: padTop, y2: height - padBottom, stroke: "#1c2947", "stroke-width": 1 }));
      const label = el("text", { x, y: height - padBottom + 16, fill: "#93a3c4", "font-size": 11, "text-anchor": "middle" });
      label.textContent = `${age}歳`;
      svg.appendChild(label);
    }

    // 基本保険金額（最低保証）の参照線
    const baseY = yScale(params.sumAssured);
    const refLine = el("line", {
      x1: padLeft,
      x2: width - padRight,
      y1: baseY,
      y2: baseY,
      stroke: "#93a3c4",
      "stroke-width": 1.5,
      "stroke-dasharray": "6,4",
    });
    svg.appendChild(refLine);

    // 払込満了年齢の縦線
    if (params.payToAge !== null && params.payToAge <= maxAge) {
      const x = xScale(params.payToAge);
      svg.appendChild(el("line", { x1: x, x2: x, y1: padTop, y2: height - padBottom, stroke: "#ff9d3d", "stroke-width": 1, "stroke-dasharray": "3,3" }));
    }

    // シナリオごとの特別勘定価格の折れ線
    scenarioResults.forEach((s) => {
      const points = s.result.rows.map((r) => `${xScale(r.age)},${yScale(r.accountValue)}`).join(" L ");
      const path = el("path", {
        d: `M ${points}`,
        fill: "none",
        stroke: SCENARIO_COLORS[s.key],
        "stroke-width": 2.2,
      });
      svg.appendChild(path);
    });

    // 軸
    svg.appendChild(el("line", { x1: padLeft, x2: padLeft, y1: padTop, y2: height - padBottom, stroke: "#93a3c4", "stroke-width": 1 }));
    svg.appendChild(el("line", { x1: padLeft, x2: width - padRight, y1: height - padBottom, y2: height - padBottom, stroke: "#93a3c4", "stroke-width": 1 }));

    // 凡例
    const legend = document.getElementById("chart-legend");
    legend.innerHTML = "";
    scenarioResults.forEach((s) => {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `<span class="swatch" style="background:${SCENARIO_COLORS[s.key]}"></span>${s.label}（特別勘定価格）`;
      legend.appendChild(item);
    });
    const refItem = document.createElement("div");
    refItem.className = "item";
    refItem.innerHTML = `<span class="swatch" style="background:#93a3c4"></span>基本保険金額（最低保証・${yen(params.sumAssured)}）`;
    legend.appendChild(refItem);
  }

  function renderLapseWarnings(scenarioResults) {
    const box = document.getElementById("lapse-warnings");
    box.innerHTML = "";
    scenarioResults.forEach((s) => {
      if (s.result.lapsed) {
        const div = document.createElement("div");
        div.className = "warning";
        div.style.marginTop = "10px";
        const age = Math.floor(s.result.lapseAge);
        div.textContent = `${s.label}のシナリオでは、${age}歳頃に特別勘定残高が保険関係費用の負担により0円となり、死亡保障が消滅（失効）する見込みです。`;
        box.appendChild(div);
      }
    });
  }

  function renderScenarioTabs(scenarioResults) {
    const tabs = document.getElementById("scenario-tabs");
    tabs.innerHTML = "";
    scenarioResults.forEach((s) => {
      const btn = document.createElement("button");
      btn.textContent = s.label;
      btn.className = s.key === activeScenarioKey ? "active" : "";
      btn.addEventListener("click", () => {
        activeScenarioKey = s.key;
        renderScenarioTabs(scenarioResults);
        renderDetail(lastParams, scenarioResults);
      });
      tabs.appendChild(btn);
    });
  }

  function renderCostSummary(scenario) {
    const rows = scenario.result.rows;
    const totalCoi = rows.reduce((sum, r) => sum + r.coiThisYear, 0);
    const totalMaintenance = rows.reduce((sum, r) => sum + r.maintenanceFeeThisYear, 0);
    const totalGain = rows.reduce((sum, r) => sum + r.investmentGainThisYear, 0);
    const finalRow = rows[rows.length - 1];

    const box = document.getElementById("cost-summary");
    box.innerHTML = "";
    const items = [
      ["累計危険保険料（保険関係費用の主要部分）", yen(totalCoi)],
      ["累計契約関係費", yen(totalMaintenance)],
      ["累計運用損益（資産運用関係費用控除後）", yen(totalGain)],
      [`${finalRow.age}歳時点の特別勘定価格`, yen(finalRow.accountValue)],
    ];
    items.forEach(([label, value]) => {
      const stat = document.createElement("div");
      stat.className = "stat";
      stat.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
      box.appendChild(stat);
    });
  }

  function renderDetail(params, scenarioResults) {
    const scenario = scenarioResults.find((s) => s.key === activeScenarioKey);
    renderCostSummary(scenario);

    const tbody = document.getElementById("detail-tbody");
    tbody.innerHTML = "";
    scenario.result.rows.forEach((r) => {
      const tr = document.createElement("tr");
      if (params.payToAge !== null && r.age === params.payToAge - 1) tr.className = "pay-end-row";
      if (r.lapsed) tr.className = (tr.className ? tr.className + " " : "") + "lapsed";
      tr.innerHTML = `
        <td>${r.age}歳</td>
        <td>${yen(r.premiumThisYear)}</td>
        <td>${yen(r.cumulativePremium)}</td>
        <td>${yen(r.coiThisYear)}</td>
        <td>${yen(r.maintenanceFeeThisYear)}</td>
        <td>${yen(r.accountValue)}</td>
        <td>${yen(r.deathBenefit)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    errorBox.textContent = "";
    try {
      const params = readParams();
      const scenarios = readReturnScenarios();
      const premium = InsuranceCalc.computeSuggestedMonthlyPremium(params);
      const scenarioResults = InsuranceCalc.simulateAllScenarios(
        { ...params, monthlyPremium: premium.monthlyPremium },
        scenarios
      );

      lastParams = params;
      lastScenarioResults = scenarioResults;
      if (!scenarioResults.some((s) => s.key === activeScenarioKey)) {
        activeScenarioKey = scenarioResults[0].key;
      }

      renderPremiumSummary(params, premium);
      buildChart(params, scenarioResults);
      renderLapseWarnings(scenarioResults);
      renderScenarioTabs(scenarioResults);
      renderDetail(params, scenarioResults);

      resultsSection.classList.add("visible");
      resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      errorBox.textContent = err.message || "入力内容を確認してください";
      resultsSection.classList.remove("visible");
    }
  });

  initSpecialAccountOptions();
})();
