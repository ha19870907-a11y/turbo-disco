"use strict";

// 結婚式ムービー作成ツール
// すべての処理をブラウザ内(Canvas + MediaRecorder)で完結させる。
// サーバーを使わないので、写真・音楽が外部に送信されることはない。

const THEMES = {
  pink: { bg1: "#f6d9e2", bg2: "#c98a9c", text: "#fffaf7", accent: "#e8c78a" },
  navy: { bg1: "#1f2a44", bg2: "#0d1424", text: "#f5efe3", accent: "#d9b968" },
  green: { bg1: "#e7ecdf", bg2: "#5c7a5a", text: "#fffdf7", accent: "#c9a24b" },
};

// オープニング演出テンプレート用のネオンカラー（背景は常に黒）
const NEON_THEMES = {
  pink: { bg1: "#000000", bg2: "#000000", text: "#ffffff", accent: "#ff2bd6" },
  blue: { bg1: "#000000", bg2: "#000000", text: "#ffffff", accent: "#22e3ff" },
  green: { bg1: "#000000", bg2: "#000000", text: "#ffffff", accent: "#39ff6a" },
  yellow: { bg1: "#000000", bg2: "#000000", text: "#ffffff", accent: "#fff81f" },
};

const CANVAS_W = 1280;
const CANVAS_H = 720;
const INTRO_DUR = 3.2;
const OUTRO_DUR = 3.2;
const FADE = 0.6;
const ZOOM_AMOUNT = 0.16;
const TRANSITION_TYPES = ["crossfade", "slide", "zoom", "wipe", "flash"];
const AUDIO_CROSSFADE_SEC = 1.2;

// 入力ファイルに対する上限（悪意あるファイルやサイズの大きすぎるファイルで
// タブがフリーズ・クラッシュするのを防ぐための安全策）
const MAX_PHOTOS = 300;
const MAX_PHOTO_BYTES = 30 * 1024 * 1024; // 30MB/枚
const MAX_AUDIO_BYTES = 150 * 1024 * 1024; // 150MB/曲
const MAX_BGM_TRACKS = 20;
const MAX_IMAGE_LONG_EDGE = 2400; // 書き出しに必要な解像度を大きく超える画像はここまで縮小して保持する
const MAX_CAPTION_LENGTH = 40;

const state = {
  bgmFiles: [], // { id, file }
  nextBgmId: 1,
};

const els = {
  standardPhotosSection: document.getElementById("standard-photos-section"),
  standardSettingsSection: document.getElementById("standard-settings-section"),
  openingSection: document.getElementById("opening-section"),
  openingPhotosSection: document.getElementById("opening-photos-section"),

  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  photoGrid: document.getElementById("photo-grid"),
  title1: document.getElementById("title1"),
  title2: document.getElementById("title2"),
  dateText: document.getElementById("date-text"),
  endMessage: document.getElementById("end-message"),
  themeSelect: document.getElementById("theme-select"),
  photoDuration: document.getElementById("photo-duration"),
  transitionType: document.getElementById("transition-type"),
  transitionDuration: document.getElementById("transition-duration"),

  opGroomName: document.getElementById("op-groom-name"),
  opGroomSub1: document.getElementById("op-groom-sub1"),
  opGroomSub2: document.getElementById("op-groom-sub2"),
  opBrideName: document.getElementById("op-bride-name"),
  opBrideSub1: document.getElementById("op-bride-sub1"),
  opBrideSub2: document.getElementById("op-bride-sub2"),
  opNeonColor: document.getElementById("op-neon-color"),
  opPhotoDuration: document.getElementById("op-photo-duration"),
  opTransitionType: document.getElementById("op-transition-type"),
  opTransitionDuration: document.getElementById("op-transition-duration"),

  groomDropzone: document.getElementById("groom-dropzone"),
  groomFileInput: document.getElementById("groom-file-input"),
  groomGrid: document.getElementById("groom-grid"),
  brideDropzone: document.getElementById("bride-dropzone"),
  brideFileInput: document.getElementById("bride-file-input"),
  brideGrid: document.getElementById("bride-grid"),
  togetherDropzone: document.getElementById("together-dropzone"),
  togetherFileInput: document.getElementById("together-file-input"),
  togetherGrid: document.getElementById("together-grid"),

  durationEstimate: document.getElementById("duration-estimate"),
  createBtn: document.getElementById("create-btn"),
  progressBox: document.getElementById("progress-box"),
  progressFill: document.getElementById("progress-fill"),
  progressLabel: document.getElementById("progress-label"),
  previewBox: document.getElementById("preview-box"),
  previewVideo: document.getElementById("preview-video"),
  downloadSilent: document.getElementById("download-silent"),
  bgmSection: document.getElementById("bgm-section"),
  bgmDropzone: document.getElementById("bgm-dropzone"),
  bgmInput: document.getElementById("bgm-input"),
  bgmList: document.getElementById("bgm-list"),
  addBgmBtn: document.getElementById("add-bgm-btn"),
  bgmProgressBox: document.getElementById("bgm-progress-box"),
  bgmProgressFill: document.getElementById("bgm-progress-fill"),
  bgmProgressLabel: document.getElementById("bgm-progress-label"),
  finalBox: document.getElementById("final-box"),
  finalVideo: document.getElementById("final-video"),
  downloadFinal: document.getElementById("download-final"),
  canvas: document.getElementById("render-canvas"),
};

function getTemplate() {
  const checked = document.querySelector('input[name="template"]:checked');
  return checked ? checked.value : "standard";
}

