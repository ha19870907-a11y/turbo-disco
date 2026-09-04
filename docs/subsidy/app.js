(() => {
  const DATA_URL = "data/subsidies.json";
  const STORAGE_KEY = "subsidyToolProfile";

  const form = document.getElementById("profile-form");
  const prefectureSelect = document.getElementById("prefecture");
  const employeesSelect = document.getElementById("employees");
  const industrySelect = document.getElementById("industry");
  const revenueBucketSelect = document.getElementById("revenueBucket");
  const revenueInput = document.getElementById("revenue");
  const revenueLabelEl = document.getElementById("revenue-label");
  const prevRevenueInput = document.getElementById("prevRevenue");
  const prevRevenueLabelEl = document.getElementById("prev-revenue-label");
  const cityInput = document.getElementById("city");
  const acceptingOnlyInput = document.getElementById("acceptingOnly");
  const purposeTagsEl = document.getElementById("purpose-tags");
  const concernListEl = document.getElementById("concern-list");
  const statusEl = document.getElementById("status");
  const resultsListEl = document.getElementById("results-list");
  const otherResultsSectionEl = document.getElementById("other-results-section");
  const otherResultsListEl = document.getElementById("other-results-list");
  const referenceListEl = document.getElementById("reference-list");
  const supportListEl = document.getElementById("support-list");
  const dataInfoEl = document.getElementById("data-info");
  const declineSectionEl = document.getElementById("decline-section");
  const declineNoteEl = document.getElementById("decline-note");
  const declineListEl = document.getElementById("decline-list");
  const diagnosisSectionEl = document.getElementById("diagnosis-section");
  const diagnosisListEl = document.getElementById("diagnosis-list");
  const consultSectionEl = document.getElementById("consult-section");
  const consultListEl = document.getElementById("consult-list");

  let subsidyData = { fetchedAt: null, count: 0, items: [] };
  const selectedThemes = new Set();
  const selectedConcerns = new Set();

  function updateRevenueLabel() {
    const orgType = form.querySelector('input[name="orgType"]:checked').value;
    const unit = orgType === "法人" ? "年商" : "所得";
    revenueLabelEl.textContent = `今年度の${unit}（万円・任意）`;
    prevRevenueLabelEl.textContent = `前年度の${unit}（万円・任意）`;
  }

  function initOptions() {
    for (const pref of PREFECTURES) {
      const opt = document.createElement("option");
      opt.value = pref;
      opt.textContent = pref;
      prefectureSelect.appendChild(opt);
    }
    for (const bucket of EMPLOYEE_BUCKETS) {
      const opt = document.createElement("option");
      opt.value = bucket.value;
      opt.textContent = bucket.label;
      employeesSelect.appendChild(opt);
    }
    for (const industry of INDUSTRIES) {
      const opt = document.createElement("option");
      opt.value = industry;
      opt.textContent = industry;
      industrySelect.appendChild(opt);
    }
    for (const bucket of REVENUE_BUCKETS) {
      const opt = document.createElement("option");
      opt.value = bucket.value;
      opt.textContent = bucket.label;
      revenueBucketSelect.appendChild(opt);
    }
    for (const radio of form.querySelectorAll('input[name="orgType"]')) {
      radio.addEventListener("change", updateRevenueLabel);
    }
    updateRevenueLabel();
    for (const tag of PURPOSE_TAGS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag-btn";
      btn.textContent = tag;
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => {
        if (selectedThemes.has(tag)) {
          selectedThemes.delete(tag);
          btn.classList.remove("active");
          btn.setAttribute("aria-pressed", "false");
        } else {
          selectedThemes.add(tag);
          btn.classList.add("active");
          btn.setAttribute("aria-pressed", "true");
        }
      });
      purposeTagsEl.appendChild(btn);
    }
    for (const concern of CONCERNS) {
      const label = document.createElement("label");
      label.className = "concern-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = concern.id;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedConcerns.add(concern.id);
        else selectedConcerns.delete(concern.id);
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(concern.label));
      concernListEl.appendChild(label);
    }
    for (const program of REFERENCE_PROGRAMS) {
      referenceListEl.appendChild(buildReferenceItem(program));
    }
    for (const program of SUPPORT_PROGRAMS) {
      supportListEl.appendChild(buildReferenceItem(program));
    }
  }

  function buildReferenceItem(program) {
    const li = document.createElement("li");
    li.className = "reference-item";
    li.innerHTML = `
      <strong>${escapeHtml(program.name)}</strong>
      <span class="ref-meta">対象: ${escapeHtml(program.for)} ／ 実施: ${escapeHtml(program.org)}</span>
      <span class="ref-note">${escapeHtml(program.note)}</span>
    `;
    return li;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const profile = JSON.parse(raw);
      if (profile.orgType) {
        const radio = form.querySelector(`input[name="orgType"][value="${CSS.escape(profile.orgType)}"]`);
        if (radio) radio.checked = true;
      }
      if (profile.prefecture) prefectureSelect.value = profile.prefecture;
      if (profile.city) cityInput.value = profile.city;
      if (profile.employeesBucket) employeesSelect.value = profile.employeesBucket;
      if (profile.industry) industrySelect.value = profile.industry;
      if (profile.revenueBucket) revenueBucketSelect.value = profile.revenueBucket;
      if (profile.revenue) revenueInput.value = profile.revenue;
      if (profile.prevRevenue) prevRevenueInput.value = profile.prevRevenue;
      if (Array.isArray(profile.themes)) {
        for (const btn of purposeTagsEl.querySelectorAll(".tag-btn")) {
          if (profile.themes.includes(btn.textContent)) {
            selectedThemes.add(btn.textContent);
            btn.classList.add("active");
            btn.setAttribute("aria-pressed", "true");
          }
        }
      }
      if (Array.isArray(profile.concerns)) {
        for (const checkbox of concernListEl.querySelectorAll('input[type="checkbox"]')) {
          if (profile.concerns.includes(checkbox.value)) {
            checkbox.checked = true;
            selectedConcerns.add(checkbox.value);
          }
        }
      }
      if (typeof profile.acceptingOnly === "boolean") acceptingOnlyInput.checked = profile.acceptingOnly;
      updateRevenueLabel();
    } catch (e) {
      // 壊れた保存データは無視する
    }
  }

  function saveProfile(profile) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      // ストレージが使えない環境では何もしない
    }
  }

  async function loadSubsidyData() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      subsidyData = await res.json();
    } catch (e) {
      dataInfoEl.textContent = "補助金データの読み込みに失敗しました。ページを再読み込みしてお試しください。";
      return;
    }
    renderDataInfo();
  }

  function renderDataInfo() {
    if (!subsidyData.fetchedAt) {
      dataInfoEl.textContent = "まだ補助金データが取得されていません(初回のデータ取得処理が完了するまでお待ちください)。下の「参考」リストはご利用いただけます。";
      return;
    }
    const fetchedDate = new Date(subsidyData.fetchedAt);
    const formatted = Number.isNaN(fetchedDate.getTime())
      ? subsidyData.fetchedAt
      : fetchedDate.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    dataInfoEl.textContent = `検索対象データ: ${subsidyData.count}件(${formatted} 時点・日本時間、1日1回更新)`;
  }

  function formatDate(iso) {
    if (!iso) return "未定";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (m) return `${m[1]}/${m[2]}/${m[3]}`;
    return iso;
  }

  function isAccepting(item) {
    if (!item.acceptanceEndDatetime) return true;
    return new Date(item.acceptanceEndDatetime).getTime() >= Date.now();
  }

  // "IT導入・デジタル化" のような複合語タグは、その表記のまま制度名に
  // 含まれることは少ないため、「・」区切りも分解したうえで、いずれか1語でも
  // 含まれていればヒットとする(すべての語を要求するAND条件だと、タグを
  // 押しただけでほぼ0件になってしまう)。
  function matchesKeyword(item, terms) {
    if (!terms.length) return true;
    const haystack = `${item.title} ${item.institutionName || ""}`.toLowerCase();
    return terms.some((t) => haystack.includes(t.toLowerCase()));
  }

  // targetAreaSearch は "東京都" のような単一の値だけでなく、
  // "北海道/宮城県/.../東京都/..." のように複数県がスラッシュ区切りで
  // まとめて入っていることがあるため、リストに分割してから判定する。
  function prefectureMatches(item, prefecture) {
    if (!prefecture) return true;
    const raw = item.targetAreaSearch;
    if (!raw) return true;
    const areas = raw.split("/").map((s) => s.trim());
    return areas.includes("全国") || areas.includes(prefecture);
  }

  // 事業分野は、選んだ業種の関連キーワード(INDUSTRY_KEYWORDS)がタイトルに
  // 含まれていれば一致とみなす。含まれていなくても、他の特定業種の
  // キーワードにも一致しない(=業種を問わない一般的な制度と考えられる)場合は
  // 除外しない。逆に、選んだ業種とは別の業種のキーワードにはっきり一致する
  // 場合だけ「他業種向け」として除外する(選択した業種名がタイトルに無いだけで
  // 0件になってしまう、という過剰な絞り込みを避けつつ、他業種の制度が
  // 大量に紛れ込むのも防ぐため)。「その他」を選んだ場合は絞り込みを行わない。
  function industryMatches(item, industry) {
    if (!industry || industry === "その他") return true;
    const haystack = `${item.title} ${item.institutionName || ""}`.toLowerCase();
    const selectedKeywords = (INDUSTRY_KEYWORDS[industry] || [industry]).map((k) => k.toLowerCase());
    if (selectedKeywords.some((k) => haystack.includes(k))) return true;
    for (const other of INDUSTRIES) {
      if (other === industry || other === "その他") continue;
      const otherKeywords = (INDUSTRY_KEYWORDS[other] || [other]).map((k) => k.toLowerCase());
      if (otherKeywords.some((k) => haystack.includes(k))) return false;
    }
    return true;
  }

  // 従業員数は「1〜4人」のような区分でしか分からないため、実際の人数は
  // その区分のどこかにいる、という前提で判定する(区分の一部でも条件に
  // 当てはまる可能性があれば表示する = 取りこぼしを避ける方向に倒す)。
  // targetNumberOfEmployees は "20名以下" "300名以下" "901名以上"
  // "従業員数の制約なし" のような形式。
  function employeesMatches(item, employeesBucketValue) {
    if (!employeesBucketValue) return true;
    const bucket = EMPLOYEE_BUCKETS.find((b) => b.value === employeesBucketValue);
    if (!bucket) return true;
    const raw = item.targetNumberOfEmployees;
    if (!raw || raw.includes("制約なし")) return true;
    const atMost = /^(\d+)名以下$/.exec(raw);
    if (atMost) return bucket.min <= Number(atMost[1]);
    const atLeast = /^(\d+)名以上$/.exec(raw);
    if (atLeast) return bucket.max >= Number(atLeast[1]);
    return true;
  }

  function buildSearchTerms(profile) {
    // 事業分野（業種）は「なぜおすすめか」の判定材料（computeMatchSignals）として使うのみで、
    // ここでの必須絞り込み（matchesKeyword）には含めない。業種名がタイトルに一致しないだけで
    // 検索結果が0件になってしまう（過剰な絞り込み）のを防ぐため。
    return profile.themes.flatMap((t) => t.split(/[\s・]+/).filter(Boolean));
  }

  function runSearch(profile) {
    const terms = buildSearchTerms(profile);
    const matches = subsidyData.items.filter((item) => {
      if (!prefectureMatches(item, profile.prefecture)) return false;
      if (!employeesMatches(item, profile.employeesBucket)) return false;
      if (profile.acceptingOnly && !isAccepting(item)) return false;
      if (!industryMatches(item, profile.industry)) return false;
      if (!matchesKeyword(item, terms)) return false;
      return true;
    });
    const ctas = selectCtas(profile);
    renderResults(matches, profile, ctas[0], terms);
    renderDeclineSection(profile, ctas[0]);
    renderDiagnosis(profile, matches);
    renderConsultSection(ctas);
  }

  // ---- 専門家相談CTA ----

  // お困りごと・テーマ・事業形態などから、関連しそうな専門家サービスの優先度を計算する。
  // (仕様のカテゴリー対応表: 設備投資/店舗改装/機械導入/IT・DX/HP/EC/広告/新商品→補助金専門家、
  //  採用/育成/賃上げ/労務→社労士、融資/資金繰り→資金調達、節税/税理士探し/法人化/創業→税理士)
  const CONCERN_SERVICE_WEIGHTS = {
    equipment: { subsidySupport: 2 },
    renovateStore: { subsidySupport: 2 },
    newMachine: { subsidySupport: 2 },
    itDx: { subsidySupport: 2 },
    website: { subsidySupport: 1 },
    ecommerce: { subsidySupport: 1 },
    ads: { subsidySupport: 1 },
    newProduct: { subsidySupport: 2 },
    newBusiness: { subsidySupport: 2, taxAccountant: 1 },
    hiring: { socialInsurance: 2 },
    training: { socialInsurance: 2 },
    payRaise: { socialInsurance: 2 },
    startup: { taxAccountant: 2, subsidySupport: 1 },
    incorporate: { taxAccountant: 3 },
    financing: { finance: 3 },
    cashFlow: { finance: 2, taxAccountant: 1 },
    taxSaving: { taxAccountant: 3 },
    findTaxAccountant: { taxAccountant: 3 },
    laborConsult: { socialInsurance: 3 },
    subsidyConsult: { subsidySupport: 3 },
  };

  const THEME_SERVICE_WEIGHTS = {
    "設備投資": { subsidySupport: 1 },
    "IT導入・デジタル化": { subsidySupport: 1 },
    "創業・起業": { taxAccountant: 1 },
    "事業承継": { taxAccountant: 1 },
    "人材育成・雇用": { socialInsurance: 1 },
    "事業再構築": { subsidySupport: 1 },
    "海外展開": { subsidySupport: 1 },
    "研究開発": { subsidySupport: 1 },
  };

  // カテゴリー内で有効(enabled)な案件のうち、優先順位(priority)が最も高い
  // (数字が小さい)ものを1件だけ選ぶ。案件を複数登録しておいて、この
  // enabled/priorityを切り替えるだけで表示する案件を差し替えられる。
  function resolveCandidate(categoryKey) {
    const category = AFFILIATE_CONFIG[categoryKey];
    if (!category) return null;
    const candidate = category.candidates
      .filter((c) => c.enabled)
      .sort((a, b) => a.priority - b.priority)[0];
    if (!candidate) return null;
    return { service: categoryKey, category: category.label, categoryPriority: category.priority, config: candidate };
  }

  // 有効なカテゴリーを優先度順に最大3件返す。
  // ①ユーザーの入力内容との関連性(お困りごと・テーマ) ②法人/個人事業主 ③従業員数
  // ④テーマ ⑤その他の条件、の順でスコアを積み上げてから並べる。
  function selectCtas(profile) {
    const scores = { taxAccountant: 0, socialInsurance: 0, subsidySupport: 0, finance: 0 };

    for (const concernId of profile.concerns) {
      const weights = CONCERN_SERVICE_WEIGHTS[concernId];
      if (!weights) continue;
      for (const service of Object.keys(weights)) scores[service] += weights[service];
    }
    for (const theme of profile.themes) {
      const weights = THEME_SERVICE_WEIGHTS[theme];
      if (!weights) continue;
      for (const service of Object.keys(weights)) scores[service] += weights[service];
    }
    // 法人・個人事業主のどちらも、税務相談のニーズは高いと考えて優先する
    if (["法人","個人事業主","創業予定"].includes(profile.orgType)) scores.taxAccountant += 1;
    if (profile.employeesBucket && profile.employeesBucket !== "0") scores.socialInsurance += 1;
    const decline = computeDeclinePercent(profile.revenue, profile.prevRevenue);
    if (decline !== null && decline > 0) {
      scores.finance += 2;
      scores.taxAccountant += 1;
    }

    return Object.keys(scores)
      .map((key) => ({ key, score: scores[key], resolved: resolveCandidate(key) }))
      .filter((entry) => entry.resolved)
      .sort((a, b) => b.score - a.score || a.resolved.categoryPriority - b.resolved.categoryPriority)
      .slice(0, 3)
      .map((entry) => entry.resolved);
  }

  const AFFILIATE_CLICK_STORAGE_KEY = "subsidyToolAffiliateClicks";

  // 専門家紹介CTAがクリックされたことを記録する。
  // ・localStorageに(サービス名・カテゴリー・クリック日時)を積み上げて、
  //   クリック回数を把握できるようにする
  // ・window.gtag / window.dataLayer が存在すれば(Google Analytics/GA4導入後)そちらにも送る
  // 外部サービスは何も契約・導入していないため、現時点では計測は端末内のみに閉じている。
  // 将来コンバージョン・成約数・報酬額を管理する場合は、このクリックログに
  // 対応する形でstorageのスキーマを拡張していく想定。
  function trackAffiliateClick(serviceName, category) {
    const entry = { service: serviceName, category: category || null, timestamp: new Date().toISOString() };
    try {
      const raw = localStorage.getItem(AFFILIATE_CLICK_STORAGE_KEY);
      const clicks = raw ? JSON.parse(raw) : [];
      clicks.push(entry);
      localStorage.setItem(AFFILIATE_CLICK_STORAGE_KEY, JSON.stringify(clicks));
    } catch (e) {
      // ストレージが使えない環境では記録をスキップする
    }
    console.log("[affiliate click]", entry);
    if (typeof window.gtag === "function") {
      window.gtag("event", "affiliate_click", { service_name: serviceName, category });
    } else if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: "affiliate_click", service_name: serviceName, category });
    }
  }
  window.trackAffiliateClick = trackAffiliateClick;

  function buildCtaButton(entry, label) {
    const { service, category, config } = entry;
    const active = Boolean(config.url && config.url.trim());
    if (active) {
      const a = document.createElement("a");
      a.className = "cta-button";
      a.href = config.url;
      a.target = "_blank";
      a.rel = "noopener sponsored";
      a.textContent = label || "無料で相談する";
      a.addEventListener("click", () => trackAffiliateClick(service, category));
      return a;
    }
    const span = document.createElement("span");
    span.className = "cta-button cta-button-disabled";
    span.textContent = "準備中（相談先を設定中です）";
    return span;
  }

  // 専門家紹介カードには、通常のコンテンツ（検索結果・記事）と区別できるよう
  // 「広告」バッジを明示する（外部サービスへの紹介リンクであることが
  // ひと目で分かるようにするため。詳細はadvertising.htmlで説明している）。
  function buildAdBadge() {
    const span = document.createElement("span");
    span.className = "ad-badge";
    span.textContent = "広告";
    return span;
  }

  function buildCtaCard(entry) {
    const div = document.createElement("div");
    div.className = "cta-card";
    const labelRow = document.createElement("div");
    labelRow.className = "cta-card-label";
    labelRow.appendChild(buildAdBadge());
    const strong = document.createElement("strong");
    strong.textContent = entry.config.name;
    labelRow.appendChild(strong);
    const p = document.createElement("p");
    p.textContent = entry.config.description;
    div.appendChild(labelRow);
    div.appendChild(p);
    div.appendChild(buildCtaButton(entry));
    return div;
  }

  function buildInlineCta(entry) {
    if (!entry) return "";
    const wrap = document.createElement("div");
    wrap.className = "card-cta";
    const q = document.createElement("p");
    q.className = "card-cta-question";
    q.appendChild(buildAdBadge());
    q.appendChild(document.createTextNode(" 自分の事業がこの制度の対象になるか、専門家に確認できます。"));
    wrap.appendChild(q);
    wrap.appendChild(buildCtaButton(entry, "自分の事業が対象になるか確認する"));
    return wrap;
  }

  function renderConsultSection(ctas) {
    consultListEl.innerHTML = "";
    if (!ctas.length) {
      consultSectionEl.hidden = true;
      return;
    }
    consultSectionEl.hidden = false;
    for (const entry of ctas) {
      consultListEl.appendChild(buildCtaCard(entry));
    }
  }

  // ---- 簡易診断(★評価) ----

  function bucketStars(count) {
    if (count <= 0) return 1;
    if (count <= 2) return 2;
    if (count <= 7) return 3;
    if (count <= 20) return 4;
    return 5;
  }

  function starString(n) {
    return "★".repeat(n) + "☆".repeat(5 - n);
  }

  // 補助金・助成金は検索結果の件数から、融資・税制は入力内容(売上減少・法人か等)から
  // 簡易的に評価する。あくまで参考の目安であり、制度の利用可否を判定するものではない。
  function computeDiagnosis(profile, matches) {
    const grantMatches = matches.filter((it) => (it.title || "").includes("助成"));
    const subsidyMatches = matches.filter((it) => !(it.title || "").includes("助成"));

    let finance = 3;
    if (profile.concerns.includes("financing") || profile.concerns.includes("cashFlow")) finance += 1;
    const decline = computeDeclinePercent(profile.revenue, profile.prevRevenue);
    if (decline !== null && decline > 0) finance += 1;

    let tax = 3;
    if (["法人","個人事業主","創業予定"].includes(profile.orgType)) tax += 1;
    if (
      profile.concerns.includes("taxSaving") ||
      profile.concerns.includes("findTaxAccountant") ||
      profile.concerns.includes("incorporate")
    ) {
      tax += 1;
    }

    return {
      subsidy: bucketStars(subsidyMatches.length),
      grant: bucketStars(grantMatches.length),
      finance: Math.min(5, finance),
      tax: Math.min(5, tax),
    };
  }

  function renderDiagnosis(profile, matches) {
    const diag = computeDiagnosis(profile, matches);
    diagnosisListEl.innerHTML = "";
    const rows = [
      ["補助金", diag.subsidy],
      ["助成金", diag.grant],
      ["融資", diag.finance],
      ["税制", diag.tax],
    ];
    for (const [label, stars] of rows) {
      const li = document.createElement("li");
      li.className = "diagnosis-row";
      li.innerHTML =
        `<span class="diagnosis-label">${escapeHtml(label)}</span>` +
        `<span class="diagnosis-stars" aria-label="5段階中${stars}">${starString(stars)}</span>`;
      diagnosisListEl.appendChild(li);
    }
    diagnosisSectionEl.hidden = false;
  }

  // (前年度の年商/所得 - 今年度の年商/所得) / 前年度 * 100。減少していれば正の値。
  function computeDeclinePercent(current, prev) {
    if (!prev || prev <= 0 || current == null) return null;
    return ((prev - current) / prev) * 100;
  }

  function renderDeclineSection(profile, topCta) {
    const decline = computeDeclinePercent(profile.revenue, profile.prevRevenue);
    if (decline === null || decline <= 0) {
      declineSectionEl.hidden = true;
      return;
    }
    declineSectionEl.hidden = false;
    const unit = profile.orgType === "法人" ? "年商" : "所得";
    declineNoteEl.textContent =
      `前年度から${unit}が約${Math.round(decline)}%減少しています。売上減少を要件とする資金繰り支援制度` +
      `（セーフティネット保証など）の対象になる場合があります。対象業種・減少率などの具体的な要件は` +
      `制度・時期によって異なるため、下の「こんな支援もあります」欄や公式情報で必ずご確認ください。`;

    const matches = subsidyData.items.filter((item) => {
      if (!prefectureMatches(item, profile.prefecture)) return false;
      if (profile.acceptingOnly && !isAccepting(item)) return false;
      return matchesKeyword(item, DECLINE_KEYWORDS);
    });
    declineListEl.innerHTML = "";
    for (const item of matches) {
      declineListEl.appendChild(buildResultItem(item, profile, DECLINE_KEYWORDS, topCta));
    }
  }

  // 入力条件との一致度を判定するための根拠(シグナル)を洗い出す。
  // すでに都道府県・従業員数・募集中フラグ・キーワードの絞り込みを通過した
  // 制度だけが対象なので、ここでは「一致度が高いと考えられる根拠」があるかどうかを
  // 実際のデータで確認しているだけで、根拠のでっち上げはしない
  // (法人/個人事業主の対象一致・売上規模の一致は、jGrantsのデータに構造化された
  // 形で含まれていないため判定していない)。
  function computeMatchSignals(item, profile, terms) {
    const haystack = `${item.title} ${item.institutionName || ""}`.toLowerCase();
    const industryTerms =
      profile.industry && profile.industry !== "その他"
        ? INDUSTRY_KEYWORDS[profile.industry] || [profile.industry]
        : [];
    const themeTerms = profile.themes.flatMap((t) => t.split(/[\s・]+/).filter(Boolean));

    const areas = (item.targetAreaSearch || "").split("/").map((s) => s.trim());
    return {
      area: Boolean(profile.prefecture) && areas.includes(profile.prefecture),
      employees:
        Boolean(profile.employeesBucket) &&
        Boolean(item.targetNumberOfEmployees) &&
        !item.targetNumberOfEmployees.includes("制約なし"),
      industry: industryTerms.length > 0 && industryTerms.some((t) => haystack.includes(t.toLowerCase())),
      purpose: themeTerms.length > 0 && themeTerms.some((t) => haystack.includes(t.toLowerCase())),
      // 「募集中のみ表示する」がONの間は、表示されている制度は全部募集中なので
      // このシグナルでは差がつかない(常にfalseにする)。OFFのときだけ、募集中で
      // あること自体を一致度のプラス材料として数える。
      accepting: !profile.acceptingOnly && isAccepting(item),
    };
  }

  const MATCH_REASON_LABELS = {
    area: "対象地域が入力した都道府県と一致",
    employees: "従業員数の条件に該当",
    industry: "選んだ業種に関連する制度",
    purpose: "選んだテーマ・お困りごとに関連する制度",
    accepting: "現在募集中",
  };

  // 一致度(★3〜★5、0〜2の低評価は付けない。絞り込みを通過している時点で
  // 無関係ではないため)。あくまで参考の簡易判定であり、対象条件との一致・
  // 利用可否を保証するものではない。
  function computeMatchStars(signals) {
    const points = Object.values(signals).filter(Boolean).length;
    if (points >= 3) return 5;
    if (points >= 1) return 4;
    return 3;
  }

  function matchStarsLabel(stars) {
    if (stars >= 5) return "対象条件との一致度が高い";
    if (stars === 4) return "条件が一部一致";
    return "追加確認が必要";
  }

  function buildResultItem(item, profile, terms, topCta) {
    const accepting = isAccepting(item);
    const signals = computeMatchSignals(item, profile, terms);
    const stars = computeMatchStars(signals);
    const reasons = Object.keys(signals)
      .filter((key) => signals[key])
      .map((key) => MATCH_REASON_LABELS[key]);
    const showIndividualBadge = profile.orgType === "個人事業主" || profile.orgType === "フリーランス";
    const li = document.createElement("li");
    li.className = "result-item";
    li.innerHTML = `
      <button type="button" class="result-toggle" aria-expanded="false">
        <span class="result-badges">
          <span class="match-stars" aria-label="一致度 5段階中${stars}、${matchStarsLabel(stars)}">${starString(stars)} ${escapeHtml(matchStarsLabel(stars))}</span>
          ${showIndividualBadge ? '<span class="badge-individual">個人事業主向け</span>' : ""}
        </span>
        <span class="result-title">${escapeHtml(item.title || "(名称未取得)")}</span>
        <span class="result-meta">
          ${item.targetAreaSearch ? `対象地域: ${escapeHtml(item.targetAreaSearch)} ／ ` : ""}
          募集終了: ${escapeHtml(formatDate(item.acceptanceEndDatetime))}
          ${accepting ? "" : " ／ 募集終了済み"}
        </span>
        ${reasons.length ? `<span class="result-reason">なぜおすすめ: ${escapeHtml(reasons.join("・"))}</span>` : ""}
      </button>
      <div class="result-detail" hidden>
        <dl class="detail-list">
          ${item.institutionName ? `<dt>実施団体</dt><dd>${escapeHtml(item.institutionName)}</dd>` : ""}
          ${item.subsidyMaxLimit ? `<dt>補助上限額</dt><dd>${escapeHtml(String(item.subsidyMaxLimit))}円</dd>` : ""}
          ${item.subsidyRate ? `<dt>補助率</dt><dd>${escapeHtml(item.subsidyRate)}</dd>` : ""}
          <dt>募集期間</dt><dd>${escapeHtml(formatDate(item.acceptanceStartDatetime))} 〜 ${escapeHtml(formatDate(item.acceptanceEndDatetime))}</dd>
          ${item.targetNumberOfEmployees ? `<dt>対象従業員数</dt><dd>${escapeHtml(item.targetNumberOfEmployees)}</dd>` : ""}
        </dl>
        <p><a href="https://www.jgrants-portal.go.jp/subsidy/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">公式サイト（jGrants）で詳細を見る →</a></p>
      </div>
    `;
    const toggle = li.querySelector(".result-toggle");
    const detailEl = li.querySelector(".result-detail");
    if (topCta) detailEl.appendChild(buildInlineCta(topCta));
    toggle.addEventListener("click", () => {
      const hidden = detailEl.hasAttribute("hidden");
      if (hidden) {
        detailEl.removeAttribute("hidden");
        toggle.setAttribute("aria-expanded", "true");
      } else {
        detailEl.setAttribute("hidden", "");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    return li;
  }

  // 「その他の支援制度」は絞り込み条件が少ないと件数が非常に多くなりやすい
  // (都道府県・従業員数・業種などを指定しないと300件近くになることもある)。
  // 一度に全件表示すると画面が長くなりすぎるため、最初はOTHER_RESULTS_PAGE_SIZE件
  // だけ表示し、「さらに表示」ボタンで追加分を出す(データを隠すのではなく、
  // 最初に表示する量を絞るだけ)。
  const OTHER_RESULTS_PAGE_SIZE = 20;

  function renderExpandableResultList(listEl, items, profile, terms, topCta, pageSize) {
    listEl.innerHTML = "";
    let shown = 0;
    function renderMore() {
      const existingMoreItem = listEl.querySelector(".show-more-item");
      if (existingMoreItem) existingMoreItem.remove();
      for (const item of items.slice(shown, shown + pageSize)) {
        listEl.appendChild(buildResultItem(item, profile, terms, topCta));
      }
      shown = Math.min(shown + pageSize, items.length);
      if (shown < items.length) {
        const li = document.createElement("li");
        li.className = "hint show-more-item";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tag-btn";
        btn.textContent = `さらに${items.length - shown}件を表示`;
        btn.addEventListener("click", renderMore);
        li.appendChild(btn);
        listEl.appendChild(li);
      }
    }
    renderMore();
  }

  // 検索結果を「A: あなたにおすすめの支援制度」(★4以上)と
  // 「B: その他の支援制度」(★3)に分けて表示する。補助金が1件もない場合でも
  // 「こんな支援もあります」(support-section)は常に表示されるため、
  // 「補助金が無かった=支援が無い」という状態にはならない。
  function renderResults(items, profile, topCta, terms) {
    resultsListEl.innerHTML = "";
    otherResultsListEl.innerHTML = "";

    if (!items.length) {
      statusEl.textContent = "条件に合う制度が見つかりませんでした。テーマの選択を変えるか、都道府県・従業員数の指定を外してみてください。下の「こんな支援もあります」もご確認ください。";
      otherResultsSectionEl.hidden = true;
      return;
    }

    const scored = items.map((item) => {
      const signals = computeMatchSignals(item, profile, terms);
      return { item, stars: computeMatchStars(signals) };
    });
    const recommended = scored.filter((s) => s.stars >= 4);
    const others = scored.filter((s) => s.stars === 3);

    statusEl.textContent = `${items.length}件の制度が見つかりました（おすすめ ${recommended.length}件 / その他 ${others.length}件）。`;

    if (recommended.length) {
      renderExpandableResultList(
        resultsListEl,
        recommended.map((s) => s.item),
        profile,
        terms,
        topCta,
        OTHER_RESULTS_PAGE_SIZE,
      );
    } else {
      const li = document.createElement("li");
      li.className = "hint";
      li.textContent = "都道府県・従業員数・事業分野・テーマなどを入力すると、条件に合う制度がここに表示されやすくなります。下の「その他の支援制度」もあわせてご確認ください。";
      resultsListEl.appendChild(li);
    }
    if (others.length) {
      otherResultsSectionEl.hidden = false;
      renderExpandableResultList(
        otherResultsListEl,
        others.map((s) => s.item),
        profile,
        terms,
        topCta,
        OTHER_RESULTS_PAGE_SIZE,
      );
    } else {
      otherResultsSectionEl.hidden = true;
    }
  }

  function handleSubmit(ev) {
    ev.preventDefault();
    const profile = currentProfile();
    saveProfile(profile);
    runSearch(profile);
  }

  function currentProfile() {
    return {
      orgType: form.querySelector('input[name="orgType"]:checked').value,
      prefecture: prefectureSelect.value,
      city: cityInput.value.trim(),
      employeesBucket: employeesSelect.value,
      industry: industrySelect.value,
      revenueBucket: revenueBucketSelect.value,
      revenue: revenueInput.value ? Number(revenueInput.value) : null,
      prevRevenue: prevRevenueInput.value ? Number(prevRevenueInput.value) : null,
      themes: Array.from(selectedThemes),
      concerns: Array.from(selectedConcerns),
      acceptingOnly: acceptingOnlyInput.checked,
    };
  }

  async function init() {
    initOptions();
    loadProfile();
    form.addEventListener("submit", handleSubmit);
    await loadSubsidyData();
    if (subsidyData.items.length) runSearch(currentProfile());
  }

  init();
})();
