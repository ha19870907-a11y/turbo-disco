"use strict";

// 結婚式ムービー作成ツール
// すべての処理をブラウザ内(Canvas + MediaRecorder)で完結させる。
// サーバーを使わないので、写真・音楽が外部に送信されることはない。

const THEMES = {
  pink: { bg1: "#f6d9e2", bg2: "#c98a9c", text: "#fffaf7", accent: "#e8c78a" },
  navy: { bg1: "#1f2a44", bg2: "#0d1424", text: "#f5efe3", accent: "#d9b968" },
  green: { bg1: "#e7ecdf", bg2: "#5c7a5a", text: "#fffdf7", accent: "#c9a24b" },
};

const CANVAS_W = 1280;
const CANVAS_H = 720;
const INTRO_DUR = 3.2;
const OUTRO_DUR = 3.2;
const FADE = 0.6;
const ZOOM_AMOUNT = 0.16;

const state = {
  photos: [], // { id, url, img }
  nextId: 1,
};

const els = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  photoGrid: document.getElementById("photo-grid"),
  title1: document.getElementById("title1"),
  title2: document.getElementById("title2"),
  dateText: document.getElementById("date-text"),
  endMessage: document.getElementById("end-message"),
  themeSelect: document.getElementById("theme-select"),
  photoDuration: document.getElementById("photo-duration"),
  transitionDuration: document.getElementById("transition-duration"),
  durationEstimate: document.getElementById("duration-estimate"),
  createBtn: document.getElementById("create-btn"),
  progressBox: document.getElementById("progress-box"),
  progressFill: document.getElementById("progress-fill"),
  progressLabel: document.getElementById("progress-label"),
  previewBox: document.getElementById("preview-box"),
  previewVideo: document.getElementById("preview-video"),
  downloadSilent: document.getElementById("download-silent"),
  bgmSection: document.getElementById("bgm-section"),
  bgmInput: document.getElementById("bgm-input"),
  addBgmBtn: document.getElementById("add-bgm-btn"),
  bgmProgressBox: document.getElementById("bgm-progress-box"),
  bgmProgressFill: document.getElementById("bgm-progress-fill"),
  bgmProgressLabel: document.getElementById("bgm-progress-label"),
  finalBox: document.getElementById("final-box"),
  finalVideo: document.getElementById("final-video"),
  downloadFinal: document.getElementById("download-final"),
  canvas: document.getElementById("render-canvas"),
};

function getSettings() {
  return {
    title1: els.title1.value.trim(),
    title2: els.title2.value.trim(),
    dateText: els.dateText.value.trim(),
    endMessage: els.endMessage.value.trim() || "Thank You",
    theme: THEMES[els.themeSelect.value] || THEMES.pink,
    photoDuration: Math.min(Math.max(Number(els.photoDuration.value) || 4, 1.5), 10),
    transitionDuration: Math.min(Math.max(Number(els.transitionDuration.value) || 0.8, 0.3), 2),
  };
}

// --- 写真の追加・並べ替え ---

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      state.photos.push({ id: state.nextId++, url, img });
    } catch (err) {
      URL.revokeObjectURL(url);
    }
  }
  renderPhotoGrid();
  updateDurationEstimate();
}

function renderPhotoGrid() {
  els.photoGrid.innerHTML = "";
  state.photos.forEach((photo, index) => {
    const item = document.createElement("div");
    item.className = "photo-item";
    item.draggable = true;
    item.dataset.id = String(photo.id);

    const img = document.createElement("img");
    img.src = photo.url;
    item.appendChild(img);

    const badge = document.createElement("span");
    badge.className = "order-badge";
    badge.textContent = String(index + 1);
    item.appendChild(badge);

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      state.photos = state.photos.filter((p) => p.id !== photo.id);
      renderPhotoGrid();
      updateDurationEstimate();
    });
    item.appendChild(removeBtn);

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
      const fromIndex = state.photos.findIndex((p) => p.id === draggedId);
      const toIndex = state.photos.findIndex((p) => p.id === photo.id);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = state.photos.splice(fromIndex, 1);
      state.photos.splice(toIndex, 0, moved);
      renderPhotoGrid();
    });

    els.photoGrid.appendChild(item);
  });
}

els.dropzone.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", (e) => addFiles(e.target.files));
["dragenter", "dragover"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
  })
);
els.dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

[els.photoDuration, els.transitionDuration].forEach((el) =>
  el.addEventListener("input", updateDurationEstimate)
);