function getSettings() {
  const template = getTemplate();
  if (template === "opening") {
    return {
      template,
      theme: NEON_THEMES[els.opNeonColor.value] || NEON_THEMES.pink,
      photoDuration: Math.min(Math.max(Number(els.opPhotoDuration.value) || 1, 0.4), 3),
      transitionType: els.opTransitionType.value || "flash",
      transitionDuration: Math.min(Math.max(Number(els.opTransitionDuration.value) || 0.3, 0.15), 1),
      groomName: (els.opGroomName.value || "GROOM").trim().toUpperCase(),
      groomSub1: els.opGroomSub1.value.trim(),
      groomSub2: els.opGroomSub2.value.trim(),
      brideName: (els.opBrideName.value || "BRIDE").trim().toUpperCase(),
      brideSub1: els.opBrideSub1.value.trim(),
      brideSub2: els.opBrideSub2.value.trim(),
      groomPhotos: groomGroup.photos,
      bridePhotos: brideGroup.photos,
      togetherPhotos: togetherGroup.photos,
    };
  }
  return {
    template,
    title1: els.title1.value.trim(),
    title2: els.title2.value.trim(),
    dateText: els.dateText.value.trim(),
    endMessage: els.endMessage.value.trim() || "Thank You",
    theme: THEMES[els.themeSelect.value] || THEMES.pink,
    photoDuration: Math.min(Math.max(Number(els.photoDuration.value) || 4, 1.5), 10),
    transitionType: els.transitionType.value || "crossfade",
    transitionDuration: Math.min(Math.max(Number(els.transitionDuration.value) || 0.8, 0.3), 2),
    photos: standardGroup.photos,
  };
}

// --- 写真グループ（スタンダード用1つ + オープニング用3パート）共通ロジック ---

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function intrinsicSize(imgLike) {
  return {
    width: imgLike.naturalWidth || imgLike.width,
    height: imgLike.naturalHeight || imgLike.height,
  };
}

// 長辺がMAX_IMAGE_LONG_EDGEを超える画像は、書き出し解像度(1280x720)に対して
// 過剰なメモリを消費するため、事前にキャンバスへ縮小コピーしてから保持する。
// (スマホの高画素写真や、意図的にサイズの大きい画像を大量に読み込ませて
// タブをクラッシュさせようとするケースへの対策)
function capImageSize(img) {
  const { width, height } = intrinsicSize(img);
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_IMAGE_LONG_EDGE || !longEdge) return img;
  const scale = MAX_IMAGE_LONG_EDGE / longEdge;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  off.getContext("2d").drawImage(img, 0, 0, w, h);
  return off;
}

// 写真の追加・並べ替え・キャプション入力・削除をまとめたUIコンポーネント。
// スタンダードの単一グループと、オープニング演出の新郎/新婦/2人パートの
// 3グループで同じロジックを使い回す。
function createPhotoGroup({ gridEl, dropzoneEl, fileInputEl, onChange }) {
  const group = { photos: [], nextId: 1 };

  function render() {
    gridEl.innerHTML = "";
    group.photos.forEach((photo, index) => {
      const item = document.createElement("div");
      item.className = "photo-item";
      item.draggable = true;
      item.dataset.id = String(photo.id);

      const thumb = document.createElement("div");
      thumb.className = "photo-thumb";

      const img = document.createElement("img");
      img.src = photo.url;
      thumb.appendChild(img);

      const badge = document.createElement("span");
      badge.className = "order-badge";
      badge.textContent = String(index + 1);
      thumb.appendChild(badge);

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        URL.revokeObjectURL(photo.url);
        group.photos = group.photos.filter((p) => p.id !== photo.id);
        render();
        onChange();
      });
      thumb.appendChild(removeBtn);
      item.appendChild(thumb);

      const captionInput = document.createElement("input");
      captionInput.type = "text";
      captionInput.className = "photo-caption-input";
      captionInput.placeholder = "文字を入れる（任意）";
      captionInput.maxLength = MAX_CAPTION_LENGTH;
      captionInput.value = photo.caption || "";
      captionInput.draggable = false; // 親要素のdraggable=trueを継承させず、テキスト選択と競合させない
      captionInput.addEventListener("input", () => {
        photo.caption = captionInput.value;
      });
      item.appendChild(captionInput);

      item.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(photo.id));
        e.dataTransfer.effectAllowed = "move";
      });
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        item.classList.add("drag-over");
      });
      item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");
        const draggedId = Number(e.dataTransfer.getData("text/plain"));
        if (draggedId === photo.id) return;
        const fromIndex = group.photos.findIndex((p) => p.id === draggedId);
        const toIndex = group.photos.findIndex((p) => p.id === photo.id);
        if (fromIndex < 0 || toIndex < 0) return;
        const [moved] = group.photos.splice(fromIndex, 1);
        group.photos.splice(toIndex, 0, moved);
        render();
      });

      gridEl.appendChild(item);
    });
  }

  async function addFiles(fileList) {
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) return;

    const remainingSlots = MAX_PHOTOS - group.photos.length;
    if (remainingSlots <= 0) {
      alert(`写真は最大${MAX_PHOTOS}枚まで追加できます`);
      return;
    }
    const toAdd = incoming.slice(0, remainingSlots);
    if (incoming.length > toAdd.length) {
      alert(`写真は最大${MAX_PHOTOS}枚までのため、一部の写真は追加されませんでした`);
    }

    let skippedLarge = 0;
    let skippedInvalid = 0;
    for (const file of toAdd) {
      if (file.size > MAX_PHOTO_BYTES) {
        skippedLarge++;
        continue;
      }
      const url = URL.createObjectURL(file);
      try {
        const rawImg = await loadImage(url);
        const renderSource = capImageSize(rawImg);
        group.photos.push({ id: group.nextId++, url, img: renderSource, caption: "" });
      } catch (err) {
        skippedInvalid++;
        URL.revokeObjectURL(url);
      }
    }
    if (skippedLarge > 0) {
      alert(`容量が大きすぎる写真${skippedLarge}枚は追加しませんでした（上限: ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)}MB/枚）`);
    }
    if (skippedInvalid > 0) {
      alert(`読み込めない画像ファイルが${skippedInvalid}件あったためスキップしました`);
    }
    render();
    onChange();
  }

  dropzoneEl.addEventListener("click", () => fileInputEl.click());
  fileInputEl.addEventListener("change", (e) => {
    addFiles(e.target.files);
    fileInputEl.value = "";
  });
  ["dragenter", "dragover"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove("dragover");
    })
  );
  dropzoneEl.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  return group;
}

