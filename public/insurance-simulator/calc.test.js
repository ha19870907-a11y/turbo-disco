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

test("simulateScenario: 実際のソニー生命設計書B（契約年齢30歳・40年分・4シナリオ）の解約返戻金と概ね整合する", () => {
  // 契約年齢30歳・死亡保障1,000万円・年払保険料182,400円（月払15,200円）・
  // 払込満了70歳の実際の解約返戻金表（運用利回り-3%/0%/3%/6%、40年分）に対する
  // 回帰チェック。積立金（accountValue）ではなく、解約控除費用を反映した
  // surrenderValueで比較する（公式資料「変額虎の巻」の費用構造の説明に基づき、
  // 積立金と解約返戻金を分離した2段階モデルに変更済み）。
  const issueAge = 30;
  const sumAssured = 10000000;
  const monthlyPremium = Math.round(182400 / 12);
  const payToAge = 70;
  const target = {
    "-0.03": [0, 100000, 248000, 391000, 531000, 666000, 798000, 926000, 1050000, 1171000, 1267000, 1360000, 1449000, 1535000, 1618000, 1698000, 1775000, 1848000, 1918000, 1985000, 2050000, 2111000, 2170000, 2227000, 2281000, 2334000, 2384000, 2432000, 2478000, 2522000, 2565000, 2607000, 2647000, 2688000, 2728000, 2770000, 2812000, 2857000, 2904000, 2955000],
    "0": [0, 109000, 266000, 424000, 581000, 738000, 895000, 1051000, 1206000, 1361000, 1494000, 1627000, 1760000, 1891000, 2022000, 2153000, 2283000, 2411000, 2539000, 2666000, 2792000, 2917000, 3041000, 3165000, 3288000, 3411000, 3533000, 3655000, 3776000, 3896000, 4017000, 4138000, 4259000, 4380000, 4504000, 4629000, 4756000, 4888000, 5023000, 5163000],
    "0.03": [0, 118000, 286000, 458000, 635000, 817000, 1002000, 1192000, 1387000, 1586000, 1770000, 1958000, 2151000, 2349000, 2553000, 2762000, 2977000, 3197000, 3423000, 3655000, 3892000, 4136000, 4387000, 4644000, 4909000, 5181000, 5460000, 5747000, 6043000, 6347000, 6660000, 6982000, 7314000, 7658000, 8013000, 8380000, 8762000, 9158000, 9570000, 10000000],
    "0.06": [2000, 126000, 306000, 494000, 693000, 902000, 1122000, 1354000, 1597000, 1853000, 2102000, 2366000, 2644000, 2939000, 3251000, 3581000, 3929000, 4298000, 4688000, 5100000, 5536000, 5997000, 6486000, 7003000, 7550000, 8130000, 8743000, 9393000, 10082000, 10812000, 11585000, 12404000, 13274000, 14196000, 15175000, 16214000, 17319000, 18494000, 19743000, 21072000],
  };

  for (const [rateStr, expected] of Object.entries(target)) {
    const { rows } = simulateScenario({
      issueAge,
      gender: "male",
      sumAssured,
      payToAge,
      monthlyPremium,
      annualReturnRate: Number(rateStr),
      simEndAge: issueAge + expected.length,
    });
    expected.forEach((expectedValue, i) => {
      const actual = rows[i].surrenderValue;
      // DEFAULT_ASSUMPTIONSはフィットした値をキリの良い数字に丸めているため、
      // 最適値そのものより誤差が大きくなる。絶対誤差(15万円)と相対誤差(10%)の
      // どちらか緩い方を許容する。
      const absTolerance = 150000;
      const relTolerance = expectedValue * 0.1;
      const tolerance = Math.max(absTolerance, relTolerance);
      assert.ok(
        Math.abs(actual - expectedValue) <= tolerance,
        `rate=${rateStr} year=${i + 1}: expected≈${expectedValue}, got ${Math.round(actual)}`
      );
    });
  }
});

test("simulateScenario: 実際のソニー生命設計書A（契約年齢40歳・13年分）の解約返戻金とも整合する", () => {
  // 設計書A（契約年齢40歳・死亡保障1,000万円・年払278,040円、13年分）。
  // 積立金/解約返戻金の2段階モデルに変更後は、設計書Bと同じ既定値でこちらも
  // 良好に再現できる（旧モデルでは単一パラメータで両立できなかった）。
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
      simEndAge: issueAge + expected.length,
    });
    expected.forEach((expectedValue, i) => {
      const actual = rows[i].surrenderValue;
      const absTolerance = 60000;
      const relTolerance = expectedValue * 0.1;
      const tolerance = Math.max(absTolerance, relTolerance);
      assert.ok(
        Math.abs(actual - expectedValue) <= tolerance,
        `rate=${rateStr} year=${i + 1}: expected≈${expectedValue}, got ${Math.round(actual)}`
      );
    });
  }
});

test("simulateScenario: 解約返戻金は積立金（特別勘定価格）を上回らない", () => {
  const { rows } = simulateScenario({
    issueAge: 30,
    gender: "male",
    sumAssured: 10000000,
    payToAge: 60,
    monthlyPremium: 20000,
    annualReturnRate: 0.03,
  });
  for (const row of rows) {
    assert.ok(row.surrenderValue <= row.accountValue + 1e-6, `age ${row.age}: surrenderValue > accountValue`);
  }
});

test("simulateScenario: 解約控除費用は保険料払込10年目でゼロになる", () => {
  const { rows } = simulateScenario({
    issueAge: 30,
    gender: "male",
    sumAssured: 10000000,
    payToAge: null,
    monthlyPremium: 20000,
    annualReturnRate: 0.03,
  });
  const year9 = rows.find((r) => r.age === 38); // 保険料払込9年目
  const year10 = rows.find((r) => r.age === 39); // 保険料払込10年目
  assert.ok(year9.accountValue - year9.surrenderValue > 0, "9年目はまだ解約控除費用が残っているはず");
  assert.ok(
    Math.abs(year10.accountValue - year10.surrenderValue) < 1e-6,
    "10年目には解約控除費用がゼロになっているはず"
  );
});

test("simulateScenario: 保険料払込期間が10年未満で完了した場合、完了後は解約控除費用がかからない", () => {
  const { rows } = simulateScenario({
    issueAge: 30,
    gender: "male",
    sumAssured: 10000000,
    payToAge: 35, // 5年間のみ払込
    monthlyPremium: 20000,
    annualReturnRate: 0.03,
  });
  const afterPayment = rows.find((r) => r.age === 35); // 払込完了直後
  assert.ok(
    Math.abs(afterPayment.accountValue - afterPayment.surrenderValue) < 1e-6,
    "払込完了後は10年未満でも解約控除費用がゼロになっているはず"
  );
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
