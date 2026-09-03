(() => {
  const DATA_URL = "data/subsidies.json";
  const STORAGE_KEY = "subsidyToolProfile";

  const form = document.getElementById("profile-form");
  const prefectureSelect = document.getElementById("prefecture");
  const employeesSelect = document.getElementById("employees");
  const keywordInput = document.getElementById("keyword");
  const cityInput = document.getElementById("city");
  const acceptingOnlyInput = document.getElementById("acceptingOnly");
  const purposeTagsEl = document.getElementById("purpose-tags");
  const statusEl = document.getElementById("status");
  const resultsListEl = document.getElementById("results-list");
  const referenceListEl = document.getElementById("reference-list");
  const dataInfoEl = document.getElementById("data-info");

  let subsidyData = { fetchedAt: null, count: 0, items: [] };

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
    for (const tag of PURPOSE_TAGS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag-btn";
      btn.textContent = tag;
      btn.addEventListener("click", () => {
        const current = keywordInput.value.trim();
        keywordInput.value = current ? `${current} ${tag}` : tag;
        keywordInput.focus();
      });
      purposeTagsEl.appendChild(btn);
    }
    for (const program of REFERENCE_PROGRAMS) {
      const li = document.createElement("li");
      li.className = "reference-item";
      li.innerHTML = `
        <strong>${escapeHtml(program.name)}</strong>
        <span class="ref-meta">対象: ${escapeHtml(program.for)} ／ 実施: ${escapeHtml(program.org)}</span>
        <span class="ref-note">${escapeHtml(program.note)}</span>
      `;
      referenceListEl.appendChild(li);
    }
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
      if (profile.employees) employeesSelect.value = profile.employees;
      if (profile.keyword) keywordInput.value = profile.keyword;
      if (typeof profile.acceptingOnly === "boolean") acceptingOnlyInput.checked = profile.acceptingOnly;
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

  function matchesKeyword(item, terms) {
    if (!terms.length) return true;
    const haystack = `${item.title} ${item.institutionName || ""}`.toLowerCase();
    return terms.every((t) => haystack.includes(t.toLowerCase()));
  }

  function runSearch(profile) {
    const terms = profile.keyword.length ? profile.keyword.split(/\s+/) : [];
    const matches = subsidyData.items.filter((item) => {
      if (profile.prefecture && item.targetAreaSearch && item.targetAreaSearch !== "全国" && item.targetAreaSearch !== profile.prefecture) {
        return false;
      }
      if (profile.employees && item.targetNumberOfEmployees && item.targetNumberOfEmployees !== profile.employees) {
        return false;
      }
      if (profile.acceptingOnly && !isAccepting(item)) return false;
      if (!matchesKeyword(item, terms)) return false;
      return true;
    });
    renderResults(matches);
  }

  function renderResults(items) {
    resultsListEl.innerHTML = "";
    if (!items.length) {
      statusEl.textContent = "条件に合う制度が見つかりませんでした。キーワードを変えるか、都道府県・従業員数の指定を外してみてください。";
      return;
    }
    statusEl.textContent = `${items.length}件の制度が見つかりました。`;
    for (const item of items) {
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
      resultsListEl.appendChild(li);
    }
  }

  function handleSubmit(ev) {
    ev.preventDefault();
    const profile = {
      orgType: form.querySelector('input[name="orgType"]:checked').value,
      prefecture: prefectureSelect.value,
      city: cityInput.value.trim(),
      employees: employeesSelect.value,
      keyword: keywordInput.value.trim(),
      acceptingOnly: acceptingOnlyInput.checked,
    };
    if (profile.keyword.length < 2) {
      statusEl.textContent = "検索キーワードを2文字以上入力してください。";
      return;
    }
    saveProfile(profile);
    runSearch(profile);
  }

  async function init() {
    initOptions();
    loadProfile();
    form.addEventListener("submit", handleSubmit);
    await loadSubsidyData();
  }

  init();
})();
