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

test("simulateAllScenarios: 4シナリオすべてが返る", () => {
  const results = simulateAllScenarios({
    issueAge: 35,
    gender: "female",
    sumAssured: 10000000,
    payToAge: 65,
    monthlyPremium: 12000,
  });
  assert.equal(results.length, 4);
  for (const r of results) {
    assert.ok(Array.isArray(r.result.rows));
    assert.ok(r.result.rows.length > 0);
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