const standardGroup = createPhotoGroup({
  gridEl: els.photoGrid,
  dropzoneEl: els.dropzone,
  fileInputEl: els.fileInput,
  onChange: () => updateDurationEstimate(),
});
const groomGroup = createPhotoGroup({
  gridEl: els.groomGrid,
  dropzoneEl: els.groomDropzone,
  fileInputEl: els.groomFileInput,
  onChange: () => updateDurationEstimate(),
});
const brideGroup = createPhotoGroup({
  gridEl: els.brideGrid,
  dropzoneEl: els.brideDropzone,
  fileInputEl: els.brideFileInput,
  onChange: () => updateDurationEstimate(),
});
const togetherGroup = createPhotoGroup({
  gridEl: els.togetherGrid,
  dropzoneEl: els.togetherDropzone,
  fileInputEl: els.togetherFileInput,
  onChange: () => updateDurationEstimate(),
});

document.querySelectorAll('input[name="template"]').forEach((radio) => {
  radio.addEventListener("change", updateTemplateVisibility);
});

function updateTemplateVisibility() {
  const isOpening = getTemplate() === "opening";
  els.standardPhotosSection.classList.toggle("hidden", isOpening);
  els.standardSettingsSection.classList.toggle("hidden", isOpening);
  els.openingSection.classList.toggle("hidden", !isOpening);
  els.openingPhotosSection.classList.toggle("hidden", !isOpening);
  updateDurationEstimate();
}

[
  els.photoDuration,
  els.transitionDuration,
  els.opPhotoDuration,
  els.opTransitionDuration,
  els.dateText,
  els.title1,
  els.title2,
  els.endMessage,
  els.opGroomName,
  els.opBrideName,
].forEach((el) => el.addEventListener("input", updateDurationEstimate));

// --- BGM（複数曲）の追加・並べ替え ---

function renderBgmList() {
  els.bgmList.innerHTML = "";
  state.bgmFiles.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = "bgm-row";
    row.draggable = true;
    row.dataset.id = String(track.id);

    const badge = document.createElement("span");
    badge.className = "bgm-order";
    badge.textContent = String(index + 1);
    row.appendChild(badge);

    const name = document.createElement("span");
    name.className = "bgm-name";
    name.textContent = track.file.name;
    row.appendChild(name);

    const removeBtn = document.createElement("button");
    removeBtn.className = "bgm-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      state.bgmFiles = state.bgmFiles.filter((t) => t.id !== track.id);
      renderBgmList();
      updateAddBgmButtonState();
    });
    row.appendChild(removeBtn);

    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(track.id));
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      const draggedId = Number(e.dataTransfer.getData("text/plain"));
      if (draggedId === track.id) return;
      const fromIndex = state.bgmFiles.findIndex((t) => t.id === draggedId);
      const toIndex = state.bgmFiles.findIndex((t) => t.id === track.id);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = state.bgmFiles.splice(fromIndex, 1);
      state.bgmFiles.splice(toIndex, 0, moved);
      renderBgmList();
    });

    els.bgmList.appendChild(row);
  });
}

function updateAddBgmButtonState() {
  els.addBgmBtn.disabled = state.bgmFiles.length === 0;
}

function addBgmFiles(fileList) {
  const incoming = Array.from(fileList).filter((f) => f.type.startsWith("audio/"));
  if (incoming.length === 0) {
    if (fileList.length > 0) alert("音声ファイルを選択してください");
    return;
  }

  const remainingSlots = MAX_BGM_TRACKS - state.bgmFiles.length;
  if (remainingSlots <= 0) {
    alert(`BGMは最大${MAX_BGM_TRACKS}曲まで追加できます`);
    return;
  }
  const toAdd = incoming.slice(0, remainingSlots);
  if (incoming.length > toAdd.length) {
    alert(`BGMは最大${MAX_BGM_TRACKS}曲までのため、一部の曲は追加されませんでした`);
  }

  let skippedLarge = 0;
  toAdd.forEach((file) => {
    if (file.size > MAX_AUDIO_BYTES) {
      skippedLarge++;
      return;
    }
    state.bgmFiles.push({ id: state.nextBgmId++, file });
  });
  if (skippedLarge > 0) {
    alert(`容量が大きすぎる音声${skippedLarge}件は追加しませんでした（上限: ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB/曲）`);
  }

  renderBgmList();
  updateAddBgmButtonState();
}

