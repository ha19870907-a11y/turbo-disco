const test = require("node:test");
const assert = require("node:assert/strict");
const {
  annualMortalityRate,
  computeNetPremiumRate,
  computeSuggestedMonthlyPremium,
  simulateScenario,
  simulateAllScenarios,
  RETURN_SCENARIOS,
} = require("./calc.js");

test("annualMortalityRate: 死亡率は年齢とともに単調増加する", () => {
  const ages = [20, 30, 40, 50, 60, 70, 80, 90, 100];
  for (const gender of ["male", "female"]) {
    let prev = 0;
    for (const age of ages) {
      const qx = annualMortalityRate(age, gender);
      assert.ok(qx > prev, `qx(${age}, ${gender}) should exceed qx at younger age`);
      assert.ok(qx > 0 && qx <= 1, `qx(${age}, ${gender}) out of range: ${qx}`);
      prev = qx;
    }
  }
});

test("annualMortalityRate: 同年齢では男性の死亡率が女性より高い", () => {
  for (const age of [20, 40, 60, 80]) {
    const male = annualMortalityRate(age, "male");
    const female = annualMortalityRate(age, "female");
    assert.ok(male > female, `male qx should exceed female qx at age ${age}`);
  }
});

test("annualMortalityRate: 不正な性別はエラーになる", () => {
  assert.throws(() => annualMortalityRate(40, "other"));
});

test("computeNetPremiumRate: 契約年齢が払込満了年齢以上だとエラー", () => {
  assert.throws(() => computeNetPremiumRate({ issueAge: 60, gender: "male", payToAge: 60, pricingAnnualRate: 0.01 }));
  assert.throws(() => computeNetPremiumRate({ issueAge: 61, gender: "male", payToAge: 60, pricingAnnualRate: 0.01 }));
});

test("computeNetPremiumRate: 終身払込(payToAge=null)は有期払込より保険料率が低い", () => {
  const wholeLife = computeNetPremiumRate({ issueAge: 30, gender: "male", payToAge: null, pricingAnnualRate: 0.01 });
  const limited = computeNetPremiumRate({ issueAge: 30, gender: "male", payToAge: 60, pricingAnnualRate: 0.01 });
  assert.ok(wholeLife < limited, "支払期間が長いほど1回あたりの保険料率は低くなるはず");
});

test("computeNetPremiumRate: 女性の方が男性より保険料率が低い（死亡率が低いため）", () => {
  const male = computeNetPremiumRate({ issueAge: 40, gender: "male", payToAge: 60, pricingAnnualRate: 0.01 });
  const female = computeNetPremiumRate({ issueAge: 40, gender: "female", payToAge: 60, pricingAnnualRate: 0.01 });
  assert.ok(female < male);
});

test("computeSuggestedMonthlyPremium: 保障額に比例する", () => {
  const base = computeSuggestedMonthlyPremium({
    issueAge: 30,
    gender: "male",
    sumAssured: 10000000,
    payToAge: 60,
  });
  const doubled = computeSuggestedMonthlyPremium({
    issueAge: 30,
    gender: "male",
    sumAssured: 20000000,
    payToAge: 60,
  });
  assert.ok(Math.abs(doubled.monthlyPremium / base.monthlyPremium - 2) < 0.05);
});

test("simulateScenario: 累計払込保険料が正しく積み上がる（払込期間中は毎年12ヶ月分）", () => {
  const { rows } = simulateScenario({
    issueAge: 30,
    gender: "male",
    sumAssured: 10000000,
    payToAge: 60,
    monthlyPremium: 10000,
    annualReturnRate: 0.03,
    simEndAge: 65,
  });
  const yearAt40 = rows.find((r) => r.age === 40);
  assert.equal(yearAt40.cumulativePremium, 10000 * 12 * (40 - 30 + 1));

  const yearAt60 = rows.find((r) => r.age === 60);
  const yearAt61 = rows.find((r) => r.age === 61);
  assert.equal(yearAt61.cumulativePremium, yearAt60.cumulativePremium, "払込満了後は保険料が増えない");
  assert.equal(yearAt61.premiumThisYear, 0);
});