function computeTimeline(settings) {
  const segments = [];
  segments.push({ type: "title", duration: INTRO_DUR, lines: introLines(settings) });
  state.photos.forEach((photo, i) => {
    segments.push({ type: "photo", duration: settings.photoDuration, photo, variant: i % 4 });
  });
  segments.push({ type: "title", duration: OUTRO_DUR, lines: [settings.endMessage] });

  const startTimes = [];
  let t = 0;
  segments.forEach((seg, i) => {
    startTimes.push(t);
    t += seg.duration;
    if (i < segments.length - 1) t -= settings.transitionDuration;
  });
  const total = Math.max(t, 1);
  return { segments, startTimes, total };
}

function introLines(settings) {
  const names = [settings.title1, settings.title2].filter(Boolean).join(" ♥ ");
  const lines = [];
  if (names) lines.push(names);
  if (settings.dateText) lines.push(settings.dateText);
  if (lines.length === 0) lines.push("Wedding Movie");
  return lines;
}

function updateDurationEstimate() {
  const settings = getSettings();
  const { total } = computeTimeline(settings);
  const mins = Math.floor(total / 60);
  const secs = Math.round(total % 60);
  els.durationEstimate.textContent = `写真${state.photos.length}枚 / 想定の動画の長さ: 約${mins > 0 ? mins + "分" : ""}${secs}秒`;
}

document.getElementById("date-text").addEventListener("input", updateDurationEstimate);
document.getElementById("title1").addEventListener("input", updateDurationEstimate);
document.getElementById("title2").addEventListener("input", updateDurationEstimate);
document.getElementById("end-message").addEventListener("input", updateDurationEstimate);

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

function drawPhoto(ctx, seg, localT) {
  const { img } = seg.photo;
  const progress = Math.min(Math.max(localT / seg.duration, 0), 1);
  const zoomIn = seg.variant % 2 === 0;
  const scale = zoomIn ? 1 + ZOOM_AMOUNT * progress : 1 + ZOOM_AMOUNT * (1 - progress);

  const imgRatio = img.naturalWidth / img.naturalHeight;
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
  drawSegment(ctx, seg, localT, settings);

  if (activeIndex < segments.length - 1) {
    const nextStart = startTimes[activeIndex + 1];
    if (t >= nextStart) {
      const alpha = Math.min(Math.max((t - nextStart) / settings.transitionDuration, 0), 1);
      const nextSeg = segments[activeIndex + 1];
      ctx.save();
      ctx.globalAlpha = alpha;
      drawSegment(ctx, nextSeg, t - nextStart, settings);
      ctx.restore();
    }
  }

  drawVignette(ctx, settings.theme.accent);
}

function drawSegment(ctx, seg, localT, settings) {
  if (seg.type === "title") {
    drawTitleCard(ctx, seg, localT, settings);
  } else {
    drawPhoto(ctx, seg, localT);
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

async function renderVideo({ audioFile, onProgress } = {}) {
  const settings = getSettings();
  if (state.photos.length === 0) {
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

  if (audioFile) {
    const audioEl = document.createElement("audio");
    audioEl.src = URL.createObjectURL(audioFile);
    audioEl.loop = true;
    await new Promise((resolve) => {
      audioEl.addEventListener("canplaythrough", resolve, { once: true });
      audioEl.addEventListener("error", resolve, { once: true });
      audioEl.load();
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaElementSource(audioEl);
    const gainNode = audioCtx.createGain();
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(gainNode);
    gainNode.connect(dest);

    const fadeStart = Math.max(timeline.total - 1.5, 0.1);
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime + fadeStart);
    gainNode.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + timeline.total);

    tracks = tracks.concat(dest.stream.getAudioTracks());
    audioEl.currentTime = 0;
    try {
      await audioEl.play();
    } catch (err) {
      // 自動再生がブロックされても録画自体は続行する
    }
    audioCleanup = () => {
      audioEl.pause();
      URL.revokeObjectURL(audioEl.src);
      audioCtx.close();
    };
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
  if (state.photos.length === 0) {
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
    els.addBgmBtn.disabled = false;
    setProgress(els.progressFill, els.progressLabel, 1, "完成しました");
  } catch (err) {
    alert(`生成に失敗しました: ${err.message || err}`);
    els.progressBox.classList.add("hidden");
  } finally {
    els.createBtn.disabled = false;
  }
});

els.addBgmBtn.addEventListener("click", async () => {
  const file = els.bgmInput.files && els.bgmInput.files[0];
  if (!file) {
    alert("BGMファイルを選択してください");
    return;
  }
  els.addBgmBtn.disabled = true;
  els.bgmProgressBox.classList.remove("hidden");
  els.finalBox.classList.add("hidden");
  setProgress(els.bgmProgressFill, els.bgmProgressLabel, 0, "BGMを合成中…");

  try {
    const blob = await renderVideo({
      audioFile: file,
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
    els.addBgmBtn.disabled = false;
  }
});

updateDurationEstimate();