els.bgmDropzone.addEventListener("click", () => els.bgmInput.click());
els.bgmInput.addEventListener("change", (e) => {
  addBgmFiles(e.target.files);
  els.bgmInput.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  els.bgmDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.bgmDropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.bgmDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.bgmDropzone.classList.remove("dragover");
  })
);
els.bgmDropzone.addEventListener("drop", (e) => addBgmFiles(e.dataTransfer.files));

// --- タイムライン構築 ---

// セグメント列から開始時刻・合計時間・音声ダック区間（クライマックスの一瞬の無音）を計算する。
// トランジション分だけ次のセグメントと重ねるのはスタンダード/オープニング共通のロジック。
function finalizeTimeline(segments, transitionDuration, duckIndices = []) {
  const startTimes = [];
  let t = 0;
  segments.forEach((seg, i) => {
    startTimes.push(t);
    t += seg.duration;
    if (i < segments.length - 1) t -= transitionDuration;
  });
  const total = Math.max(t, 1);
  const audioDucks = duckIndices.map((idx) => ({
    start: startTimes[idx],
    duration: Math.min(segments[idx].duration, 0.8),
  }));
  return { segments, startTimes, total, audioDucks };
}

function introLines(settings) {
  const names = [settings.title1, settings.title2].filter(Boolean).join(" ♥ ");
  const lines = [];
  if (names) lines.push(names);
  if (settings.dateText) lines.push(settings.dateText);
  if (lines.length === 0) lines.push("Wedding Movie");
  return lines;
}

function computeStandardTimeline(settings) {
  const segments = [];
  segments.push({ type: "title", duration: INTRO_DUR, lines: introLines(settings) });
  settings.photos.forEach((photo, i) => {
    segments.push({ type: "photo", duration: settings.photoDuration, photo, variant: i % 4 });
  });
  segments.push({ type: "title", duration: OUTRO_DUR, lines: [settings.endMessage] });
  return finalizeTimeline(segments, settings.transitionDuration);
}

function computeOpeningTimeline(settings) {
  const segments = [];
  const duckIndices = [];

  const pushImpact = (lines, duration, opts = {}) => {
    segments.push({
      type: "impact-text",
      duration,
      lines,
      bigLineIndex: opts.bigLineIndex ?? 0,
      bigFontSize: opts.bigFontSize || 52,
      lineHeight: opts.lineHeight || 64,
      flashOnEnter: opts.flashOnEnter || false,
      glitch: opts.glitch !== false,
    });
  };

  // 1. カウントダウン（0:00-0:15イメージ）
  pushImpact(["ARE YOU READY?"], 2, { bigFontSize: 66 });
  pushImpact(["GET READY", "FOR THE SHOW!"], 2, { bigFontSize: 56 });
  ["5", "4", "3", "2", "1", "0"].forEach((n) => {
    segments.push({ type: "countdown-number", duration: 1.3, number: n, flashOnEnter: true });
  });

  // 2. 新郎パート
  pushImpact(
    [`GROOM: ${settings.groomName}`, settings.groomSub1, settings.groomSub2].filter(Boolean),
    2,
    { bigFontSize: 44, lineHeight: 54 }
  );
  settings.groomPhotos.forEach((photo, i) => {
    segments.push({ type: "photo", duration: settings.photoDuration, photo, variant: i % 4 });
  });

  // 3. 新婦パート
  pushImpact(
    [`BRIDE: ${settings.brideName}`, settings.brideSub1, settings.brideSub2].filter(Boolean),
    2,
    { bigFontSize: 44, lineHeight: 54 }
  );
  settings.bridePhotos.forEach((photo, i) => {
    segments.push({ type: "photo", duration: settings.photoDuration, photo, variant: i % 4 });
  });

  // 4. 2人の出会い〜思い出パート
  pushImpact(["TWO PATHS CROSS", "SPECIAL MEMORIES"], 2, { bigFontSize: 48 });
  settings.togetherPhotos.forEach((photo, i) => {
    segments.push({ type: "photo", duration: settings.photoDuration, photo, variant: i % 4 });
  });

  // 5. クライマックス: 一瞬の静寂 → 名前発表
  duckIndices.push(segments.length);
  pushImpact([], 0.7, { glitch: false });
  pushImpact(["LADIES AND", "GENTLEMEN..."], 1.6, { bigFontSize: 58, flashOnEnter: true });
  pushImpact(["ARE YOU READY", "TO PARTY?"], 1.6, { bigFontSize: 54, flashOnEnter: true });
  pushImpact(["PLEASE WELCOME", `${settings.groomName} & ${settings.brideName}!!`], 4, {
    bigLineIndex: 1,
    bigFontSize: 50,
    flashOnEnter: true,
  });

  return finalizeTimeline(segments, settings.transitionDuration, duckIndices);
}

function computeTimeline(settings) {
  return settings.template === "opening" ? computeOpeningTimeline(settings) : computeStandardTimeline(settings);
}

function countPhotos(settings) {
  if (settings.template === "opening") {
    return settings.groomPhotos.length + settings.bridePhotos.length + settings.togetherPhotos.length;
  }
  return settings.photos.length;
}

function updateDurationEstimate() {
  const settings = getSettings();
  const { total } = computeTimeline(settings);
  const mins = Math.floor(total / 60);
  const secs = Math.round(total % 60);
  els.durationEstimate.textContent = `写真${countPhotos(settings)}枚 / 想定の動画の長さ: 約${mins > 0 ? mins + "分" : ""}${secs}秒`;
}

// --- 描画 ---

function fadeAlpha(localT, duration, fade) {
  const f = Math.min(fade, duration / 2);
  if (localT < f) return Math.max(0, localT / f);
  if (localT > duration - f) return Math.max(0, (duration - localT) / f);
  return 1;
}

