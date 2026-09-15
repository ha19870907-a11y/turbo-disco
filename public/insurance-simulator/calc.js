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

  // policyCostRate・surrenderChargeRate・coiLoadingFactor・maintenanceFeeMonthly・
  // mgmtFeeAnnualRateは、実際のソニー生命設計書2件の解約返戻金表に対する最小二乗
  // フィットにより逆算した値。
  //   ・設計書A: 契約年齢40歳・死亡保障1,000万円・年払278,040円、運用利回り-3/0/3%、13年分
  //   ・設計書B: 契約年齢30歳・死亡保障1,000万円・年払182,400円・払込満了70歳、
  //             運用利回り-3/0/3/6%、40年分（払込満了〜満期までの推移を含む）
  // 契約者の性別はいずれの設計書からも判別できないため、暫定的に男性の死亡率カーブを
  // 前提にフィットしている。
  //
  // 別途入手したソニー生命の公式資料「変額虎の巻」（諸費用について）の記載により、
  // 費用の構造は以下の2段階であることが判明した。
  //   1. 積立金（＝特別勘定価格。危険保険料・死亡保険金の計算基礎となる「真の」残高）
  //      は、毎回の保険料払込時に控除される費用（本ツールのpolicyCostRate）と、
  //      積立金から毎月控除される危険保険料・契約関係費、および運用実績（資産運用
  //      関係費用控除後）によって決まる。
  //   2. 解約返戻金（解約時に実際に受け取れる金額）は、積立金からさらに「解約控除
  //      費用」を差し引いたもの。解約控除費用は、保険料払込年月数が10年未満の場合
  //      にのみ発生し、10年でゼロになる（保険料払込期間がそれより短く完了している
  //      場合は発生しない）。ただし正確な逓減スケジュールは非公開のため、本ツールは
  //      10年でゼロになる線形逓減と仮定している。
  // この2段階モデルで設計書A・Bを同時にフィットし直したところ、単一モデルでの
  // 再現性が大幅に改善した（全体のRMSEが従来の約5万円から約2万円に、初年度の
  // 解約返戻金がほぼ0円になる急落もほぼ再現できるようになった）。
  // 資産運用関係費用（mgmtFeeAnnualRate）は、開示された運用利回りシナリオに対し
  // フィットした結果ごく小さい値（0.1%台）に収束し、これは「変額虎の巻」に記載の
  // 実際の特別勘定運営費用＋信託報酬（大半が0.1〜0.6%程度、日本成長株式型のみ
  // 約1.0%）ともおおむね整合する。本ツールでは特別勘定（運用先）ごとの費用差を
  // 提示する機能を残すため、UI上で特別勘定を選択すると、この既定値は選択した
  // ファンドの実際の費用率（SPECIAL_ACCOUNTS参照、いずれも「変額虎の巻」2026年
  // 6月末現在の実績値）に置き換えられる。
  const DEFAULT_ASSUMPTIONS = {
    pricingAnnualRate: 0.01, // 予定利率（保険料算出用）
    expenseLoadingRate: 0.15, // 付加保険料率
    mgmtFeeAnnualRate: 0.0013, // 資産運用関係費用（年率、特別勘定から控除）
    maintenanceFeeMonthly: 800, // 契約関係費（月額、円）
    policyCostRate: 0.18, // 保険関係費率（毎回の払込保険料に対する割合、積立金から控除）
    surrenderChargeRate: 0.019, // 解約控除率（死亡保障額に対する割合。保険料払込10年未満の解約時のみ、年数に応じて線形に逓減）
    coiLoadingFactor: 0.24, // 危険保険料に対する割増係数
  };

  const RETURN_SCENARIOS = [
    { key: "r0", label: "年率0%", rate: 0.0 },
    { key: "r3", label: "年率3%（標準）", rate: 0.03 },
    { key: "r6", label: "年率6%", rate: 0.06 },
  ];

  // 特別勘定（運用先）のプリセット。ソニー生命公式資料「変額虎の巻」
  // （2026年6月末現在）に記載の、各特別勘定の特別勘定運営費用＋投資信託の
  // 信託報酬（いずれも年率・税込）の実績値。監査報酬など変動費用は含まない。
  // "custom" を選んだ場合は呼び出し側で任意の値を指定する。
  const SPECIAL_ACCOUNTS = [
    { key: "stock", label: "株式型（日本株式）", mgmtFeeAnnualRate: 0.0111 / 100 + 0.0825 / 100 },
    { key: "growth_stock", label: "日本成長株式型", mgmtFeeAnnualRate: 0.0087 / 100 + 0.968 / 100 },
    { key: "global_core_stock", label: "世界コア株式型", mgmtFeeAnnualRate: 0.0087 / 100 + 0.22 / 100 },
    { key: "global_stock", label: "世界株式型", mgmtFeeAnnualRate: 0.0087 / 100 + 0.594 / 100 },
    { key: "bond", label: "債券型", mgmtFeeAnnualRate: 0.0087 / 100 + 0.0825 / 100 },
    { key: "global_bond", label: "世界債券型", mgmtFeeAnnualRate: 0.0141 / 100 + 0.143 / 100 },
    { key: "diversified", label: "総合型", mgmtFeeAnnualRate: 0.0127 / 100 + 0.1265 / 100 },
    { key: "money_market", label: "短期金融市場型", mgmtFeeAnnualRate: 0.0087 / 100 },
    { key: "custom", label: "カスタム設定", mgmtFeeAnnualRate: null },
  ];

  // 解約控除年数（この年数分の保険料払込が完了するまで解約控除費用がかかる）。
  const SURRENDER_CHARGE_YEARS = 10;

  // 1シナリオ分の年次推移をシミュレーションする。
  // accountValue（積立金＝特別勘定価格）は危険保険料・死亡保険金の計算基礎となる
  // 「真の」残高。surrenderValue（解約返戻金）は、そこから保険料払込10年未満の
  // 解約時にのみかかる解約控除費用をさらに差し引いた、実際に解約時に受け取れる金額。
  function simulateScenario({
    issueAge,
    gender,
    sumAssured,
    payToAge,
    monthlyPremium,
    annualReturnRate,
    mgmtFeeAnnualRate = DEFAULT_ASSUMPTIONS.mgmtFeeAnnualRate,
    maintenanceFeeMonthly = DEFAULT_ASSUMPTIONS.maintenanceFeeMonthly,
    policyCostRate = DEFAULT_ASSUMPTIONS.policyCostRate,
    surrenderChargeRate = DEFAULT_ASSUMPTIONS.surrenderChargeRate,
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
    const surrenderChargeBase = sumAssured * surrenderChargeRate;

    let accountValue = 0;
    let cumulativePremium = 0;
    let lapsed = false;
    let lapseAge = null;
    const rows = [];

    for (let age = issueAge; age < simEndAge; age += 1) {
      const policyYear = age - issueAge + 1;
      const payingThisYear = payToAge === null || payToAge === undefined ? true : age < payToAge;
      const qxAnnual = annualMortalityRate(age, gender);
      const qxMonthly = monthlyMortalityRate(qxAnnual);

      let premiumThisYear = 0;
      let coiThisYear = 0;
      let policyCostThisYear = 0;
      let maintenanceFeeThisYear = 0;
      let mgmtFeeThisYear = 0;
      let investmentGainThisYear = 0;

      for (let m = 0; m < 12; m += 1) {
        if (lapsed) break;

        if (payingThisYear) {
          accountValue += monthlyPremium;
          premiumThisYear += monthlyPremium;
          cumulativePremium += monthlyPremium;

          const policyCost = monthlyPremium * policyCostRate;
          policyCostThisYear += policyCost;
          accountValue -= policyCost;
        }

        maintenanceFeeThisYear += maintenanceFeeMonthly;
        accountValue -= maintenanceFeeMonthly;

        const netAmountAtRisk = Math.max(sumAssured - accountValue, 0);
        const coi = netAmountAtRisk * qxMonthly * coiLoadingFactor;
        coiThisYear += coi;
        accountValue -= coi;

        if (accountValue < 0) {
          if (!payingThisYear) {
            // 払込満了後、積立金が保険関係費用を賄えず消滅＝失効とみなす。
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
      // 解約控除費用：保険料払込年数が10年未満、かつ払込期間が完了していない場合のみ、
      // 経過年数に応じて線形に逓減（10年目でゼロ）。正確な逓減スケジュールは非公開のため、
      // 線形逓減という単純化を置いている。
      const surrenderCharge =
        !lapsed && payingThisYear && policyYear < SURRENDER_CHARGE_YEARS
          ? (surrenderChargeBase * (SURRENDER_CHARGE_YEARS - policyYear)) / (SURRENDER_CHARGE_YEARS - 1)
          : 0;
      const surrenderValue = lapsed ? 0 : Math.max(accountValue - surrenderCharge, 0);
      rows.push({
        age,
        premiumThisYear,
        cumulativePremium,
        coiThisYear,
        policyCostThisYear,
        maintenanceFeeThisYear,
        investmentGainThisYear,
        accountValue,
        surrenderValue,
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
            policyCostThisYear: 0,
            maintenanceFeeThisYear: 0,
            investmentGainThisYear: 0,
            accountValue: 0,
            surrenderValue: 0,
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
