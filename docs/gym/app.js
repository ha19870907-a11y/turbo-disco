(function () {
  "use strict";

  var STORES = [
    { id: "kashiwa", name: "ACTIVE GYM 柏店", addr: "千葉県柏市東上町3-9", tel: "04-7114-3276", icon: "🏢" },
    { id: "funabashi", name: "ACTIVE GYM 船橋店", addr: "千葉県船橋市本町1-22-14", tel: "047-411-2233", icon: "🏙️" }
  ];

  var DOW = ["日", "月", "火", "水", "木", "金", "土"];
  var SLOT_TIMES = ["10:00-10:30", "13:00-13:30", "16:30-17:00", "17:30-18:00", "18:30-19:00", "19:30-20:00"];

  var STORAGE_KEY = "activegym_reservations";
  var MEMBER_KEY = "activegym_member";
  var MEMBERS_KEY = "activegym_members";

  var SEED_MEMBERS = [
    { id: "seed1", lastName: "佐藤", firstName: "健太", lastKana: "サトウ", firstKana: "ケンタ", gender: "male", birthLabel: "1992年4月10日", email: "kenta.sato@example.com", joinedAt: "2026-06-02" },
    { id: "seed2", lastName: "鈴木", firstName: "美咲", lastKana: "スズキ", firstKana: "ミサキ", gender: "female", birthLabel: "1998年11月23日", email: "misaki.suzuki@example.com", joinedAt: "2026-07-15" },
    { id: "seed3", lastName: "高橋", firstName: "陸", lastKana: "タカハシ", firstKana: "リク", gender: "male", birthLabel: "1985年1月5日", email: "riku.takahashi@example.com", joinedAt: "2026-08-20" }
  ];

  var state = {
    store: null,
    dateIndex: 0,
    slot: null,
    dates: []
  };

  var navStack = ["home"];

  // ---------- utils ----------
  function seededRand(seed) {
    var x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function buildDates() {
    var out = [];
    var today = new Date();
    for (var i = 0; i < 7; i++) {
      var d = new Date(today);
      d.setDate(today.getDate() + i);
      out.push(d);
    }
    return out;
  }

  function fmtDate(d) {
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  function slotsForDate(storeId, dateIndex) {
    return SLOT_TIMES.map(function (t, i) {
      var seed = dateIndex * 97 + i * 13 + (storeId === "kashiwa" ? 1 : 2);
      var r = seededRand(seed);
      var remaining = r < 0.3 ? 0 : (r < 0.6 ? 1 : (r < 0.85 ? 2 : 3));
      return { time: t, remaining: remaining };
    });
  }

  function loadReservations() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveReservations(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function isMember() {
    return localStorage.getItem(MEMBER_KEY) === "1";
  }

  function loadMembers() {
    try {
      return JSON.parse(localStorage.getItem(MEMBERS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveMembers(list) {
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(list));
  }

  function ensureSeedMembers() {
    if (!localStorage.getItem(MEMBERS_KEY)) {
      saveMembers(SEED_MEMBERS);
    }
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 1800);
  }

  // ---------- navigation ----------
  var SCREEN_IDS = ["home", "trial-store", "trial-datetime", "trial-confirm", "trial-done", "join", "join-done", "schedule", "admin"];
  var NAV_GROUP = {
    "home": "home",
    "join": "join", "join-done": "join",
    "trial-store": "trial-store", "trial-datetime": "trial-store", "trial-confirm": "trial-store", "trial-done": "trial-store",
    "schedule": "schedule",
    "admin": "admin"
  };
  var TITLES = {
    "trial-store": "体験予約 - 店舗選択",
    "trial-datetime": "体験予約 - 日時選択",
    "trial-confirm": "体験予約 - 確認",
    "trial-done": "体験予約 完了",
    "join": "会員登録",
    "join-done": "登録完了",
    "schedule": "スケジュール管理",
    "admin": "管理画面（スタッフ用）"
  };

  function show(screenId, opts) {
    opts = opts || {};
    SCREEN_IDS.forEach(function (id) {
      var el = document.getElementById("screen-" + id);
      if (el) el.classList.toggle("active", id === screenId);
    });

    var topbar = document.getElementById("topbar");
    var backBtn = document.getElementById("backBtn");
    var titleEl = document.getElementById("topbarTitle");

    if (screenId === "home") {
      topbar.classList.remove("with-back");
      backBtn.hidden = true;
      titleEl.hidden = true;
    } else {
      topbar.classList.add("with-back");
      backBtn.hidden = false;
      titleEl.hidden = false;
      titleEl.textContent = TITLES[screenId] || "";
    }

    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      var target = btn.getAttribute("data-go");
      btn.classList.toggle("active", NAV_GROUP[screenId] === target || (target === "trial-store" && NAV_GROUP[screenId] === "trial-store"));
    });

    window.scrollTo(0, 0);
    renderScreen(screenId);
  }

  function go(screenId, opts) {
    opts = opts || {};
    if (opts.replace) {
      navStack[navStack.length - 1] = screenId;
    } else {
      navStack.push(screenId);
    }
    show(screenId, opts);
  }

  function back() {
    if (navStack.length > 1) {
      navStack.pop();
      show(navStack[navStack.length - 1]);
    } else {
      show("home");
    }
  }

  // ---------- render per screen ----------
  function renderScreen(screenId) {
    if (screenId === "home") renderHome();
    if (screenId === "trial-store") renderStoreList();
    if (screenId === "trial-datetime") renderDateTime();
    if (screenId === "trial-confirm") renderConfirm();
    if (screenId === "schedule") renderSchedule();
    if (screenId === "join") prefillJoinDates();
    if (screenId === "admin") renderAdmin();
  }

  function renderHome() {
    var joinPill = document.getElementById("joinStatusPill");
    joinPill.innerHTML = isMember()
      ? '<span class="status-pill ok">✓ 登録済み</span>'
      : "";

    var reservations = loadReservations();
    var schedPill = document.getElementById("scheduleStatusPill");
    schedPill.innerHTML = reservations.length
      ? '<span class="status-pill count">予約 ' + reservations.length + '件</span>'
      : "";
  }

  function renderStoreList() {
    var wrap = document.getElementById("storeList");
    wrap.innerHTML = "";
    STORES.forEach(function (s) {
      var btn = document.createElement("button");
      btn.className = "store-card" + (state.store && state.store.id === s.id ? " selected" : "");
      btn.innerHTML =
        '<div class="store-thumb">' + s.icon + '</div>' +
        '<div>' +
        '  <div class="name">' + s.name + '</div>' +
        '  <div class="addr">' + s.addr + '<br>TEL: ' + s.tel + '</div>' +
        '</div>';
      btn.addEventListener("click", function () {
        state.store = s;
        state.slot = null;
        go("trial-datetime");
      });
      wrap.appendChild(btn);
    });
  }

  function renderDateTime() {
    if (!state.dates.length) state.dates = buildDates();

    var tabsWrap = document.getElementById("dateTabs");
    tabsWrap.innerHTML = "";
    state.dates.forEach(function (d, i) {
      var tab = document.createElement("button");
      tab.className = "date-tab" + (i === state.dateIndex ? " selected" : "");
      tab.innerHTML = '<span class="dow">' + DOW[d.getDay()] + '</span><span class="dom">' + fmtDate(d) + '</span>';
      tab.addEventListener("click", function () {
        state.dateIndex = i;
        state.slot = null;
        renderDateTime();
      });
      tabsWrap.appendChild(tab);
    });

    var grid = document.getElementById("slotGrid");
    grid.innerHTML = "";
    var slots = slotsForDate(state.store ? state.store.id : "kashiwa", state.dateIndex);
    slots.forEach(function (s) {
      var btn = document.createElement("button");
      var full = s.remaining <= 0;
      var selected = state.slot && state.slot.time === s.time;
      btn.className = "slot-btn" + (full ? " full" : "") + (selected ? " selected" : "");
      btn.innerHTML =
        '<div class="time">' + s.time + '</div>' +
        '<div class="avail">' + (full ? "満席" : "残り" + s.remaining + "枠") + '</div>';
      if (!full) {
        btn.addEventListener("click", function () {
          state.slot = s;
          renderDateTime();
        });
      } else {
        btn.disabled = true;
      }
      grid.appendChild(btn);
    });

    document.getElementById("toConfirmBtn").disabled = !state.slot;
  }

  function renderConfirm() {
    var wrap = document.getElementById("trialSummary");
    var d = state.dates[state.dateIndex];
    wrap.innerHTML =
      row("店舗", state.store.name) +
      row("日付", fmtDate(d) + "（" + DOW[d.getDay()] + "）") +
      row("時間", state.slot.time) +
      row("残り枠", state.slot.remaining + "枠");
  }

  function row(k, v) {
    return '<div class="summary-row"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

  function renderSchedule() {
    var wrap = document.getElementById("resList");
    var list = loadReservations();
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-note">現在、予約はありません。<br>体験予約から気軽に始められます。</div>';
      return;
    }
    list.sort(function (a, b) { return a.sortKey - b.sortKey; });
    wrap.innerHTML = "";
    list.forEach(function (r) {
      var card = document.createElement("div");
      card.className = "res-card";
      card.innerHTML =
        '<div class="top-row"><span class="res-tag trial">体験</span><span class="date-big">' + r.dateLabel + '</span></div>' +
        '<div class="meta">' + r.storeName + '　' + r.time + '</div>' +
        '<div class="actions"><button data-id="' + r.id + '">キャンセルする</button></div>';
      card.querySelector("button").addEventListener("click", function () {
        if (confirm("この予約をキャンセルしますか？")) {
          var updated = loadReservations().filter(function (x) { return x.id !== r.id; });
          saveReservations(updated);
          renderSchedule();
          toast("予約をキャンセルしました");
        }
      });
      wrap.appendChild(card);
    });
  }

  function renderAdmin() {
    var members = loadMembers();
    var reservations = loadReservations();

    document.getElementById("statMembers").textContent = members.length;
    document.getElementById("statReservations").textContent = reservations.length;
    document.getElementById("statStores").textContent = STORES.length;

    var memberWrap = document.getElementById("memberList");
    if (!members.length) {
      memberWrap.innerHTML = '<div class="empty-note">会員が登録されるとここに表示されます。</div>';
    } else {
      var sorted = members.slice().sort(function (a, b) { return (b.joinedAt || "").localeCompare(a.joinedAt || ""); });
      memberWrap.innerHTML = sorted.map(function (m) {
        var genderLabel = m.gender === "male" ? "男性" : (m.gender === "female" ? "女性" : "回答なし");
        return (
          '<div class="member-card">' +
          '  <div class="name-row"><span class="name">' + m.lastName + ' ' + m.firstName + '</span><span class="kana">（' + m.lastKana + ' ' + m.firstKana + '）</span></div>' +
          '  <div class="meta">' +
          '    <span>性別: <b>' + genderLabel + '</b></span>' +
          '    <span>生年月日: <b>' + m.birthLabel + '</b></span><br>' +
          '    <span>メール: <b>' + m.email + '</b></span>' +
          '    <span>登録日: <b>' + m.joinedAt + '</b></span>' +
          '  </div>' +
          '</div>'
        );
      }).join("");
    }

    var resWrap = document.getElementById("adminResList");
    if (!reservations.length) {
      resWrap.innerHTML = '<div class="empty-note">現在、体験予約はありません。</div>';
    } else {
      var sortedRes = reservations.slice().sort(function (a, b) { return a.sortKey - b.sortKey; });
      resWrap.innerHTML = "";
      sortedRes.forEach(function (r) {
        var card = document.createElement("div");
        card.className = "res-card";
        card.innerHTML =
          '<div class="top-row"><span class="res-tag trial">体験</span><span class="date-big">' + r.dateLabel + '</span></div>' +
          '<div class="meta">' + r.storeName + '　' + r.time + '</div>' +
          '<div class="actions"><button data-id="' + r.id + '">キャンセルする</button></div>';
        card.querySelector("button").addEventListener("click", function () {
          if (confirm("この予約をキャンセルしますか？")) {
            var updated = loadReservations().filter(function (x) { return x.id !== r.id; });
            saveReservations(updated);
            renderAdmin();
            toast("予約をキャンセルしました");
          }
        });
        resWrap.appendChild(card);
      });
    }
  }

  // ---------- join form ----------
  function prefillJoinDates() {
    var y = document.getElementById("birthYear");
    var m = document.getElementById("birthMonth");
    var dSel = document.getElementById("birthDay");
    if (y.options.length) return;

    var thisYear = new Date().getFullYear();
    var opt0 = new Option("年", "");
    y.appendChild(opt0);
    for (var yr = thisYear - 15; yr >= thisYear - 90; yr--) y.appendChild(new Option(yr + "年", yr));

    m.appendChild(new Option("月", ""));
    for (var mo = 1; mo <= 12; mo++) m.appendChild(new Option(mo + "月", mo));

    dSel.appendChild(new Option("日", ""));
    for (var da = 1; da <= 31; da++) dSel.appendChild(new Option(da + "日", da));
  }

  function setupGenderPills() {
    var pills = document.querySelectorAll("#genderPills .pill");
    pills.forEach(function (p) {
      p.addEventListener("click", function () {
        pills.forEach(function (x) { x.classList.remove("selected"); });
        p.classList.add("selected");
      });
    });
  }

  function validateJoin() {
    var ok = true;
    var lastName = document.getElementById("lastName");
    var firstName = document.getElementById("firstName");
    var nameField = lastName.closest(".field");
    if (!lastName.value.trim() || !firstName.value.trim()) {
      nameField.classList.add("has-error");
      ok = false;
    } else {
      nameField.classList.remove("has-error");
    }

    var email = document.getElementById("joinEmail");
    var emailField = email.closest(".field");
    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    emailField.classList.toggle("has-error", !emailOk);
    if (!emailOk) ok = false;

    var pw = document.getElementById("joinPassword");
    var pwField = pw.closest(".field");
    var pwOk = pw.value.length >= 8;
    pwField.classList.toggle("has-error", !pwOk);
    if (!pwOk) ok = false;

    return ok;
  }

  function setupJoin() {
    setupGenderPills();
    document.getElementById("submitJoinBtn").addEventListener("click", function () {
      if (!validateJoin()) {
        toast("未入力・不備の項目があります");
        return;
      }
      if (!document.getElementById("agreeCheck").checked) {
        toast("利用規約への同意が必要です");
        return;
      }

      var genderPill = document.querySelector("#genderPills .pill.selected");
      var y = document.getElementById("birthYear").value;
      var m = document.getElementById("birthMonth").value;
      var d = document.getElementById("birthDay").value;
      var birthLabel = (y && m && d) ? (y + "年" + m + "月" + d + "日") : "未回答";
      var today = new Date();
      var joinedAt = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");

      var members = loadMembers();
      members.push({
        id: "m" + Date.now(),
        lastName: document.getElementById("lastName").value.trim(),
        firstName: document.getElementById("firstName").value.trim(),
        lastKana: document.getElementById("lastKana").value.trim(),
        firstKana: document.getElementById("firstKana").value.trim(),
        gender: genderPill ? genderPill.getAttribute("data-val") : "none",
        birthLabel: birthLabel,
        email: document.getElementById("joinEmail").value.trim(),
        joinedAt: joinedAt
      });
      saveMembers(members);

      localStorage.setItem(MEMBER_KEY, "1");
      go("join-done");
    });
  }

  // ---------- trial flow wiring ----------
  function setupTrial() {
    document.getElementById("toConfirmBtn").addEventListener("click", function () {
      if (!state.slot) return;
      go("trial-confirm");
    });

    document.getElementById("confirmTrialBtn").addEventListener("click", function () {
      var d = state.dates[state.dateIndex];
      var list = loadReservations();
      list.push({
        id: "r" + Date.now(),
        storeName: state.store.name,
        dateLabel: fmtDate(d) + "（" + DOW[d.getDay()] + "）",
        time: state.slot.time,
        sortKey: d.getTime()
      });
      saveReservations(list);
      go("trial-done");
    });
  }

  // ---------- global nav wiring ----------
  function setupGlobalNav() {
    document.querySelectorAll("[data-go]").forEach(function (el) {
      el.addEventListener("click", function () {
        var target = el.getAttribute("data-go");
        if (target === "trial-store") {
          state.store = null;
          state.slot = null;
        }
        go(target, { replace: target === "home" || el.classList.contains("nav-btn") });
        if (target === "home" || el.classList.contains("nav-btn")) {
          navStack = [target];
        }
      });
    });

    document.getElementById("backBtn").addEventListener("click", back);
  }

  // ---------- init ----------
  document.addEventListener("DOMContentLoaded", function () {
    ensureSeedMembers();
    setupGlobalNav();
    setupTrial();
    setupJoin();
    show("home");
  });
})();