test("simulateScenario: 特別勘定価格は常に0以上", () => {
  for (const scenario of RETURN_SCENARIOS) {
    const { rows } = simulateScenario({
      issueAge: 50,
      gender: "female",
      sumAssured: 10000000,
      payToAge: 60,
      monthlyPremium: 15000,
      annualReturnRate: scenario.rate,
    });
    for (const row of rows) {
      assert.ok(row.accountValue >= 0, `accountValue negative at age ${row.age} for ${scenario.key}`);
      assert.ok(row.deathBenefit >= 0);
    }
  }
});

test("simulateScenario: 死亡保険金額は基本保険金額を下回らない（失効時を除く）", () => {
  const { rows } = simulateScenario({
    issueAge: 40,
    gender: "male",
    sumAssured: 10000000,
    payToAge: 60,
    monthlyPremium: 20000,
    annualReturnRate: 0.06,
  });
  for (const row of rows) {
    if (!row.lapsed) {
      assert.ok(row.deathBenefit >= 10000000 - 1e-6);
    }
  }
});

test("simulateScenario: 運用利回りが高いほど特別勘定価格は大きくなる", () => {
  const params = {
    issueAge: 40,
    gender: "male",
    sumAssured: 10000000,
    payToAge: 60,
    monthlyPremium: 20000,
  };
  const low = simulateScenario({ ...params, annualReturnRate: -0.03 });
  const mid = simulateScenario({ ...params, annualReturnRate: 0.03 });
  const high = simulateScenario({ ...params, annualReturnRate: 0.06 });
  const at60Low = low.rows.find((r) => r.age === 59).accountValue;
  const at60Mid = mid.rows.find((r) => r.age === 59).accountValue;
  const at60High = high.rows.find((r) => r.age === 59).accountValue;
  assert.ok(at60Low < at60Mid, `${at60Low} should be < ${at60Mid}`);
  assert.ok(at60Mid < at60High, `${at60Mid} should be < ${at60High}`);
});

test("simulateScenario: 極端な低金利かつ低保険料では払込満了後に失効しうる", () => {
  const { rows, lapsed } = simulateScenario({
    issueAge: 60,
    gender: "male",
    sumAssured: 50000000,
    payToAge: 61,
    monthlyPremium: 1000,
    annualReturnRate: -0.03,
    simEndAge: 100,
  });
  assert.equal(lapsed, true);
  const lapsedRows = rows.filter((r) => r.lapsed);
  assert.ok(lapsedRows.length > 0);
  for (const row of lapsedRows) {
    assert.equal(row.accountValue, 0);
    assert.equal(row.deathBenefit, 0);
  }
});

test("simulateScenario: 不正な月払保険料はエラーになる", () => {
  assert.throws(() =>
    simulateScenario({
      issueAge: 30,
      gender: "male",
      sumAssured: 10000000,
      payToAge: 60,
      monthlyPremium: -100,
      annualReturnRate: 0.03,
    })
  );
});

test("simulateAllScenarios: 既定では0%/3%/6%の3シナリオが返る", () => {
  const results = simulateAllScenarios({
    issueAge: 35,
    gender: "female",
    sumAssured: 10000000,
    payToAge: 65,
    monthlyPremium: 12000,
  });
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.key), ["r0", "r3", "r6"]);
  for (const r of results) {
    assert.ok(Array.isArray(r.result.rows));
    assert.ok(r.result.rows.length > 0);
  }
});