function drawVignette(ctx, accentColor) {
  const grad = ctx.createRadialGradient(
    CANVAS_W / 2,
    CANVAS_H / 2,
    CANVAS_H * 0.35,
    CANVAS_W / 2,
    CANVAS_H / 2,
    CANVAS_H * 0.75
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.strokeStyle = accentColor;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, CANVAS_W - 28, CANVAS_H - 28);
  ctx.globalAlpha = 1;
}

function drawTitleCard(ctx, seg, localT, settings) {
  const theme = settings.theme;
  const grad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
  grad.addColorStop(0, theme.bg1);
  grad.addColorStop(1, theme.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const alpha = fadeAlpha(localT, seg.duration, FADE);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = theme.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lineHeight = 56;
  const startY = CANVAS_H / 2 - ((seg.lines.length - 1) * lineHeight) / 2;
  seg.lines.forEach((line, i) => {
    ctx.font = i === 0 ? "600 48px serif" : "300 28px serif";
    ctx.fillText(line, CANVAS_W / 2, startY + i * lineHeight);
  });

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 60, startY + seg.lines.length * lineHeight - 6);
  ctx.lineTo(CANVAS_W / 2 + 60, startY + seg.lines.length * lineHeight - 6);
  ctx.stroke();
  ctx.restore();
}

function drawCaption(ctx, text, localT, duration, theme) {
  const alpha = fadeAlpha(localT, duration, Math.min(FADE, duration / 2));
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  const barHeight = 92;
  const y = CANVAS_H - barHeight;
  const grad = ctx.createLinearGradient(0, y, 0, CANVAS_H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, y, CANVAS_W, barHeight);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "500 32px serif";
  ctx.fillText(text, CANVAS_W / 2, CANVAS_H - barHeight / 2 + 8, CANVAS_W - 80);

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 40, CANVAS_H - barHeight / 2 - 24);
  ctx.lineTo(CANVAS_W / 2 + 40, CANVAS_H - barHeight / 2 - 24);
  ctx.stroke();
  ctx.restore();
}

