(() => {
  const API_BASE = "https://api.jgrants-portal.go.jp/exp/v1/public/subsidies";
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

  function buildParams({ keyword, prefecture, employees, acceptingOnly }) {
    const params = new URLSearchParams();
    params.set("keyword", keyword);
    params.set("sort", "acceptance_end_datetime");
    params.set("order", "ASC");
    params.set("acceptance", acceptingOnly ? "1" : "0");
    if (prefecture) params.set("target_area_search", prefecture);
    if (employees) params.set("target_number_of_employees", employees);
    return params;
  }

  async function fetchSubsidies(params) {
    const res = await fetch(`${API_BASE}?${params.toString()}`);
    if (!res.ok) {
      const err = new Error(`API error: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // jGrantsが未対応・想定外の値を返した場合に備え、条件を段階的に緩めて再試行する。
  async function searchWithFallback(profile) {
    const attempts = [];
    attempts.push({ ...profile });
    if (profile.employees) attempts.push({ ...profile, employees: "" });
    if (profile.prefecture) attempts.push({ ...profile, employees: "", prefecture: "" });

    let lastError = null;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const params = buildParams(attempt);
      try {
        const data = await fetchSubsidies(params);
        const relaxed = i > 0;
        return { data, relaxed, attempt };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  function formatDate(value) {
    if (!value) return "未定";
    // jGrantsは "YYYY-MM-DD" 形式のことが多いが、念のためそのまま表示にフォールバックする
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return `${m[1]}/${m[2]}/${m[3]}`;
    return value;
  }

  function renderResults(items, { relaxed } = {}) {
    resultsListEl.innerHTML = "";
    if (relaxed) {
      const note = document.createElement("p");
      note.className = "notice";
      note.textContent = "一部の絞り込み条件（従業員数・都道府県など）では結果が得られなかったため、条件を緩めて再検索しました。表示された制度がご自身の条件に合うか、詳細ページで確認してください。";
      resultsListEl.before(note);
    }
    if (!items || items.length === 0) {
      statusEl.textContent = "条件に合う制度が見つかりませんでした。キーワードを変えるか、都道府県・従業員数の指定を外してみてください。";
      return;
    }
    statusEl.textContent = `${items.length}件の制度が見つかりました。`;
    for (const item of items) {
      const li = document.createElement("li");
      li.className = "result-item";
      const title = item.title || item.name || "（名称未取得）";
      const area = item.target_area_search || "";
      li.innerHTML = `
        <button type="button" class="result-toggle">
          <span class="result-title">${escapeHtml(title)}</span>
          <span class="result-meta">
            ${area ? `対象地域: ${escapeHtml(area)} ／ ` : ""}
            募集終了: ${escapeHtml(formatDate(item.acceptance_end_datetime))}
          </span>
        </button>
        <div class="result-detail" hidden></div>
      `;
      const toggle = li.querySelector(".result-toggle");
      const detailEl = li.querySelector(".result-detail");
      toggle.addEventListener("click", () => toggleDetail(item.id, detailEl));
      resultsListEl.appendChild(li);
    }
  }

  const detailCache = new Map();

  async function toggleDetail(id, detailEl) {
    const isHidden = detailEl.hasAttribute("hidden");
    if (!isHidden) {
      detailEl.setAttribute("hidden", "");
      return;
    }
    detailEl.removeAttribute("hidden");
    if (detailCache.has(id)) {
      detailEl.innerHTML = detailCache.get(id);
      return;
    }
    detailEl.innerHTML = `<p class="hint">読み込み中...</p>`;
    try {
      const res = await fetch(`${API_BASE}/id/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      const info = (data && data.result && data.result[0]) || {};
      const html = `
        <dl class="detail-list">
          ${info.subsidy_max_limit ? `<dt>補助上限額</dt><dd>${escapeHtml(String(info.subsidy_max_limit))}円</dd>` : ""}
          ${info.subsidy_rate ? `<dt>補助率</dt><dd>${escapeHtml(info.subsidy_rate)}</dd>` : ""}
          ${info.acceptance_start_datetime ? `<dt>募集開始</dt><dd>${escapeHtml(formatDate(info.acceptance_start_datetime))}</dd>` : ""}
          ${info.acceptance_end_datetime ? `<dt>募集終了</dt><dd>${escapeHtml(formatDate(info.acceptance_end_datetime))}</dd>` : ""}
          ${info.target_area_search ? `<dt>対象地域</dt><dd>${escapeHtml(info.target_area_search)}</dd>` : ""}
          ${info.target_number_of_employees ? `<dt>対象従業員数</dt><dd>${escapeHtml(info.target_number_of_employees)}</dd>` : ""}
        </dl>
        <p><a href="https://www.jgrants-portal.go.jp/subsidy/${encodeURIComponent(id)}" target="_blank" rel="noopener">jGrantsで詳細・公募要領を見る →</a></p>
      `;
      detailCache.set(id, html);
      detailEl.innerHTML = html;
    } catch (e) {
      detailEl.innerHTML = `<p class="notice">詳細情報の取得に失敗しました。<a href="https://www.jgrants-portal.go.jp/" target="_blank" rel="noopener">jGrantsのサイト</a>で名称を検索してご確認ください。</p>`;
    }
  }

  async function handleSubmit(ev) {
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

    statusEl.textContent = "検索中...";
    resultsListEl.innerHTML = "";
    const staleNote = resultsListEl.parentElement.querySelector(".notice");
    if (staleNote) staleNote.remove();

    try {
      const { data, relaxed } = await searchWithFallback(profile);
      renderResults(data && data.result, { relaxed });
    } catch (e) {
      statusEl.textContent = "検索に失敗しました。通信環境をご確認のうえ、しばらくしてから再度お試しください。下の「参考」リストもあわせてご確認ください。";
    }
  }

  initOptions();
  loadProfile();
  form.addEventListener("submit", handleSubmit);
})();
