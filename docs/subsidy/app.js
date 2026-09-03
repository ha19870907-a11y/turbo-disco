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
  const statusEl = document.getElementById("status");
  const resultsListEl = document.getElementById("results-list");
  const referenceListEl = document.getElementById("reference-list");
  const dataInfoEl = document.getElementById("data-info");
  const declineSectionEl = document.getElementById("decline-section");
  const declineNoteEl = document.getElementById("decline-note");
  const declineListEl = document.getElementById("decline-list");
  const declineReferenceListEl = document.getElementById("decline-reference-list");

  let subsidyData = { fetchedAt: null, count: 0, items: [] };
  const selectedThemes = new Set();

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
    for (const program of REFERENCE_PROGRAMS) {
      referenceListEl.appendChild(buildReferenceItem(program));
    }
    for (const program of DECLINE_REFERENCE_PROGRAMS) {
      declineReferenceListEl.appendChild(buildReferenceItem(program));
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
    renderResults(matches);
    renderDeclineSection(profile);
  }

  // (前年度の年商/所得 - 今年度の年商/所得) / 前年度 * 100。減少していれば正の値。
  function computeDeclinePercent(current, prev) {
    if (!prev || prev <= 0 || current == null) return null;
    return ((prev - current) / prev) * 100;
  }

  function renderDeclineSection(profile) {
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
      `制度・時期によって異なるため、下の参考制度や公式情報で必ずご確認ください。`;

    const matches = subsidyData.items.filter((item) => {
      if (!prefectureMatches(item, profile.prefecture)) return false;
      if (profile.acceptingOnly && !isAccepting(item)) return false;
      return matchesKeyword(item, DECLINE_KEYWORDS);
    });
    declineListEl.innerHTML = "";
    for (const item of matches) {
      declineListEl.appendChild(buildResultItem(item));
    }
  }

  function buildResultItem(item) {
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

  function renderResults(items) {
    resultsListEl.innerHTML = "";
    if (!items.length) {
      statusEl.textContent = "条件に合う制度が見つかりませんでした。テーマの選択を変えるか、都道府県・従業員数の指定を外してみてください。";
      return;
    }
    statusEl.textContent = `${items.length}件の制度が見つかりました。`;
    for (const item of items) {
      resultsListEl.appendChild(buildResultItem(item));
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
