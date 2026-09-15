// 変額保険（終身型）シミュレーション計算エンジン。
//
// ソニー生命など各社が公表している変額保険の一般的な仕組み（特別勘定に保険料を
// 繰り入れ、そこから危険保険料（保険関係費用）・維持費・運用関係費用を毎月控除し、
// 残額を運用実績に応じて増減させる仕組み）をモデル化した独自の近似シミュレーターです。
// 実際の保険料率表・費用率は非公開のため、本ツールの数値は概算であり、
// ソニー生命の公式な設計書・見積りとは一致しません。
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.InsuranceCalc = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TABLE_END_AGE = 120; // 生命表の打ち切り年齢（この年齢で生存率0とみなす）
  const SIM_END_AGE = 100; // シミュレーション表示の終了年齢（各社の設計書に合わせる）

  // Gompertz-Makeham近似による死亡率モデル。日本の実際の死亡率カーブに
  // おおむね沿うようパラメータを調整した簡易モデルであり、公式の生命表そのものではない。
  const MORTALITY_PARAMS = {
    male: { a: 0.0006, b: 0.00003, c: 0.093 },
    female: { a: 0.0004, b: 0.000015, c: 0.095 },
  };

  function validateGender(gender) {
    if (gender !== "male" && gender !== "female") {
      throw new Error("性別は male または female を指定してください");
    }
  }

  // 年齢ageにおける年間死亡率 qx（0〜1）を返す。
  function annualMortalityRate(age, gender) {
    validateGender(gender);
    const clampedAge = Math.min(Math.max(age, 0), TABLE_END_AGE - 1);
    const p = MORTALITY_PARAMS[gender];
    const qx = p.a + p.b * Math.exp(p.c * clampedAge);
    return Math.min(qx, 0.999);
  }

  // 年齢ageの死亡率から、月あたりの死亡率を近似する。
  function monthlyMortalityRate(annualQx) {
    const q = Math.min(Math.max(annualQx, 0), 0.999999);
    return 1 - Math.pow(1 - q, 1 / 12);
  }

  // issueAgeから各年齢までの生存確率 kpx (k=0..n) の配列を返す。p[0] = 1。
  function buildSurvivalArray(issueAge, gender, years) {
    const p = new Array(years + 1);
    p[0] = 1;
    for (let k = 1; k <= years; k += 1) {
      const qx = annualMortalityRate(issueAge + k - 1, gender);
      p[k] = p[k - 1] * (1 - qx);
    }
    return p;
  }

  // 終身保険の平準純保険料（1円あたり）を、指定した払込期間・予定利率で算出する。
  // payToAge が null の場合は終身払込（生存中は生涯払い続ける）として扱う。
  function computeNetPremiumRate({ issueAge, gender, payToAge, pricingAnnualRate }) {
    validateGender(gender);
    if (!Number.isFinite(issueAge) || issueAge < 0 || issueAge >= TABLE_END_AGE - 1) {
      throw new Error("契約年齢が不正です");
    }
    if (payToAge !== null && payToAge !== undefined) {
      if (!Number.isFinite(payToAge) || payToAge <= issueAge) {
        throw new Error("保険料払込満了年齢は契約年齢より大きい値にしてください");
      }
    }

    const remainingYears = TABLE_END_AGE - issueAge;
    const survival = buildSurvivalArray(issueAge, gender, remainingYears);
    const v = 1 / (1 + pricingAnnualRate);

    // Ax: 終身保険の一時払純保険料（保険金1円あたり）
    let ax = 0;
    for (let k = 0; k < remainingYears; k += 1) {
      const qx = annualMortalityRate(issueAge + k, gender);
      ax += Math.pow(v, k + 1) * survival[k] * qx;
    }

    // 払込期間に応じた生存年金現価率（期始払い）
    const payYears = payToAge !== null && payToAge !== undefined ? payToAge - issueAge : remainingYears;
    const n = Math.min(payYears, remainingYears);
    let annuity = 0;
    for (let k = 0; k < n; k += 1) {
      annuity += Math.pow(v, k) * survival[k];
    }

    if (annuity <= 0) {
      throw new Error("保険料の算出に失敗しました（払込期間を見直してください）");
    }

    return ax / annuity;
  }

  // 月払保険料（円）を算出する。expenseLoadingRate は付加保険料率（事業費相当の上乗せ）。
  function computeSuggestedMonthlyPremium({
    issueAge,
    gender,
    sumAssured,
    payToAge,
    pricingAnnualRate = 0.01,
    expenseLoadingRate = 0.15,
  }) {
    if (!Number.isFinite(sumAssured) || sumAssured <= 0) {
      throw new Error("死亡保障額は正の値を指定してください");
    }
    const netRate = computeNetPremiumRate({ issueAge, gender, payToAge, pricingAnnualRate });
    const netAnnualPremium = sumAssured * netRate;
    const grossAnnualPremium = netAnnualPremium * (1 + expenseLoadingRate);
    const grossMonthlyPremium = grossAnnualPremium / 12;
    // 実務の慣行に合わせ、10円単位に切り上げる。
    const rounded = Math.ceil(grossMonthlyPremium / 10) * 10;
    return {
      monthlyPremium: rounded,
      annualPremium: rounded * 12,
      netAnnualPremium,
    };
  }

  // initialCostRate・coiLoadingFactor・maintenanceFeeMonthlyは、実際のソニー生命
  // 設計書（契約年齢40歳・死亡保障1,000万円・年払278,040円のケースの解約返戻金表、
  // 運用利回り-3%/0%/3%・13年分）から最小二乗フィットにより逆算した値。
  // 契約者の性別は設計書からは判別できないため、暫定的に男性の死亡率カーブを前提に
  // フィットしている。フィット後のRMSEは約2万円（各年の解約返戻金の1〜2%程度）で、
  // 特に契約初期費用は初年度の払込保険料の8割超が控除されている（＝解約返戻金が
  // 初年度末でほぼ0円になる）ことが強く示唆された。資産運用関係費用は、開示された
  // 運用利回りシナリオに対しフィットした結果ほぼ0に収束したため、実際の設計書の
  // 「運用利回り」は特別勘定の運用報酬控除後の実質値である可能性が高い。本ツールでは
  // 特別勘定（運用先）ごとの費用差を提示する機能を残すため、資産運用関係費用は
  // シナリオの利回りとは別枠の控除として維持している（＝やや保守的な試算になる）。
  const DEFAULT_ASSUMPTIONS = {
    pricingAnnualRate: 0.01, // 予定利率（保険料算出用）
    expenseLoadingRate: 0.15, // 付加保険料率
    mgmtFeeAnnualRate: 0.02, // 資産運用関係費用（年率、特別勘定から控除）
    maintenanceFeeMonthly: 100, // 契約関係費（月額、円）
    initialCostRate: 0.85, // 契約初期費用率（第1保険年度の払込保険料に対する割合）
    coiLoadingFactor: 1.95, // 危険保険料（保険関係費用）に対する割増係数
  };

  const RETURN_SCENARIOS = [
    { key: "r0", label: "年率0%", rate: 0.0 },
    { key: "r3", label: "年率3%（標準）", rate: 0.03 },
    { key: "r6", label: "年率6%", rate: 0.06 },
  ];

  // 特別勘定（運用先）のプリセット。資産運用関係費用（年率）はイメージしやすいよう
  // 資産クラスごとに一般的な水準感で設定した独自の仮定であり、特定商品の実際の
  // 費用率ではない。"custom" を選んだ場合は呼び出し側で任意の値を指定する。
  const SPECIAL_ACCOUNTS = [
    { key: "balanced", label: "バランス型", mgmtFeeAnnualRate: 0.018 },
    { key: "domestic_stock", label: "国内株式型", mgmtFeeAnnualRate: 0.02 },
    { key: "global_stock", label: "世界株式型", mgmtFeeAnnualRate: 0.022 },
    { key: "bond", label: "債券型", mgmtFeeAnnualRate: 0.012 },
    { key: "money", label: "短期金融市場型（MMF等）", mgmtFeeAnnualRate: 0.008 },
    { key: "custom", label: "カスタム設定", mgmtFeeAnnualRate: null },
  ];

  // 1シナリオ分の年次推移をシミュレーションする。
  function simulateScenario({
    issueAge,
    gender,
    sumAssured,
    payToAge,
    monthlyPremium,
    annualReturnRate,
    mgmtFeeAnnualRate = DEFAULT_ASSUMPTIONS.mgmtFeeAnnualRate,
    maintenanceFeeMonthly = DEFAULT_ASSUMPTIONS.maintenanceFeeMonthly,
    initialCostRate = DEFAULT_ASSUMPTIONS.initialCostRate,
    coiLoadingFactor = DEFAULT_ASSUMPTIONS.coiLoadingFactor,
    simEndAge = SIM_END_AGE,
  }) {
    validateGender(gender);
    if (!Number.isFinite(monthlyPremium) || monthlyPremium < 0) {
      throw new Error("月払保険料が不正です");
    }
    if (simEndAge <= issueAge) {
      throw new Error("契約年齢がシミュレーション終了年齢を超えています");
    }

    const monthlyGrossGrowth = Math.pow(1 + annualReturnRate, 1 / 12);
    const monthlyFeeDrag = Math.pow(1 + mgmtFeeAnnualRate, 1 / 12);
    const monthlyNetGrowthFactor = monthlyGrossGrowth / monthlyFeeDrag;

    let accountValue = 0;
    let cumulativePremium = 0;
    let lapsed = false;
    let lapseAge = null;
    const rows = [];

    for (let age = issueAge; age < simEndAge; age += 1) {
      const payingThisYear = payToAge === null || payToAge === undefined ? true : age < payToAge;
      const qxAnnual = annualMortalityRate(age, gender);
      const qxMonthly = monthlyMortalityRate(qxAnnual);

      let premiumThisYear = 0;
      let coiThisYear = 0;
      let maintenanceFeeThisYear = 0;
      let mgmtFeeThisYear = 0;
      let investmentGainThisYear = 0;

      for (let m = 0; m < 12; m += 1) {
        if (lapsed) break;

        if (payingThisYear) {
          accountValue += monthlyPremium;
          premiumThisYear += monthlyPremium;
          cumulativePremium += monthlyPremium;

          if (age === issueAge) {
            const initialCost = monthlyPremium * initialCostRate;
            accountValue -= initialCost;
          }
        }

        maintenanceFeeThisYear += maintenanceFeeMonthly;
        accountValue -= maintenanceFeeMonthly;

        const netAmountAtRisk = Math.max(sumAssured - accountValue, 0);
        const coi = netAmountAtRisk * qxMonthly * coiLoadingFactor;
        coiThisYear += coi;
        accountValue -= coi;

        if (accountValue < 0) {
          if (!payingThisYear) {
            // 払込満了後、特別勘定残高が保険関係費用を賄えず消滅＝失効とみなす。
            accountValue = 0;
            lapsed = true;
            lapseAge = age + m / 12;
          } else {
            // 払込期間中は翌月以降の保険料でカバーされる想定のため、
            // 一時的なマイナスは0に補正して継続する（失効扱いにはしない）。
            accountValue = 0;
          }
        }

        if (!lapsed) {
          const beforeGrowth = accountValue;
          const withoutMgmtFee = beforeGrowth * monthlyGrossGrowth;
          accountValue = beforeGrowth * monthlyNetGrowthFactor;
          mgmtFeeThisYear += withoutMgmtFee - accountValue;
          investmentGainThisYear += accountValue - beforeGrowth;
        }
      }

      const deathBenefit = lapsed ? 0 : Math.max(sumAssured, accountValue);
      rows.push({
        age,
        premiumThisYear,
        cumulativePremium,
        coiThisYear,
        maintenanceFeeThisYear,
        investmentGainThisYear,
        accountValue,
        deathBenefit,
        lapsed,
      });

      if (lapsed) {
        // 失効以降は保障が消滅するため、それ以降の年も0円で記録して表を埋める。
        for (let a = age + 1; a < simEndAge; a += 1) {
          rows.push({
            age: a,
            premiumThisYear: 0,
            cumulativePremium,
            coiThisYear: 0,
            maintenanceFeeThisYear: 0,
            investmentGainThisYear: 0,
            accountValue: 0,
            deathBenefit: 0,
            lapsed: true,
          });
        }
        break;
      }
    }

    return { rows, lapsed, lapseAge, finalAccountValue: rows.length ? rows[rows.length - 1].accountValue : 0 };
  }

  // 指定された運用シナリオ（{key,label,rate}の配列）についてまとめて計算する。
  // scenarios を省略した場合は標準の3パターン（0%/3%/6%）を使う。
  function simulateAllScenarios(params, scenarios = RETURN_SCENARIOS) {
    if (!Array.isArray(scenarios) || scenarios.length === 0) {
      throw new Error("運用シナリオを1つ以上指定してください");
    }
    return scenarios.map((scenario) => ({
      ...scenario,
      result: simulateScenario({ ...params, annualReturnRate: scenario.rate }),
    }));
  }

  return {
    TABLE_END_AGE,
    SIM_END_AGE,
    DEFAULT_ASSUMPTIONS,
    RETURN_SCENARIOS,
    SPECIAL_ACCOUNTS,
    annualMortalityRate,
    monthlyMortalityRate,
    computeNetPremiumRate,
    computeSuggestedMonthlyPremium,
    simulateScenario,
    simulateAllScenarios,
  };
});