test("simulateAllScenarios: カスタムシナリオを含む任意のリストを指定できる", () => {
  const customScenarios = [
    { key: "r0", label: "年率0%", rate: 0 },
    { key: "r3", label: "年率3%", rate: 0.03 },
    { key: "r6", label: "年率6%", rate: 0.06 },
    { key: "custom", label: "カスタム(年率9%)", rate: 0.09 },
  ];
  const results = simulateAllScenarios(
    {
      issueAge: 35,
      gender: "female",
      sumAssured: 10000000,
      payToAge: 65,
      monthlyPremium: 12000,
    },
    customScenarios
  );
  assert.equal(results.length, 4);
  const custom = results.find((r) => r.key === "custom");
  const r6 = results.find((r) => r.key === "r6");
  const lastCustom = custom.result.rows[custom.result.rows.length - 1].accountValue;
  const lastR6 = r6.result.rows[r6.result.rows.length - 1].accountValue;
  assert.ok(lastCustom > lastR6, "9%シナリオは6%シナリオより特別勘定価格が大きいはず");
});

test("simulateAllScenarios: 空のシナリオリストはエラーになる", () => {
  assert.throws(() =>
    simulateAllScenarios(
      { issueAge: 35, gender: "female", sumAssured: 10000000, payToAge: 65, monthlyPremium: 12000 },
      []
    )
  );
});

test("simulateScenario: 実際のソニー生命設計書（解約返戻金表）の数値と概ね整合する", () => {
  // 契約年齢40歳・死亡保障1,000万円・年払保険料278,040円（月払23,170円）の
  // 実際の解約返戻金表（運用利回り-3%/0%/3%、13年分の解約返戻金）に対する
  // 回帰チェック。DEFAULT_ASSUMPTIONSのinitialCostRate/coiLoadingFactorは
  // このデータに最小二乗フィットして逆算した値（性別は設計書からは不明のため
  // 男性の死亡率カーブを仮定）。ここでは資産運用関係費用・契約関係費を0として、
  // フィット時と同じ条件で再現できることを確認する。
  const issueAge = 40;
  const sumAssured = 10000000;
  const monthlyPremium = Math.round(278040 / 12);
  const target = {
    "-0.03": [0, 222000, 443000, 657000, 865000, 1067000, 1263000, 1452000, 1635000, 1813000, 1960000, 2102000],
    "0": [0, 235000, 472000, 708000, 944000, 1179000, 1413000, 1645000, 1877000, 2108000, 2313000, 2517000],
    "0.03": [1000, 248000, 502000, 762000, 1028000, 1301000, 1580000, 1866000, 2159000, 2458000, 2740000, 3030000],
  };

  for (const [rateStr, expected] of Object.entries(target)) {
    const { rows } = simulateScenario({
      issueAge,
      gender: "male",
      sumAssured,
      payToAge: null,
      monthlyPremium,
      annualReturnRate: Number(rateStr),
      mgmtFeeAnnualRate: 0,
      maintenanceFeeMonthly: 0,
      simEndAge: issueAge + expected.length,
    });
    expected.forEach((expectedValue, i) => {
      const actual = rows[i].accountValue;
      // DEFAULT_ASSUMPTIONSはフィットした値をキリの良い数字に丸めているため、
      // 最適値そのものより誤差が大きくなる。絶対誤差(4万円)と相対誤差(5%)の
      // どちらか緩い方を許容する。
      const absTolerance = 40000;
      const relTolerance = expectedValue * 0.05;
      const tolerance = Math.max(absTolerance, relTolerance);
      assert.ok(
        Math.abs(actual - expectedValue) <= tolerance,
        `rate=${rateStr} year=${i + 1}: expected≈${expectedValue}, got ${Math.round(actual)}`
      );
    });
  }
});

test("simulateScenario: 契約年齢がシミュレーション終了年齢以上だとエラー", () => {
  assert.throws(() =>
    simulateScenario({
      issueAge: 100,
      gender: "male",
      sumAssured: 10000000,
      payToAge: null,
      monthlyPremium: 10000,
      annualReturnRate: 0.03,
      simEndAge: 100,
    })
  );
});
