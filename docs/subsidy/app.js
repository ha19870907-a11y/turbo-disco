(() => {
  const DATA_URL = "data/subsidies.json";
  const STORAGE_KEY = "subsidyToolProfile";

  const form = document.getElementById("profile-form");
  const prefectureSelect = document.getElementById("prefecture");
  const employeesInput = document.getElementById("employees");
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
      if (profile.employees) employeesInput.value = profile.employees;
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

  // targetNumberOfEmployees は "20名以下" "300名以下" "901名以上"
  // "従業員数の制約なし" のような形式。数値として比較する。
  function employeesMatches(item, employeeCount) {
    if (!employeeCount) return true;
    const raw = item.targetNumberOfEmployees;
    if (!raw || raw.includes("制約なし")) return true;
    const atMost = /^(\d+)名以下$/.exec(raw);
    if (atMost) return employeeCount <= Number(atMost[1]);
    const atLeast = /^(\d+)名以上$/.exec(raw);
    if (atLeast) return employeeCount >= Number(atLeast[1]);
    return true;
  }

  function runSearch(profile) {
    const terms = profile.themes.flatMap((t) => t.split(/[\s・]+/).filter(Boolean));
    const matches = subsidyData.items.filter((item) => {
      if (!prefectureMatches(item, profile.prefecture)) return false;
      if (!employeesMatches(item, profile.employees)) return false;
      if (profile.acceptingOnly && !isAccepting(item)) return false;
      if (!matchesKeyword(item, terms)) return false;
      return true;
    });
    const ctas = selectCtas(profile);
    renderResults(matches, ctas[0]);
    renderDeclineSection(profile, ctas[0]);
    renderDiagnosis(profile, matches);
    renderConsultSection(ctas);
  }

  // ---- 専門家相談CTA ----

  // お困りごと・テーマ・事業形態などから、関連しそうな専門家サービスの優先度を計算する。
  const CONCERN_SERVICE_WEIGHTS = {
    equipment: { subsidySupport: 2, taxAccountant: 1 },
    itDx: { subsidySupport: 2 },
    hiring: { socialInsurance: 2 },
    laborCost: { socialInsurance: 2, taxAccountant: 1 },
    financing: { finance: 3 },
    taxSaving: { taxAccountant: 3 },
    findTaxAccountant: { taxAccountant: 3 },
    subsidyConsult: { subsidySupport: 3 },
    incorporate: { taxAccountant: 2 },
    cashFlow: { finance: 2, taxAccountant: 1 },
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

  // 有効(enabled)なサービスを優先度順に最大3件返す。
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
    if (profile.orgType === "法人") scores.taxAccountant += 1;
    if (profile.employees && profile.employees > 0) scores.socialInsurance += 1;
    const decline = computeDeclinePercent(profile.revenue, profile.prevRevenue);
    if (decline !== null && decline > 0) {
      scores.finance += 2;
      scores.taxAccountant += 1;
    }

    return Object.keys(scores)
      .map((service) => ({ service, score: scores[service], config: AFFILIATE_CONFIG[service] }))
      .filter((entry) => entry.config && entry.config.enabled)
      .sort((a, b) => b.score - a.score || a.config.priority - b.config.priority)
      .slice(0, 3);
  }

  const AFFILIATE_CLICK_STORAGE_KEY = "subsidyToolAffiliateClicks";

  // アフィリエイトCTAがクリックされたことを記録する。
  // ・localStorageに(サービス名・クリック日時)を積み上げて、クリック回数を把握できるようにする
  // ・window.gtag / window.dataLayer が存在すれば(Google Analytics/GA4導入後)そちらにも送る
  // 外部サービスは何も契約・導入していないため、現時点では計測は端末内のみに閉じている。
  function trackAffiliateClick(serviceName) {
    const entry = { service: serviceName, timestamp: new Date().toISOString() };
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
      window.gtag("event", "affiliate_click", { service_name: serviceName });
    } else if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: "affiliate_click", service_name: serviceName });
    }
  }
  window.trackAffiliateClick = trackAffiliateClick;

  function buildCtaButton(entry, label) {
    const { service, config } = entry;
    const active = Boolean(config.url && config.url.trim());
    if (active) {
      const a = document.createElement("a");
      a.className = "cta-button";
      a.href = config.url;
      a.target = "_blank";
      a.rel = "noopener sponsored";
      a.textContent = label || `${config.name}を無料で相談する`;
      a.addEventListener("click", () => trackAffiliateClick(service));
      return a;
    }
    const span = document.createElement("span");
    span.className = "cta-button cta-button-disabled";
    span.textContent = "準備中（相談先を設定中です）";
    return span;
  }

  function buildCtaCard(entry) {
    const div = document.createElement("div");
    div.className = "cta-card";
    const strong = document.createElement("strong");
    strong.textContent = entry.config.name;
    const p = document.createElement("p");
    p.textContent = entry.config.description;
    div.appendChild(strong);
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
    q.textContent = "この制度、あなたの会社は対象になる？";
    const t = document.createElement("p");
    t.className = "card-cta-text";
    t.textContent = "補助金・助成金の活用について、専門家に無料相談できます。";
    wrap.appendChild(q);
    wrap.appendChild(t);
    wrap.appendChild(buildCtaButton(entry, `${entry.config.name}をする`));
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
    if (profile.orgType === "法人") tax += 1;
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
      `制度・時期によって異なるため、下の「支援制度（参考）」欄や公式情報で必ずご確認ください。`;

    const matches = subsidyData.items.filter((item) => {
      if (!prefectureMatches(item, profile.prefecture)) return false;
      if (profile.acceptingOnly && !isAccepting(item)) return false;
      return matchesKeyword(item, DECLINE_KEYWORDS);
    });
    declineListEl.innerHTML = "";
    for (const item of matches) {
      declineListEl.appendChild(buildResultItem(item, topCta));
    }
  }

  function buildResultItem(item, topCta) {
    const accepting = isAccepting(item);
    const li = document.createElement("li");
    li.className = "result-item";
    li.innerHTML = `
      <button type="button" class="result-toggle" aria-expanded="false">
        <span class="result-title">${escapeHtml(item.title || "(名称未取得)")}</span>
        <span class="result-meta">
          ${item.targetAreaSearch ? `対象地域: ${escapeHtml(item.targetAreaSearch)} ／ ` : ""}
          募集終了: ${escapeHtml(formatDate(item.acceptanceEndDatetime))}
          ${accepting ? "" : " ／ 募集終了済み"}
        </span>
      </button>
      <div class="result-detail" hidden>
        <dl class="detail-list">
          ${item.institutionName ? `<dt>実施団体</dt><dd>${escapeHtml(item.institutionName)}</dd>` : ""}
          ${item.subsidyMaxLimit ? `<dt>補助上限額</dt><dd>${escapeHtml(String(item.subsidyMaxLimit))}円</dd>` : ""}
          ${item.subsidyRate ? `<dt>補助率</dt><dd>${escapeHtml(item.subsidyRate)}</dd>` : ""}
          <dt>募集開始</dt><dd>${escapeHtml(formatDate(item.acceptanceStartDatetime))}</dd>
          <dt>募集終了</dt><dd>${escapeHtml(formatDate(item.acceptanceEndDatetime))}</dd>
          ${item.targetNumberOfEmployees ? `<dt>対象従業員数</dt><dd>${escapeHtml(item.targetNumberOfEmployees)}</dd>` : ""}
        </dl>
        <p><a href="https://www.jgrants-portal.go.jp/subsidy/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">jGrantsで詳細・公募要領を見る →</a></p>
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

  function renderResults(items, topCta) {
    resultsListEl.innerHTML = "";
    if (!items.length) {
      statusEl.textContent = "条件に合う制度が見つかりませんでした。テーマの選択を変えるか、都道府県・従業員数の指定を外してみてください。";
      return;
    }
    statusEl.textContent = `${items.length}件の制度が見つかりました。`;
    for (const item of items) {
      resultsListEl.appendChild(buildResultItem(item, topCta));
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
      employees: employeesInput.value ? Number(employeesInput.value) : null,
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