function drawPhoto(ctx, seg, localT, settings) {
  const { img } = seg.photo;
  const progress = Math.min(Math.max(localT / seg.duration, 0), 1);
  const zoomIn = seg.variant % 2 === 0;
  const scale = zoomIn ? 1 + ZOOM_AMOUNT * progress : 1 + ZOOM_AMOUNT * (1 - progress);

  const { width: imgW, height: imgH } = intrinsicSize(img);
  const imgRatio = imgW / imgH;
  const canvasRatio = CANVAS_W / CANVAS_H;
  let baseW, baseH;
  if (imgRatio > canvasRatio) {
    baseH = CANVAS_H;
    baseW = baseH * imgRatio;
  } else {
    baseW = CANVAS_W;
    baseH = baseW / imgRatio;
  }
  const drawW = baseW * scale;
  const drawH = baseH * scale;

  const maxOffsetX = (drawW - CANVAS_W) / 2;
  const maxOffsetY = (drawH - CANVAS_H) / 2;

  const directions = [
    [-1, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
  ];
  const [dx, dy] = directions[seg.variant % directions.length];
  const panProgress = zoomIn ? progress : 1 - progress;
  const offsetX = dx * maxOffsetX * panProgress;
  const offsetY = dy * maxOffsetY * panProgress;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.drawImage(
    img,
    CANVAS_W / 2 - drawW / 2 + offsetX,
    CANVAS_H / 2 - drawH / 2 + offsetY,
    drawW,
    drawH
  );

  if (seg.photo.caption) {
    drawCaption(ctx, seg.photo.caption, localT, seg.duration, settings.theme);
  }
}

// --- オープニング演出: ノイズ・グリッチ・インパクトテキスト ---

const noiseCanvas = document.createElement("canvas");
noiseCanvas.width = 160;
noiseCanvas.height = 90;
const noiseCtx = noiseCanvas.getContext("2d");
const noiseImageData = noiseCtx.createImageData(160, 90);

function drawNoiseOverlay(ctx, opacity) {
  const data = noiseImageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  noiseCtx.putImageData(noiseImageData, 0, 0);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(noiseCanvas, 0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

// impact-text / countdown-number セグメントの下描き用オフスクリーンバッファ
const impactBuffer = document.createElement("canvas");
impactBuffer.width = CANVAS_W;
impactBuffer.height = CANVAS_H;
const impactCtx = impactBuffer.getContext("2d");

// impactBufferに描いた内容を、フェード・グリッチスライス・入場フラッシュを
// つけながらメインのctxに合成する（impact-text/countdown-numberで共通）。
function finishImpactFrame(ctx, seg, localT) {
  // flashOnEnter系（カウントダウン数字・クライマックス）は白フラッシュとスケール
  // ポップだけで「ドカン」と出したいので、自前のフェードは重ねずフル表示にする。
  // それ以外（問いかけ文・パートタイトル）は従来通りゆるやかにフェードイン/アウトする。
  const alpha = seg.flashOnEnter ? 1 : fadeAlpha(localT, seg.duration, Math.min(0.25, seg.duration / 2 || 0.25));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(impactBuffer, 0, 0);
  if (seg.glitch) {
    const sliceCount = 3;
    for (let i = 0; i < sliceCount; i++) {
      const y = Math.random() * CANVAS_H;
      const h = 8 + Math.random() * 18;
      const dx = (Math.random() - 0.5) * 30;
      ctx.drawImage(impactBuffer, 0, y, CANVAS_W, h, dx, y, CANVAS_W, h);
    }
  }
  ctx.restore();

  if (seg.flashOnEnter) {
    const flashAlpha = Math.max(0, 1 - localT / 0.15);
    if (flashAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = flashAlpha * 0.85;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
  }
}

function drawImpactCard(ctx, seg, localT, settings) {
  impactCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  impactCtx.fillStyle = "#000000";
  impactCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawNoiseOverlay(impactCtx, 0.07);

  const lines = seg.lines || [];
  if (lines.length > 0) {
    const lineHeight = seg.lineHeight || 64;
    const startY = CANVAS_H / 2 - ((lines.length - 1) * lineHeight) / 2;
    impactCtx.textAlign = "center";
    impactCtx.textBaseline = "middle";
    lines.forEach((line, i) => {
      const isBig = i === seg.bigLineIndex;
      impactCtx.font = `800 ${isBig ? seg.bigFontSize : 28}px "Arial Black", Impact, sans-serif`;
      impactCtx.fillStyle = isBig ? settings.theme.accent : "#ffffff";
      impactCtx.fillText(line, CANVAS_W / 2, startY + i * lineHeight, CANVAS_W - 100);
    });
  }

  finishImpactFrame(ctx, seg, localT);
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

function drawCountdownNumber(ctx, seg, localT, settings) {
  impactCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  impactCtx.fillStyle = "#000000";
  impactCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawNoiseOverlay(impactCtx, 0.1);

  const popDur = 0.25;
  const popProgress = Math.min(Math.max(localT / popDur, 0), 1);
  const scale = 1.4 - 0.4 * easeOutCubic(popProgress);

  impactCtx.save();
  impactCtx.translate(CANVAS_W / 2, CANVAS_H / 2);
  impactCtx.scale(scale, scale);
  impactCtx.fillStyle = settings.theme.accent;
  impactCtx.textAlign = "center";
  impactCtx.textBaseline = "middle";
  impactCtx.font = '900 320px "Arial Black", Impact, sans-serif';
  impactCtx.fillText(seg.number, 0, 12);
  impactCtx.restore();

  finishImpactFrame(ctx, seg, localT);
}

// トランジション合成用のオフスクリーンバッファ（フレームごとに使い回す）
const transitionBufferA = document.createElement("canvas");
const transitionBufferB = document.createElement("canvas");
transitionBufferA.width = CANVAS_W;
transitionBufferA.height = CANVAS_H;
transitionBufferB.width = CANVAS_W;
transitionBufferB.height = CANVAS_H;
const transitionCtxA = transitionBufferA.getContext("2d");
const transitionCtxB = transitionBufferB.getContext("2d");

// "ランダム"指定時、写真の切り替えごとに使う効果を決める。
// インデックスから決定的に導出するので、BGM追加時の再生成でも同じ映像になる。
function pickTransitionType(settings, index) {
  if (settings.transitionType !== "random") return settings.transitionType;
  const seed = (index * 9301 + 49297) % 233280;
  const pos = Math.floor((seed / 233280) * TRANSITION_TYPES.length);
  return TRANSITION_TYPES[pos];
}

function compositeTransition(ctx, canvasA, canvasB, progress, type) {
  switch (type) {
    case "slide": {
      const dx = CANVAS_W * progress;
      ctx.drawImage(canvasA, -dx, 0);
      ctx.drawImage(canvasB, CANVAS_W - dx, 0);
      break;
    }
    case "zoom": {
      ctx.drawImage(canvasA, 0, 0);
      const scale = 1.15 - 0.15 * progress;
      const w = CANVAS_W * scale;
      const h = CANVAS_H * scale;
      ctx.save();
      ctx.globalAlpha = progress;
      ctx.drawImage(canvasB, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
      ctx.restore();
      break;
    }
    case "wipe": {
      ctx.drawImage(canvasA, 0, 0);
      const wipeX = CANVAS_W * progress;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, wipeX, CANVAS_H);
      ctx.clip();
      ctx.drawImage(canvasB, 0, 0);
      ctx.restore();
      break;
    }
    case "flash": {
      if (progress < 0.5) {
        ctx.drawImage(canvasA, 0, 0);
        ctx.save();
        ctx.globalAlpha = progress * 2;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.restore();
      } else {
        ctx.drawImage(canvasB, 0, 0);
        ctx.save();
        ctx.globalAlpha = (1 - progress) * 2;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.restore();
      }
      break;
    }
    case "crossfade":
    default: {
      ctx.drawImage(canvasA, 0, 0);
      ctx.save();
      ctx.globalAlpha = progress;
      ctx.drawImage(canvasB, 0, 0);
      ctx.restore();
      break;
    }
  }
}

function drawFrame(ctx, timeline, t, settings) {
  const { segments, startTimes, total } = timeline;
  t = Math.min(t, total);

  let activeIndex = 0;
  for (let i = 0; i < segments.length; i++) {
    if (startTimes[i] <= t) activeIndex = i;
  }

  const seg = segments[activeIndex];
  const localT = t - startTimes[activeIndex];
  const hasNext = activeIndex < segments.length - 1;
  const nextStart = hasNext ? startTimes[activeIndex + 1] : null;
  const inTransition = hasNext && t >= nextStart;

  if (!inTransition) {
    drawSegment(ctx, seg, localT, settings);
  } else {
    const nextSeg = segments[activeIndex + 1];
    const progress = Math.min(Math.max((t - nextStart) / settings.transitionDuration, 0), 1);
    transitionCtxA.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawSegment(transitionCtxA, seg, localT, settings);
    transitionCtxB.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawSegment(transitionCtxB, nextSeg, t - nextStart, settings);
    const type = pickTransitionType(settings, activeIndex);
    compositeTransition(ctx, transitionBufferA, transitionBufferB, progress, type);
  }

  if (settings.template !== "opening") {
    drawVignette(ctx, settings.theme.accent);
  }
}

function drawSegment(ctx, seg, localT, settings) {
  if (seg.type === "title") {
    drawTitleCard(ctx, seg, localT, settings);
  } else if (seg.type === "impact-text") {
    drawImpactCard(ctx, seg, localT, settings);
  } else if (seg.type === "countdown-number") {
    drawCountdownNumber(ctx, seg, localT, settings);
  } else {
    drawPhoto(ctx, seg, localT, settings);
  }
}

// --- 動画生成（MediaRecorder） ---

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

// 音声ファイル1つの長さだけを調べる（実際の再生には使わない専用の<audio>）
async function loadAudioDuration(file) {
  const url = URL.createObjectURL(file);
  const probeEl = document.createElement("audio");
  probeEl.preload = "metadata";
  probeEl.src = url;
  const duration = await new Promise((resolve) => {
    probeEl.addEventListener(
      "loadedmetadata",
      () => resolve(isFinite(probeEl.duration) && probeEl.duration > 0 ? probeEl.duration : 180),
      { once: true }
    );
    probeEl.addEventListener("error", () => resolve(180), { once: true });
  });
  return { url, duration };
}

// 選んだ曲を順番に、動画の長さを満たすまで繰り返し並べたスケジュールを作る。
// 曲の切り替わり・ループのつなぎ目にはAUDIO_CROSSFADE_SEC分の重なりを持たせる。
function buildAudioSchedule(infos, totalDuration) {
  const schedule = [];
  let t = 0;
  let i = 0;
  while (t < totalDuration && schedule.length < 500) {
    const info = infos[i % infos.length];
    const crossfade = Math.min(AUDIO_CROSSFADE_SEC, info.duration / 2);
    schedule.push({ url: info.url, duration: info.duration, crossfade, start: t });
    if (info.duration <= 0.05) break;
    t += info.duration - crossfade;
    i++;
  }
  return schedule;
}

// 複数曲のBGMを、曲間クロスフェード付きで動画の長さいっぱいに流すための再生管理。
// 2つの<audio>要素を交互に使い、切り替わりのタイミングで音量をクロスフェードする。
// audioDucksが指定されている場合は、その区間でBGMの音量を一瞬下げて戻す
// （オープニング演出のクライマックス前の「静寂の一瞬」を演出する）。
async function setupAudioPlaylist(audioFiles, totalDuration, audioDucks = []) {
  const infos = [];
  for (const file of audioFiles) {
    infos.push(await loadAudioDuration(file));
  }
  const schedule = buildAudioSchedule(infos, totalDuration);

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const audioElA = document.createElement("audio");
  const audioElB = document.createElement("audio");
  const sourceA = audioCtx.createMediaElementSource(audioElA);
  const sourceB = audioCtx.createMediaElementSource(audioElB);
  const gainA = audioCtx.createGain();
  const gainB = audioCtx.createGain();
  const masterGain = audioCtx.createGain();
  const dest = audioCtx.createMediaStreamDestination();
  gainA.gain.value = 0;
  gainB.gain.value = 0;
  sourceA.connect(gainA);
  sourceB.connect(gainB);
  gainA.connect(masterGain);
  gainB.connect(masterGain);
  masterGain.connect(dest);

  const fadeStart = Math.max(totalDuration - 1.5, 0.1);
  masterGain.gain.setValueAtTime(1, audioCtx.currentTime);
  masterGain.gain.setValueAtTime(1, audioCtx.currentTime + fadeStart);
  masterGain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + totalDuration);

  let activeIsA = true;
  let scheduleIndex = -1;

  async function playScheduleItem(idx) {
    if (idx === scheduleIndex) return;
    scheduleIndex = idx;
    const item = schedule[idx];
    const incomingEl = activeIsA ? audioElB : audioElA;
    const incomingGain = activeIsA ? gainB : gainA;
    const outgoingGain = activeIsA ? gainA : gainB;
    const now = audioCtx.currentTime;

    incomingEl.src = item.url;
    incomingEl.currentTime = 0;
    incomingGain.gain.cancelScheduledValues(now);
    incomingGain.gain.setValueAtTime(0, now);
    try {
      await incomingEl.play();
    } catch (err) {
      // 自動再生がブロックされても録画自体は続行する
    }
    incomingGain.gain.linearRampToValueAtTime(1, now + item.crossfade);

    outgoingGain.gain.cancelScheduledValues(now);
    outgoingGain.gain.setValueAtTime(outgoingGain.gain.value, now);
    outgoingGain.gain.linearRampToValueAtTime(0, now + item.crossfade);

    activeIsA = !activeIsA;
  }

  if (schedule.length > 0) {
    await playScheduleItem(0);
  }

  // cancelScheduledValuesは使わない: 末尾フェードアウトの予約が消えてしまうため、
  // 現在値をアンカーしてランプを積み増すだけにする。
  function triggerDuck(duck) {
    const now = audioCtx.currentTime;
    const dip = Math.min(duck.duration, 1.2);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0.05, now + dip * 0.35);
    masterGain.gain.linearRampToValueAtTime(1, now + dip);
  }

  const duckState = audioDucks.map((d) => ({ ...d, triggered: false }));

  function onFrame(t) {
    let idx = scheduleIndex;
    while (idx + 1 < schedule.length && t >= schedule[idx + 1].start) {
      idx++;
    }
    if (idx !== scheduleIndex) playScheduleItem(idx);

    duckState.forEach((duck) => {
      if (!duck.triggered && t >= duck.start) {
        duck.triggered = true;
        triggerDuck(duck);
      }
    });
  }

  function cleanup() {
    audioElA.pause();
    audioElB.pause();
    infos.forEach((info) => URL.revokeObjectURL(info.url));
    audioCtx.close();
  }

  return { audioTracks: dest.stream.getAudioTracks(), onFrame, cleanup };
}

async function renderVideo({ audioFiles, onProgress } = {}) {
  const settings = getSettings();
  if (countPhotos(settings) === 0) {
    throw new Error("写真を1枚以上追加してください");
  }
  const timeline = computeTimeline(settings);
  const canvas = els.canvas;
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");

  drawFrame(ctx, timeline, 0, settings);

  const videoStream = canvas.captureStream(30);
  let tracks = videoStream.getVideoTracks();
  let audioCleanup = null;
  let onAudioFrame = null;

  if (audioFiles && audioFiles.length > 0) {
    const playlist = await setupAudioPlaylist(audioFiles, timeline.total, timeline.audioDucks || []);
    tracks = tracks.concat(playlist.audioTracks);
    onAudioFrame = playlist.onFrame;
    audioCleanup = playlist.cleanup;
  }

  const combinedStream = new MediaStream(tracks);
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
  });

  const startPerf = performance.now();
  recorder.start(250);

  await new Promise((resolve) => {
    function frame() {
      const t = (performance.now() - startPerf) / 1000;
      drawFrame(ctx, timeline, t, settings);
      if (onAudioFrame) onAudioFrame(t);
      if (onProgress) onProgress(Math.min(t / timeline.total, 1));
      if (t < timeline.total) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });

  recorder.stop();
  const blob = await stopped;
  if (audioCleanup) audioCleanup();
  return blob;
}

// --- UIワイヤリング ---

function setProgress(fillEl, labelEl, ratio, label) {
  fillEl.style.width = `${Math.round(ratio * 100)}%`;
  labelEl.textContent = label;
}

// MediaRecorderが生成するwebmはヘッダに長さ情報を含まないため、
// そのままだとシークバーや長さ表示が正しく動かない。
// 一度末尾近くまでシークさせることでブラウザに長さを再計算させる。
function fixVideoDuration(videoEl) {
  return new Promise((resolve) => {
    function afterLoaded() {
      const finish = () => {
        videoEl.currentTime = 0;
        resolve();
      };
      const onChange = () => {
        videoEl.removeEventListener("durationchange", onChange);
        finish();
      };
      videoEl.addEventListener("durationchange", onChange);
      videoEl.currentTime = 1e10;
      setTimeout(finish, 2000);
    }
    if (videoEl.readyState >= 1) afterLoaded();
    else videoEl.addEventListener("loadedmetadata", afterLoaded, { once: true });
  });
}

els.createBtn.addEventListener("click", async () => {
  if (countPhotos(getSettings()) === 0) {
    alert("写真を1枚以上追加してください");
    return;
  }
  els.createBtn.disabled = true;
  els.progressBox.classList.remove("hidden");
  els.previewBox.classList.add("hidden");
  setProgress(els.progressFill, els.progressLabel, 0, "生成中…");

  try {
    const blob = await renderVideo({
      onProgress: (ratio) => setProgress(els.progressFill, els.progressLabel, ratio, `生成中… ${Math.round(ratio * 100)}%`),
    });
    const url = URL.createObjectURL(blob);
    els.previewVideo.src = url;
    els.downloadSilent.href = url;
    els.previewBox.classList.remove("hidden");
    await fixVideoDuration(els.previewVideo);
    els.bgmSection.classList.remove("disabled");
    updateAddBgmButtonState();
    setProgress(els.progressFill, els.progressLabel, 1, "完成しました");
  } catch (err) {
    alert(`生成に失敗しました: ${err.message || err}`);
    els.progressBox.classList.add("hidden");
  } finally {
    els.createBtn.disabled = false;
  }
});

els.addBgmBtn.addEventListener("click", async () => {
  if (state.bgmFiles.length === 0) {
    alert("BGMファイルを1曲以上追加してください");
    return;
  }
  els.addBgmBtn.disabled = true;
  els.bgmProgressBox.classList.remove("hidden");
  els.finalBox.classList.add("hidden");
  setProgress(els.bgmProgressFill, els.bgmProgressLabel, 0, "BGMを合成中…");

  try {
    const blob = await renderVideo({
      audioFiles: state.bgmFiles.map((track) => track.file),
      onProgress: (ratio) =>
        setProgress(els.bgmProgressFill, els.bgmProgressLabel, ratio, `BGMを合成中… ${Math.round(ratio * 100)}%`),
    });
    const url = URL.createObjectURL(blob);
    els.finalVideo.src = url;
    els.downloadFinal.href = url;
    els.finalBox.classList.remove("hidden");
    await fixVideoDuration(els.finalVideo);
    setProgress(els.bgmProgressFill, els.bgmProgressLabel, 1, "完成しました");
  } catch (err) {
    alert(`BGM付き書き出しに失敗しました: ${err.message || err}`);
    els.bgmProgressBox.classList.add("hidden");
  } finally {
    updateAddBgmButtonState();
  }
});

updateDurationEstimate();
