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
const TRANSITION_TYPES = ["crossfade", "slide", "zoom", "wipe", "flash", "circle", "rotatezoom", "blur"];
const AUDIO_CROSSFADE_SEC = 1.2;

// 入力ファイルに対する上限（悪意あるファイルやサイズの大きすぎるファイルで
// タブがフリーズ・クラッシュするのを防ぐための安全策）
const MAX_PHOTOS = 300;
const MAX_PHOTO_BYTES = 30 * 1024 * 1024; // 30MB/枚
const MAX_AUDIO_BYTES = 150 * 1024 * 1024; // 150MB/曲
const MAX_BGM_TRACKS = 20;
const MAX_IMAGE_LONG_EDGE = 2400; // 書き出しに必要な解像度を大きく超える画像はここまで縮小して保持する
const MAX_CAPTION_LENGTH = 40;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB/本
const MAX_VIDEOS_PER_GROUP = 15; // 動画はデコード負荷が高いため写真より低い上限にする
const MAX_VIDEO_CLIP_SECONDS = 15; // 1クリップが動画内で使われる長さの上限
const DEFAULT_VIDEO_CLIP_SECONDS = 5;
const BEAT_ANALYSIS_MAX_SECONDS = 60; // テンポ検出に使う先頭部分の長さ（テンポは曲を通して一定と仮定）
const BEAT_MIN_BPM = 80;
const BEAT_MAX_BPM = 180;

const MAX_GUEST_MESSAGES = 100;
const MAX_GUEST_NAME_LENGTH = 30;
const MAX_GUEST_GROUP_LENGTH = 20;
const MAX_GUEST_MESSAGE_LENGTH = 200;
// 「遅い/標準/速い」に対応する、ページ表示時間・切り替え時間への倍率。
const ENDROLL_SPEED_MAP = { slow: 1.35, normal: 1, fast: 0.75 };

const state = {
  bgmFiles: [], // { id, file }
  nextBgmId: 1,
  guestMessages: [], // { id, name, message }（エンドロール用）
  nextGuestMessageId: 1,
};

const els = {
  saveDraftBtn: document.getElementById("save-draft-btn"),
  deleteDraftBtn: document.getElementById("delete-draft-btn"),
  draftStatus: document.getElementById("draft-status"),
  draftRestoreBox: document.getElementById("draft-restore-box"),
  draftSavedAt: document.getElementById("draft-saved-at"),
  restoreDraftBtn: document.getElementById("restore-draft-btn"),
  draftSection: document.getElementById("draft-section"),

  standardPhotosSection: document.getElementById("standard-photos-section"),
  standardSettingsSection: document.getElementById("standard-settings-section"),
  openingSection: document.getElementById("opening-section"),
  openingPhotosSection: document.getElementById("opening-photos-section"),
  endrollSection: document.getElementById("endroll-section"),
  endrollPhotosSection: document.getElementById("endroll-photos-section"),
  endrollMessagesSection: document.getElementById("endroll-messages-section"),
  endrollDropzone: document.getElementById("endroll-dropzone"),
  endrollFileInput: document.getElementById("endroll-file-input"),
  endrollPhotoGrid: document.getElementById("endroll-photo-grid"),

  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  photoGrid: document.getElementById("photo-grid"),
  title1: document.getElementById("title1"),
  title2: document.getElementById("title2"),
  dateText: document.getElementById("date-text"),
  endMessage: document.getElementById("end-message"),
  themeSelect: document.getElementById("theme-select"),
  photoDuration: document.getElementById("photo-duration"),
  photoDisplayScale: document.getElementById("photo-display-scale"),
  transitionType: document.getElementById("transition-type"),
  transitionDuration: document.getElementById("transition-duration"),
  captionStyle: document.getElementById("caption-style"),
  captionFontSize: document.getElementById("caption-font-size"),
  captionFade: document.getElementById("caption-fade"),

  opGroomName: document.getElementById("op-groom-name"),
  opGroomSub1: document.getElementById("op-groom-sub1"),
  opGroomSub2: document.getElementById("op-groom-sub2"),
  opBrideName: document.getElementById("op-bride-name"),
  opBrideSub1: document.getElementById("op-bride-sub1"),
  opBrideSub2: document.getElementById("op-bride-sub2"),
  opNeonColor: document.getElementById("op-neon-color"),
  opPhotoDuration: document.getElementById("op-photo-duration"),
  opPhotoDisplayScale: document.getElementById("op-photo-display-scale"),
  opTransitionType: document.getElementById("op-transition-type"),
  opTransitionDuration: document.getElementById("op-transition-duration"),
  opCaptionStyle: document.getElementById("op-caption-style"),
  opCaptionFontSize: document.getElementById("op-caption-font-size"),
  opCaptionFade: document.getElementById("op-caption-fade"),

  endrollTitle1: document.getElementById("endroll-title1"),
  endrollTitle2: document.getElementById("endroll-title2"),
  endrollDateText: document.getElementById("endroll-date-text"),
  endrollTheme: document.getElementById("endroll-theme"),
  endrollHeaderLine1: document.getElementById("endroll-header-line1"),
  endrollHeaderLine2: document.getElementById("endroll-header-line2"),
  endrollSpeed: document.getElementById("endroll-speed"),
  guestMessageList: document.getElementById("guest-message-list"),
  addGuestMessageBtn: document.getElementById("add-guest-message-btn"),

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
  formatSilentInfo: document.getElementById("format-silent-info"),
  downloadSilent: document.getElementById("download-silent"),
  opentabSilent: document.getElementById("opentab-silent"),
  shareSilentBtn: document.getElementById("share-silent-btn"),
  shareSilentHint: document.getElementById("share-silent-hint"),
  bgmSection: document.getElementById("bgm-section"),
  bgmDropzone: document.getElementById("bgm-dropzone"),
  bgmInput: document.getElementById("bgm-input"),
  bgmList: document.getElementById("bgm-list"),
  beatSyncEnabled: document.getElementById("beat-sync-enabled"),
  beatSyncInterval: document.getElementById("beat-sync-interval"),
  addBgmBtn: document.getElementById("add-bgm-btn"),
  bgmProgressBox: document.getElementById("bgm-progress-box"),
  bgmProgressFill: document.getElementById("bgm-progress-fill"),
  bgmProgressLabel: document.getElementById("bgm-progress-label"),
  finalBox: document.getElementById("final-box"),
  finalVideo: document.getElementById("final-video"),
  formatFinalInfo: document.getElementById("format-final-info"),
  downloadFinal: document.getElementById("download-final"),
  opentabFinal: document.getElementById("opentab-final"),
  shareFinalBtn: document.getElementById("share-final-btn"),
  shareFinalHint: document.getElementById("share-final-hint"),
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
      photoDisplayScale: Math.min(Math.max(Number(els.opPhotoDisplayScale.value) || 100, 30), 100),
      transitionType: els.opTransitionType.value || "flash",
      transitionDuration: Math.min(Math.max(Number(els.opTransitionDuration.value) || 0.3, 0.15), 1),
      captionStyle: els.opCaptionStyle.value || "simple",
      captionFontSize: Math.min(Math.max(Number(els.opCaptionFontSize.value) || 32, 16), 64),
      captionFade: els.opCaptionFade.value || "fade",
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
  if (template === "endroll") {
    const endrollSpeedMultiplier = ENDROLL_SPEED_MAP[els.endrollSpeed.value] || ENDROLL_SPEED_MAP.normal;
    return {
      template,
      title1: els.endrollTitle1.value.trim(),
      title2: els.endrollTitle2.value.trim(),
      dateText: els.endrollDateText.value.trim(),
      theme: THEMES[els.endrollTheme.value] || THEMES.pink,
      endrollThemeKey: els.endrollTheme.value || "pink",
      transitionType: "pageflip",
      transitionDuration: Math.min(Math.max(0.9 * endrollSpeedMultiplier, 0.5), 1.3),
      endrollHeaderLine1: els.endrollHeaderLine1.value.trim() || "Thank You",
      endrollHeaderLine2: els.endrollHeaderLine2.value.trim(),
      endrollSpeed: endrollSpeedMultiplier,
      guestMessages: state.guestMessages,
      endrollPhotos: endrollGroup.photos,
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
    photoDisplayScale: Math.min(Math.max(Number(els.photoDisplayScale.value) || 100, 30), 100),
    transitionType: els.transitionType.value || "crossfade",
    transitionDuration: Math.min(Math.max(Number(els.transitionDuration.value) || 0.8, 0.3), 2),
    captionStyle: els.captionStyle.value || "simple",
    captionFontSize: Math.min(Math.max(Number(els.captionFontSize.value) || 32, 16), 64),
    captionFade: els.captionFade.value || "fade",
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

// スマホでクラウドストレージ経由などで選んだファイルは file.type が空文字になることがあり、
// その場合 file.type.startsWith("audio/") 等の判定だけでは正しいファイルでも弾かれてしまう
// （「音楽ファイルが選べない」という不具合の主な原因）。file.type が無いときは拡張子で補う。
const AUDIO_EXTENSIONS = /\.(mp3|m4a|wav|aac|ogg|oga|flac|wma|opus|weba)$/i;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|avi|mkv|3gp|3gpp)$/i;

function looksLikeType(file, mimePrefix, extRegex) {
  if (file.type) return file.type.startsWith(mimePrefix);
  return extRegex.test(file.name || "");
}

function intrinsicSize(imgLike) {
  return {
    width: imgLike.naturalWidth || imgLike.videoWidth || imgLike.width,
    height: imgLike.naturalHeight || imgLike.videoHeight || imgLike.height,
  };
}

// 動画ファイル1つ分のメタデータを読み込む。実際の再生用<video>要素をそのまま
// サムネイル表示にも書き出し描画にも使い回す（BGMの自身の音声は含めないよう常にミュート）。
function loadVideoItem(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const videoEl = document.createElement("video");
    videoEl.src = url;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.preload = "auto";
    videoEl.addEventListener(
      "loadedmetadata",
      () => {
        const naturalDuration = isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : DEFAULT_VIDEO_CLIP_SECONDS;
        resolve({ url, videoEl, naturalDuration, clipSeconds: Math.min(naturalDuration, DEFAULT_VIDEO_CLIP_SECONDS) });
      },
      { once: true }
    );
    videoEl.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(url);
        reject(new Error("動画を読み込めませんでした"));
      },
      { once: true }
    );
  });
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
function createPhotoGroup({ gridEl, dropzoneEl, fileInputEl, onChange, endrollGroupField = false }) {
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

      if (photo.kind === "video") {
        photo.videoEl.className = "media-thumb-el";
        thumb.appendChild(photo.videoEl);

        const mediaBadge = document.createElement("span");
        mediaBadge.className = "media-badge";
        mediaBadge.textContent = "🎬";
        thumb.appendChild(mediaBadge);
      } else {
        const img = document.createElement("img");
        img.className = "media-thumb-el";
        img.src = photo.url;
        thumb.appendChild(img);
      }

      const badge = document.createElement("span");
      badge.className = "order-badge";
      badge.textContent = String(index + 1);
      thumb.appendChild(badge);

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        if (photo.kind === "video") photo.videoEl.pause();
        URL.revokeObjectURL(photo.url);
        group.photos = group.photos.filter((p) => p.id !== photo.id);
        render();
        onChange();
      });
      thumb.appendChild(removeBtn);
      item.appendChild(thumb);

      if (photo.kind === "video") {
        const clipLabel = document.createElement("label");
        clipLabel.className = "photo-field-label";
        clipLabel.textContent = "使用秒数";
        const clipInput = document.createElement("input");
        clipInput.type = "number";
        clipInput.className = "photo-field-input";
        clipInput.min = "0.5";
        clipInput.max = String(Math.min(photo.naturalDuration, MAX_VIDEO_CLIP_SECONDS));
        clipInput.step = "0.5";
        clipInput.value = photo.clipSeconds;
        clipInput.draggable = false;
        clipInput.title = `動画本編の長さ: 約${photo.naturalDuration.toFixed(1)}秒`;
        clipInput.addEventListener("input", () => {
          const maxAllowed = Math.min(photo.naturalDuration, MAX_VIDEO_CLIP_SECONDS);
          photo.clipSeconds = Math.min(Math.max(Number(clipInput.value) || 1, 0.5), maxAllowed);
          onChange();
        });
        clipLabel.appendChild(clipInput);
        item.appendChild(clipLabel);
      } else {
        // 動画を当てこむ際など、写真ごとに表示秒数を個別調整したい場合の上書き設定。
        // 空欄のときは共通設定（1枚あたりの表示時間）に従う。
        const durLabel = document.createElement("label");
        durLabel.className = "photo-field-label";
        durLabel.textContent = "表示秒数";
        const durInput = document.createElement("input");
        durInput.type = "number";
        durInput.className = "photo-field-input";
        durInput.min = "0.2";
        durInput.max = "20";
        durInput.step = "0.1";
        durInput.placeholder = "共通";
        durInput.value = photo.duration != null ? photo.duration : "";
        durInput.draggable = false;
        durInput.title = "空欄の場合は共通設定（1枚あたりの表示時間）が使われます";
        durInput.addEventListener("input", () => {
          if (durInput.value.trim() === "") {
            photo.duration = null;
          } else {
            photo.duration = Math.min(Math.max(Number(durInput.value) || 0.2, 0.2), 20);
          }
          onChange();
        });
        durLabel.appendChild(durInput);
        item.appendChild(durLabel);
      }

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

      if (endrollGroupField) {
        // この写真を、来賓メッセージの特定の「グループ」ページの背景専用にしたい場合の指定欄。
        // 来賓メッセージのグループ欄と同じ名前を入れると、そのグループのページ（つづきページも
        // 含む）すべての背景にこの写真が使われる。空欄の写真は、専用の写真が無いグループに
        // これまで通り順番に割り当てられる。
        const bgGroupLabel = document.createElement("label");
        bgGroupLabel.className = "photo-field-label";
        bgGroupLabel.textContent = "背景にするグループ";
        const bgGroupInput = document.createElement("input");
        bgGroupInput.type = "text";
        bgGroupInput.className = "photo-field-input";
        bgGroupInput.placeholder = "未指定（順番に自動割り当て）";
        bgGroupInput.maxLength = MAX_GUEST_GROUP_LENGTH;
        bgGroupInput.value = photo.endrollGroup || "";
        bgGroupInput.draggable = false;
        bgGroupInput.setAttribute("list", "guest-group-suggestions");
        bgGroupInput.title = "来賓メッセージの「グループ」欄と同じ名前を入れると、そのグループのページの背景にこの写真が使われます";
        bgGroupInput.addEventListener("input", () => {
          photo.endrollGroup = bgGroupInput.value;
          onChange();
        });
        bgGroupLabel.appendChild(bgGroupInput);
        item.appendChild(bgGroupLabel);
      }

      // 詳細設定（この写真だけの文字サイズ・エフェクト・表示サイズの上書き）。
      // 空欄／「共通」のときは共通設定に従う。
      const advanced = document.createElement("details");
      advanced.className = "photo-advanced";
      advanced.draggable = false;
      const summary = document.createElement("summary");
      summary.textContent = "詳細設定";
      advanced.appendChild(summary);
      const advancedFields = document.createElement("div");
      advancedFields.className = "photo-advanced-fields";

      const fontSizeLabel = document.createElement("label");
      fontSizeLabel.className = "photo-field-label";
      fontSizeLabel.textContent = "文字サイズ(px)";
      const fontSizeInput = document.createElement("input");
      fontSizeInput.type = "number";
      fontSizeInput.className = "photo-field-input";
      fontSizeInput.min = "16";
      fontSizeInput.max = "64";
      fontSizeInput.step = "2";
      fontSizeInput.placeholder = "共通";
      fontSizeInput.value = photo.captionFontSize != null ? photo.captionFontSize : "";
      fontSizeInput.draggable = false;
      fontSizeInput.title = "空欄の場合は共通設定（キャプションの文字サイズ）が使われます";
      fontSizeInput.addEventListener("input", () => {
        if (fontSizeInput.value.trim() === "") {
          photo.captionFontSize = null;
        } else {
          photo.captionFontSize = Math.min(Math.max(Number(fontSizeInput.value) || 16, 16), 64);
        }
        onChange();
      });
      fontSizeLabel.appendChild(fontSizeInput);
      advancedFields.appendChild(fontSizeLabel);

      const fadeLabel = document.createElement("label");
      fadeLabel.className = "photo-field-label";
      fadeLabel.textContent = "文字のエフェクト";
      const fadeSelect = document.createElement("select");
      fadeSelect.className = "photo-field-input";
      fadeSelect.draggable = false;
      fadeSelect.title = "「共通」の場合は共通設定（キャプションの出し方）が使われます";
      [
        ["", "共通"],
        ["fade", "フェード"],
        ["slide", "スライド＋フェード"],
        ["sparkle", "キラキラ出現"],
        ["typewriter", "タイプライター"],
        ["bounce", "バウンド"],
        ["zoomin", "ズーム出現"],
        ["none", "常に表示"],
      ].forEach(([value, label]) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        fadeSelect.appendChild(opt);
      });
      fadeSelect.value = photo.captionFade || "";
      fadeSelect.addEventListener("change", () => {
        photo.captionFade = fadeSelect.value || null;
        onChange();
      });
      fadeLabel.appendChild(fadeSelect);
      advancedFields.appendChild(fadeLabel);

      const sizeLabel = document.createElement("label");
      sizeLabel.className = "photo-field-label";
      sizeLabel.textContent = "写真の表示サイズ(%)";
      const sizeInput = document.createElement("input");
      sizeInput.type = "number";
      sizeInput.className = "photo-field-input";
      sizeInput.min = "30";
      sizeInput.max = "100";
      sizeInput.step = "5";
      sizeInput.placeholder = "共通";
      sizeInput.value = photo.displayScale != null ? photo.displayScale : "";
      sizeInput.draggable = false;
      sizeInput.title = "空欄の場合は共通設定（写真の表示サイズ）が使われます";
      sizeInput.addEventListener("input", () => {
        if (sizeInput.value.trim() === "") {
          photo.displayScale = null;
        } else {
          photo.displayScale = Math.min(Math.max(Number(sizeInput.value) || 30, 30), 100);
        }
        onChange();
      });
      sizeLabel.appendChild(sizeInput);
      advancedFields.appendChild(sizeLabel);

      advanced.appendChild(advancedFields);
      item.appendChild(advanced);

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
    const incoming = Array.from(fileList).filter(
      (f) => looksLikeType(f, "image/", IMAGE_EXTENSIONS) || looksLikeType(f, "video/", VIDEO_EXTENSIONS)
    );
    if (incoming.length === 0) return;

    const remainingSlots = MAX_PHOTOS - group.photos.length;
    if (remainingSlots <= 0) {
      alert(`写真・動画は合計最大${MAX_PHOTOS}点まで追加できます`);
      return;
    }
    const toAdd = incoming.slice(0, remainingSlots);
    if (incoming.length > toAdd.length) {
      alert(`写真・動画は合計最大${MAX_PHOTOS}点までのため、一部は追加されませんでした`);
    }

    let skippedLarge = 0;
    let skippedInvalid = 0;
    let skippedVideoLimit = 0;
    let videoCount = group.photos.filter((p) => p.kind === "video").length;

    for (const file of toAdd) {
      if (looksLikeType(file, "video/", VIDEO_EXTENSIONS)) {
        if (file.size > MAX_VIDEO_BYTES) {
          skippedLarge++;
          continue;
        }
        if (videoCount >= MAX_VIDEOS_PER_GROUP) {
          skippedVideoLimit++;
          continue;
        }
        try {
          const videoItem = await loadVideoItem(file);
          group.photos.push({
            id: group.nextId++,
            kind: "video",
            caption: "",
            file,
            captionFontSize: null,
            captionFade: null,
            displayScale: null,
            endrollGroup: "",
            ...videoItem,
          });
          videoCount++;
        } catch (err) {
          skippedInvalid++;
        }
        continue;
      }

      if (file.size > MAX_PHOTO_BYTES) {
        skippedLarge++;
        continue;
      }
      const url = URL.createObjectURL(file);
      try {
        const rawImg = await loadImage(url);
        const renderSource = capImageSize(rawImg);
        group.photos.push({
          id: group.nextId++,
          kind: "image",
          url,
          img: renderSource,
          file,
          caption: "",
          duration: null,
          captionFontSize: null,
          captionFade: null,
          displayScale: null,
          endrollGroup: "",
        });
      } catch (err) {
        skippedInvalid++;
        URL.revokeObjectURL(url);
      }
    }
    if (skippedLarge > 0) {
      alert(`容量が大きすぎるファイルが${skippedLarge}件あり追加しませんでした（上限: 写真${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)}MB/枚・動画${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB/本）`);
    }
    if (skippedVideoLimit > 0) {
      alert(`動画は1グループあたり最大${MAX_VIDEOS_PER_GROUP}本までのため、${skippedVideoLimit}件は追加しませんでした`);
    }
    if (skippedInvalid > 0) {
      alert(`読み込めないファイルが${skippedInvalid}件あったためスキップしました`);
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

  // 下書き復元用: 保存されていたファイル(Blob)の配列から、現在の内容を
  // すべて置き換える形で写真・動画を復元する。
  async function restoreItems(savedItems) {
    group.photos.forEach((p) => {
      if (p.kind === "video") p.videoEl.pause();
      URL.revokeObjectURL(p.url);
    });
    group.photos = [];
    group.nextId = 1;

    for (const saved of savedItems) {
      const file = new File([saved.blob], saved.fileName, { type: saved.fileType });
      if (saved.kind === "video") {
        try {
          const videoItem = await loadVideoItem(file);
          const maxAllowed = Math.min(videoItem.naturalDuration, MAX_VIDEO_CLIP_SECONDS);
          group.photos.push({
            id: group.nextId++,
            kind: "video",
            caption: saved.caption || "",
            file,
            captionFontSize: saved.captionFontSize != null ? saved.captionFontSize : null,
            captionFade: saved.captionFade || null,
            displayScale: saved.displayScale != null ? saved.displayScale : null,
            endrollGroup: saved.endrollGroup || "",
            ...videoItem,
            clipSeconds: Math.min(saved.clipSeconds || videoItem.clipSeconds, maxAllowed),
          });
        } catch (err) {
          // 復元できないデータはスキップする
        }
      } else {
        const url = URL.createObjectURL(file);
        try {
          const rawImg = await loadImage(url);
          const renderSource = capImageSize(rawImg);
          group.photos.push({
            id: group.nextId++,
            kind: "image",
            url,
            img: renderSource,
            file,
            caption: saved.caption || "",
            duration: saved.duration != null ? saved.duration : null,
            captionFontSize: saved.captionFontSize != null ? saved.captionFontSize : null,
            captionFade: saved.captionFade || null,
            displayScale: saved.displayScale != null ? saved.displayScale : null,
            endrollGroup: saved.endrollGroup || "",
          });
        } catch (err) {
          URL.revokeObjectURL(url);
        }
      }
    }
    render();
    onChange();
  }

  group.render = render;
  group.restoreItems = restoreItems;
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
const endrollGroup = createPhotoGroup({
  gridEl: els.endrollPhotoGrid,
  dropzoneEl: els.endrollDropzone,
  fileInputEl: els.endrollFileInput,
  onChange: () => updateDurationEstimate(),
  endrollGroupField: true,
});

document.querySelectorAll('input[name="template"]').forEach((radio) => {
  radio.addEventListener("change", updateTemplateVisibility);
});

function updateTemplateVisibility() {
  const template = getTemplate();
  const isStandard = template === "standard";
  const isOpening = template === "opening";
  const isEndroll = template === "endroll";
  els.standardPhotosSection.classList.toggle("hidden", !isStandard);
  els.standardSettingsSection.classList.toggle("hidden", !isStandard);
  els.openingSection.classList.toggle("hidden", !isOpening);
  els.openingPhotosSection.classList.toggle("hidden", !isOpening);
  els.endrollSection.classList.toggle("hidden", !isEndroll);
  els.endrollPhotosSection.classList.toggle("hidden", !isEndroll);
  els.endrollMessagesSection.classList.toggle("hidden", !isEndroll);
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
  els.endrollTitle1,
  els.endrollTitle2,
  els.endrollDateText,
  els.endrollHeaderLine1,
  els.endrollHeaderLine2,
].forEach((el) => el.addEventListener("input", updateDurationEstimate));

[els.endrollSpeed].forEach((el) => el.addEventListener("change", updateDurationEstimate));

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

// --- エンドロール用: 来賓へのメッセージ一覧（名前＋メッセージ） ---

function renderGuestMessageList() {
  els.guestMessageList.innerHTML = "";
  state.guestMessages.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "guest-row";
    row.draggable = true;
    row.dataset.id = String(entry.id);

    const top = document.createElement("div");
    top.className = "guest-row-top";

    const badge = document.createElement("span");
    badge.className = "guest-order";
    badge.textContent = String(index + 1);
    top.appendChild(badge);

    // グループ名（任意）。同じグループ名の行が連続していると、エンドロールに
    // その名前の見出しがまとめて1回だけ表示される（並び順はドラッグで調整）。
    const groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.className = "guest-group-input";
    groupInput.placeholder = "グループ（任意）";
    groupInput.maxLength = MAX_GUEST_GROUP_LENGTH;
    groupInput.value = entry.group || "";
    groupInput.draggable = false;
    groupInput.setAttribute("list", "guest-group-suggestions");
    groupInput.title = "候補（新郎家族／新郎友人／新郎先輩／新郎会社先輩／新婦家族／新婦友人／新婦会社）から選ぶか自由入力。同じグループ名の行はまとめて見出しが表示されます";
    groupInput.addEventListener("input", () => {
      entry.group = groupInput.value;
      updateDurationEstimate();
    });
    top.appendChild(groupInput);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "guest-name-input";
    nameInput.placeholder = "お名前";
    nameInput.maxLength = MAX_GUEST_NAME_LENGTH;
    nameInput.value = entry.name || "";
    nameInput.draggable = false;
    nameInput.addEventListener("input", () => {
      entry.name = nameInput.value;
      updateDurationEstimate();
    });
    top.appendChild(nameInput);

    const removeBtn = document.createElement("button");
    removeBtn.className = "guest-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      state.guestMessages = state.guestMessages.filter((g) => g.id !== entry.id);
      renderGuestMessageList();
      updateDurationEstimate();
    });
    top.appendChild(removeBtn);

    row.appendChild(top);

    const messageInput = document.createElement("textarea");
    messageInput.className = "guest-message-input";
    messageInput.placeholder = "メッセージ（任意）";
    messageInput.maxLength = MAX_GUEST_MESSAGE_LENGTH;
    messageInput.rows = 2;
    messageInput.value = entry.message || "";
    messageInput.draggable = false;
    messageInput.addEventListener("input", () => {
      entry.message = messageInput.value;
      updateDurationEstimate();
    });
    row.appendChild(messageInput);

    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(entry.id));
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
      if (draggedId === entry.id) return;
      const fromIndex = state.guestMessages.findIndex((g) => g.id === draggedId);
      const toIndex = state.guestMessages.findIndex((g) => g.id === entry.id);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = state.guestMessages.splice(fromIndex, 1);
      state.guestMessages.splice(toIndex, 0, moved);
      renderGuestMessageList();
    });

    els.guestMessageList.appendChild(row);
  });
}

function addGuestMessage() {
  if (state.guestMessages.length >= MAX_GUEST_MESSAGES) {
    alert(`メッセージは最大${MAX_GUEST_MESSAGES}件まで追加できます`);
    return;
  }
  state.guestMessages.push({ id: state.nextGuestMessageId++, name: "", group: "", message: "" });
  renderGuestMessageList();
  updateDurationEstimate();
}

els.addGuestMessageBtn.addEventListener("click", addGuestMessage);

function addBgmFiles(fileList) {
  const incoming = Array.from(fileList).filter((f) => looksLikeType(f, "audio/", AUDIO_EXTENSIONS));
  if (incoming.length === 0) {
    if (fileList.length > 0) alert("音声ファイルを選択してください（対応形式: mp3, m4a, wav, aac, ogg など）");
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

// 動画クリップはその本編の長さ（ユーザーが調整した使用秒数）で表示し、
// 写真は共通の photoDuration 設定で表示する。
// ただしビート同期が有効な場合は、写真・動画とも検出したBGMのテンポに
// 合わせた長さ（beatSyncDuration）で統一する。
function mediaDuration(item, settings) {
  if (settings.beatSyncDuration) return settings.beatSyncDuration;
  if (item.kind === "video") return item.clipSeconds;
  return item.duration != null ? item.duration : settings.photoDuration;
}

function computeStandardTimeline(settings) {
  const segments = [];
  segments.push({ type: "title", duration: INTRO_DUR, lines: introLines(settings) });
  settings.photos.forEach((photo, i) => {
    segments.push({ type: "photo", duration: mediaDuration(photo, settings), photo, variant: i % 4 });
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
    segments.push({ type: "photo", duration: mediaDuration(photo, settings), photo, variant: i % 4 });
  });

  // 3. 新婦パート
  pushImpact(
    [`BRIDE: ${settings.brideName}`, settings.brideSub1, settings.brideSub2].filter(Boolean),
    2,
    { bigFontSize: 44, lineHeight: 54 }
  );
  settings.bridePhotos.forEach((photo, i) => {
    segments.push({ type: "photo", duration: mediaDuration(photo, settings), photo, variant: i % 4 });
  });

  // 4. 2人の出会い〜思い出パート
  pushImpact(["TWO PATHS CROSS", "SPECIAL MEMORIES"], 2, { bigFontSize: 48 });
  settings.togetherPhotos.forEach((photo, i) => {
    segments.push({ type: "photo", duration: mediaDuration(photo, settings), photo, variant: i % 4 });
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

// 改行(\n)は保持しつつ、1行が長すぎる場合は指定幅に収まるよう自動で折り返す。
// 日本語は単語区切りが無いため文字単位で判定する（英数字混在でも実用上問題ない）。
function wrapText(ctx, text, maxWidth) {
  const paragraphs = String(text).split("\n");
  const result = [];
  paragraphs.forEach((para) => {
    if (para === "") {
      result.push("");
      return;
    }
    let line = "";
    for (const ch of para) {
      const test = line + ch;
      if (line !== "" && ctx.measureText(test).width > maxWidth) {
        result.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) result.push(line);
  });
  return result;
}

const ENDROLL_MAX_TEXT_WIDTH = CANVAS_W - 200;
const ENDROLL_MAX_ENTRIES_PER_PAGE = 4; // 1ページに入れる来賓の人数
const ENDROLL_NAME_GAP = 36;
const ENDROLL_MESSAGE_LINE_HEIGHT = 26;
const ENDROLL_ENTRY_GAP = 30;
const ENDROLL_PAGE_GROUP_HEADING_GAP = 40;

// タイピング演出（お名前→メッセージの順に1人ずつ1文字ずつ打ち込まれる）のペース。
// settings.endrollSpeed（遅い/標準/速い）を掛けて全体の速さを調整する。
const ENDROLL_TYPE_CHAR_SEC = 0.05; // 1文字あたりの基準タイピング時間
const ENDROLL_TYPE_NAME_MIN_SEC = 0.45; // お名前が短くても一瞬で表示されないための最低時間
const ENDROLL_TYPE_GAP_SEC = 0.25; // お名前とメッセージの間の間
const ENDROLL_TYPE_INITIAL_DELAY = 0.35; // ページが開いてから1人目が打ち始まるまで
const ENDROLL_TYPE_ENTRY_GAP = 0.3; // 1人分打ち終えてから次の人が始まるまで
const ENDROLL_TYPE_FINAL_HOLD = 1.1; // 全員打ち終えてからページがめくれるまでの余韻

// 各来賓のお名前・メッセージを1人ずつ順番にタイピングするためのスケジュール
// （開始タイミングと所要時間）を計算する。ページの表示時間の算出と実際の描画の
// 両方で使うため、必ずこの関数を通して同じ値を共有する。
function computeEndRollTypingSchedule(entries, speed) {
  let cursor = ENDROLL_TYPE_INITIAL_DELAY * speed;
  return entries.map((entry) => {
    const nameLen = (entry.name || "").length;
    const messageLen = (entry.message || "").length;
    const nameDur = nameLen > 0 ? Math.max(nameLen * ENDROLL_TYPE_CHAR_SEC, ENDROLL_TYPE_NAME_MIN_SEC) * speed : 0;
    const gapDur = nameDur > 0 && messageLen > 0 ? ENDROLL_TYPE_GAP_SEC * speed : 0;
    const messageDur = messageLen > 0 ? messageLen * ENDROLL_TYPE_CHAR_SEC * speed : 0;
    const start = cursor;
    cursor += nameDur + gapDur + messageDur + ENDROLL_TYPE_ENTRY_GAP * speed;
    return { entry, start, nameDur, gapDur, messageDur };
  });
}

// 来賓メッセージを「グループ」でまとめ、1ページにENDROLL_MAX_ENTRIES_PER_PAGE人まで
// 入るように区切って、ページ（本のページに相当する単位）の配列にする。グループ名が
// 同じ行は並び順に関係なく1つのグループとしてまとめる（初出のグループ順でページ化）。
// 人数が多いグループは同じグループ内で複数ページに分割する（つづきページ）。
function buildEndRollPages(settings) {
  const order = [];
  const buckets = new Map();
  settings.guestMessages.forEach((entry) => {
    const key = (entry.group || "").trim();
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key).push(entry);
  });

  const pages = [];
  order.forEach((groupName) => {
    const entries = buckets.get(groupName);
    for (let i = 0; i < entries.length; i += ENDROLL_MAX_ENTRIES_PER_PAGE) {
      pages.push({
        group: groupName,
        isContinuation: i > 0,
        entries: entries.slice(i, i + ENDROLL_MAX_ENTRIES_PER_PAGE),
        photo: null,
      });
    }
  });

  // 写真ごとに「背景にするグループ」が指定されていれば、そのグループ名と一致する
  // ページ（つづきページも含む）すべての背景にその写真を使う。グループ未指定の
  // 写真は、これまで通り順番に、専用の写真が無いグループの最初のページにだけ
  // 割り当てる。
  const photos = settings.endrollPhotos || [];
  const targetedByGroup = new Map();
  const untargeted = [];
  photos.forEach((photo) => {
    const key = (photo.endrollGroup || "").trim();
    if (key && !targetedByGroup.has(key)) {
      targetedByGroup.set(key, photo);
    } else if (!key) {
      untargeted.push(photo);
    }
  });

  let untargetedIndex = 0;
  pages.forEach((page) => {
    const targeted = page.group && targetedByGroup.get(page.group);
    if (targeted) {
      page.photo = targeted;
    } else if (!page.isContinuation && untargeted.length > 0) {
      page.photo = untargeted[untargetedIndex % untargeted.length];
      untargetedIndex++;
    }
  });

  return pages;
}

// ページの表示時間を、タイピング演出が最後まで打ち終わって少し余韻が
// 残るのに十分な長さになるよう、タイピングスケジュールから算出する。
function computeEndRollPageDuration(page, settings) {
  const speed = settings.endrollSpeed;
  const schedule = computeEndRollTypingSchedule(page.entries, speed);
  const last = schedule[schedule.length - 1];
  const typingEnd = last ? last.start + last.nameDur + last.gapDur + last.messageDur : ENDROLL_TYPE_INITIAL_DELAY * speed;
  const groupReadTime = page.group ? 0.6 * speed : 0;
  return Math.min(Math.max(typingEnd + groupReadTime + ENDROLL_TYPE_FINAL_HOLD * speed, 3), 20);
}

function computeEndRollTimeline(settings) {
  const segments = [];
  segments.push({ type: "title", duration: INTRO_DUR, lines: introLines(settings) });

  const headerSeconds = (settings.endrollHeaderLine2 ? 3.5 : 2.5) * settings.endrollSpeed;
  segments.push({
    type: "endroll-page",
    duration: Math.max(headerSeconds, 2.5),
    isHeaderPage: true,
    headerLine1: settings.endrollHeaderLine1,
    headerLine2: settings.endrollHeaderLine2,
  });

  buildEndRollPages(settings).forEach((page) => {
    segments.push({
      type: "endroll-page",
      duration: computeEndRollPageDuration(page, settings),
      group: page.group,
      isContinuation: page.isContinuation,
      entries: page.entries,
      photo: page.photo,
    });
  });

  return finalizeTimeline(segments, settings.transitionDuration);
}

function computeTimeline(settings) {
  if (settings.template === "opening") return computeOpeningTimeline(settings);
  if (settings.template === "endroll") return computeEndRollTimeline(settings);
  return computeStandardTimeline(settings);
}

function countPhotos(settings) {
  if (settings.template === "opening") {
    return settings.groomPhotos.length + settings.bridePhotos.length + settings.togetherPhotos.length;
  }
  if (settings.template === "endroll") {
    return settings.guestMessages.length;
  }
  return settings.photos.length;
}

function updateDurationEstimate() {
  const settings = getSettings();
  const { total } = computeTimeline(settings);
  const mins = Math.floor(total / 60);
  const secs = Math.round(total % 60);
  const countLabel =
    settings.template === "endroll"
      ? `来賓メッセージ ${countPhotos(settings)}件・ページの写真 ${settings.endrollPhotos.length}枚`
      : `写真・動画 ${countPhotos(settings)}点`;
  els.durationEstimate.textContent = `${countLabel} / 想定の動画の長さ: 約${mins > 0 ? mins + "分" : ""}${secs}秒`;
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

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// キャプションの見せ方（フェード/スライド＋フェード/キラキラ出現/タイプライター/
// バウンド/ズーム出現/常に表示）に応じて、透明度・スライド量・拡大率・文字の
// 表示割合（タイプライター用）を計算する。
function captionMotion(localT, duration, fadeMode) {
  const fadeLen = Math.min(FADE, duration / 2);
  const inProgress = fadeLen > 0 ? Math.min(Math.max(localT / fadeLen, 0), 1) : 1;
  const outProgress = fadeLen > 0 ? Math.min(Math.max((duration - localT) / fadeLen, 0), 1) : 1;
  const edge = Math.min(inProgress, outProgress, 1);

  if (fadeMode === "none") {
    return { alpha: 1, offsetY: 0, scale: 1, reveal: 1 };
  }
  if (fadeMode === "slide") {
    return { alpha: edge, offsetY: (1 - edge) * 26, scale: 1, reveal: 1 };
  }
  if (fadeMode === "sparkle") {
    const ease = 1 - Math.pow(1 - inProgress, 3);
    // フェードだけでなく、下から浮かび上がるように少し大きめのスライド量を使う。
    return { alpha: edge, offsetY: (1 - ease) * 34, scale: 1, reveal: 1 };
  }
  if (fadeMode === "typewriter") {
    // 1文字ずつ打ち込まれるように表示する（CapCutのタイプライター演出風）。
    const revealDur = Math.min(1.2, Math.max(duration * 0.6, 0.01));
    const reveal = Math.min(Math.max(localT / revealDur, 0), 1);
    return { alpha: outProgress, offsetY: 0, scale: 1, reveal };
  }
  if (fadeMode === "bounce") {
    // 弾むように少し飛び出してから収まる（CapCutのバウンド演出風）。
    const scale = Math.max(0, easeOutBack(inProgress));
    return { alpha: edge, offsetY: 0, scale, reveal: 1 };
  }
  if (fadeMode === "zoomin") {
    // 小さい状態から滑らかに等倍まで拡大しながら現れる。
    const scale = 0.5 + 0.5 * easeOutCubic(inProgress);
    return { alpha: edge, offsetY: 0, scale, reveal: 1 };
  }
  return { alpha: fadeAlpha(localT, duration, fadeLen), offsetY: 0, scale: 1, reveal: 1 };
}

// 疑似乱数（0〜1）。パーティクルごとに同じシード値なら毎フレーム同じ値になる。
function sparkleRandom(seed) {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

// 十字＋中心の光点でできた、きらめく星形パーティクルを描画する。
function drawSparkleStar(ctx, x, y, size, alpha) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1, size * 0.18);
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.lineTo(size, 0);
  ctx.moveTo(0, -size);
  ctx.lineTo(0, size);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

// 文字の左右から星のパーティクルが飛んできて文字の周りできらめく演出。
function drawSparkleOverlay(ctx, cx, cy, halfWidth, localT, duration) {
  const fadeLen = Math.min(FADE, duration / 2);
  const inProgress = fadeLen > 0 ? Math.min(Math.max(localT / fadeLen, 0), 1) : 1;
  const count = 10;
  const spread = Math.max(halfWidth, 60);
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    const seed = i * 12.9898 + 3.51;
    const arriveAt = 0.15 + sparkleRandom(seed) * 0.6;
    const arrive = arriveAt > 0 ? Math.min(inProgress / arriveAt, 1) : 1;
    if (arrive <= 0) continue;
    const startX = fromLeft
      ? cx - spread - 200 - sparkleRandom(seed + 1) * 80
      : cx + spread + 200 + sparkleRandom(seed + 1) * 80;
    const targetX = cx + (sparkleRandom(seed + 2) - 0.5) * spread * 2;
    const targetY = cy + (sparkleRandom(seed + 3) - 0.5) * 44;
    const startY = targetY + (sparkleRandom(seed + 4) - 0.5) * 30;
    const ease = 1 - Math.pow(1 - arrive, 3);
    const px = startX + (targetX - startX) * ease;
    const py = startY + (targetY - startY) * ease;
    const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(localT * (3 + sparkleRandom(seed + 5) * 3) + seed));
    const alpha = arrive * twinkle;
    const size = 5 + sparkleRandom(seed + 6) * 4;
    drawSparkleStar(ctx, px, py, size, alpha);
  }
}

function drawCaption(ctx, text, localT, duration, theme, style, fadeMode, fontSize) {
  const { alpha, offsetY, scale, reveal } = captionMotion(localT, duration, fadeMode || "fade");
  if (alpha <= 0) return;
  const size = fontSize || 32;
  // タイプライター演出用に表示する文字数を絞り込む（それ以外は常に全文表示）。
  const revealedText = reveal >= 0.999 ? text : text.slice(0, Math.max(0, Math.round(text.length * reveal)));
  if (revealedText === "") return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, offsetY);

  let capCenterX = CANVAS_W / 2;
  let capCenterY = CANVAS_H / 2;
  let capHalfWidth = 100;

  if (style === "elegant") {
    // 背景バーなし。明朝体イタリック＋文字影＋下に細いアクセント線というシンプルな見せ方。
    const fSize = size + 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `italic 400 ${fSize}px serif`;
    capCenterY = CANVAS_H - 76;
    capHalfWidth = Math.min(ctx.measureText(text).width, CANVAS_W - 100) / 2;
    ctx.save();
    ctx.translate(capCenterX, capCenterY);
    ctx.scale(scale, scale);
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(revealedText, 0, 0, CANVAS_W - 100);
    ctx.restore();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2 - 50, CANVAS_H - 46);
    ctx.lineTo(CANVAS_W / 2 + 50, CANVAS_H - 46);
    ctx.stroke();
  } else if (style === "pop") {
    // テーマカラーの丸みを帯びたピル型バッジに太字白文字。
    const fSize = Math.max(size - 2, 12);
    ctx.font = `700 ${fSize}px sans-serif`;
    const maxTextWidth = CANVAS_W - 120;
    const textWidth = Math.min(ctx.measureText(text).width, maxTextWidth);
    const paddingX = 28;
    const pillW = Math.min(textWidth + paddingX * 2, CANVAS_W - 60);
    const pillH = Math.round(fSize * 1.93);
    const pillX = CANVAS_W / 2 - pillW / 2;
    const pillY = CANVAS_H - 118;
    capCenterX = CANVAS_W / 2;
    capCenterY = pillY + pillH / 2;
    capHalfWidth = pillW / 2;
    ctx.fillStyle = theme.accent;
    roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.save();
    ctx.translate(capCenterX, capCenterY + 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(revealedText, 0, 0, pillW - paddingX * 2);
    ctx.restore();
  } else {
    // "simple"（既定）: 下から暗くなるグラデーションバー＋白文字＋アクセント下線。
    const fSize = size;
    const barHeight = Math.round(fSize * 2.875);
    const y = CANVAS_H - barHeight;
    const grad = ctx.createLinearGradient(0, y, 0, CANVAS_H);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, CANVAS_W, barHeight);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `500 ${fSize}px serif`;
    capCenterX = CANVAS_W / 2;
    capCenterY = CANVAS_H - barHeight / 2 + 8;
    capHalfWidth = Math.min(ctx.measureText(text).width, CANVAS_W - 80) / 2;
    ctx.save();
    ctx.translate(capCenterX, capCenterY);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(revealedText, 0, 0, CANVAS_W - 80);
    ctx.restore();

    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2 - 40, CANVAS_H - barHeight / 2 - 24);
    ctx.lineTo(CANVAS_W / 2 + 40, CANVAS_H - barHeight / 2 - 24);
    ctx.stroke();
  }

  if (fadeMode === "sparkle") {
    drawSparkleOverlay(ctx, capCenterX, capCenterY, capHalfWidth, localT, duration);
  }

  ctx.restore();
}

function drawPhoto(ctx, seg, localT, settings) {
  const isVideo = seg.photo.kind === "video";
  const img = isVideo ? seg.photo.videoEl : seg.photo.img;

  if (isVideo && !seg._started) {
    seg._started = true;
    try {
      img.currentTime = 0;
    } catch (err) {
      // seek前に呼ばれるブラウザもあるため失敗は無視する
    }
    img.play().catch(() => {
      // 自動再生がブロックされても録画自体は続行する（無音のためポリシー上ほぼ問題にならない）
    });
  }

  const progress = Math.min(Math.max(localT / seg.duration, 0), 1);
  const zoomIn = seg.variant % 2 === 0;
  const scale = zoomIn ? 1 + ZOOM_AMOUNT * progress : 1 + ZOOM_AMOUNT * (1 - progress);

  const { width: imgW, height: imgH } = intrinsicSize(img);
  const imgRatio = imgW / imgH;
  const canvasRatio = CANVAS_W / CANVAS_H;

  // 写真ごとの表示サイズ上書き（未指定なら共通設定に従う）。
  // 100%未満のときは、余白（テーマカラーの背景）付きで写真を小さく表示する。
  const effScale = seg.photo.displayScale != null ? seg.photo.displayScale : settings.photoDisplayScale;
  const scaleFrac = Math.min(Math.max(effScale || 100, 30), 100) / 100;
  const frameW = CANVAS_W * scaleFrac;
  const frameH = CANVAS_H * scaleFrac;
  const frameX = (CANVAS_W - frameW) / 2;
  const frameY = (CANVAS_H - frameH) / 2;

  let baseW, baseH;
  if (imgRatio > canvasRatio) {
    baseH = frameH;
    baseW = baseH * imgRatio;
  } else {
    baseW = frameW;
    baseH = baseW / imgRatio;
  }
  const drawW = baseW * scale;
  const drawH = baseH * scale;

  const maxOffsetX = (drawW - frameW) / 2;
  const maxOffsetY = (drawH - frameH) / 2;

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

  const bgGrad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
  bgGrad.addColorStop(0, settings.theme.bg1);
  bgGrad.addColorStop(1, settings.theme.bg2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(frameX, frameY, frameW, frameH);
  ctx.clip();
  ctx.drawImage(
    img,
    frameX + frameW / 2 - drawW / 2 + offsetX,
    frameY + frameH / 2 - drawH / 2 + offsetY,
    drawW,
    drawH
  );
  ctx.restore();

  if (scaleFrac < 0.999) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 4;
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 18;
    ctx.strokeRect(frameX, frameY, frameW, frameH);
    ctx.restore();
  }

  if (seg.photo.caption) {
    const effFontSize = seg.photo.captionFontSize != null ? seg.photo.captionFontSize : settings.captionFontSize;
    const effFade = seg.photo.captionFade || settings.captionFade;
    drawCaption(
      ctx,
      seg.photo.caption,
      localT,
      seg.duration,
      settings.theme,
      settings.captionStyle,
      effFade,
      effFontSize
    );
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
    case "circle": {
      // 中央から円形に広がりながら次の写真に切り替わる（CapCutの円形ワイプ風）
      ctx.drawImage(canvasA, 0, 0);
      const maxRadius = Math.hypot(CANVAS_W / 2, CANVAS_H / 2);
      const radius = maxRadius * easeOutCubic(progress);
      ctx.save();
      ctx.beginPath();
      ctx.arc(CANVAS_W / 2, CANVAS_H / 2, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(canvasB, 0, 0);
      ctx.restore();
      break;
    }
    case "rotatezoom": {
      // 次の写真がわずかに回転しながらズームイン（CapCutのポップな回転演出風）
      ctx.drawImage(canvasA, 0, 0);
      ctx.save();
      ctx.globalAlpha = progress;
      ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
      ctx.rotate((1 - progress) * 0.35);
      const scale = 0.7 + 0.3 * easeOutCubic(progress);
      ctx.scale(scale, scale);
      ctx.drawImage(canvasB, -CANVAS_W / 2, -CANVAS_H / 2);
      ctx.restore();
      break;
    }
    case "blur": {
      // 山なりにぼかしながらクロスフェードする（CapCutのぼかしトランジション風）
      const blurAmount = 16 * Math.sin(Math.min(Math.max(progress, 0), 1) * Math.PI);
      ctx.save();
      ctx.filter = blurAmount > 0.1 ? `blur(${blurAmount}px)` : "none";
      ctx.globalAlpha = 1 - progress;
      ctx.drawImage(canvasA, 0, 0);
      ctx.globalAlpha = progress;
      ctx.drawImage(canvasB, 0, 0);
      ctx.filter = "none";
      ctx.restore();
      break;
    }
    case "pageflip": {
      // 本のページをめくるような演出（エンドロール専用）。
      // 次のページを先に敷いておき、現在のページを左端（本の綴じ目）を軸に
      // 横方向へ縮めていくことで、ページが奥へめくれていくように見せる。
      ctx.drawImage(canvasB, 0, 0);
      const scaleX = Math.max(1 - progress, 0.001);
      ctx.save();
      ctx.scale(scaleX, 1);
      ctx.drawImage(canvasA, 0, 0);
      ctx.restore();

      const shadowW = CANVAS_W * scaleX;
      const grad = ctx.createLinearGradient(shadowW * 0.55, 0, shadowW, 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${0.5 * progress})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, shadowW, CANVAS_H);
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

  // 「開始時刻 <= t」を満たす最後のセグメントが現在のセグメント。
  // finalizeTimelineは切り替え時間の分だけ次のセグメントの開始時刻を早めているため、
  // 1つ前のセグメントの本来の終了時刻（開始時刻+長さ）までは、まだ前のセグメントとの
  // 重なり（トランジション）区間にいることになる。
  let activeIndex = 0;
  for (let i = 0; i < segments.length; i++) {
    if (startTimes[i] <= t) activeIndex = i;
  }

  const prevIndex = activeIndex - 1;
  const prevEnd = prevIndex >= 0 ? startTimes[prevIndex] + segments[prevIndex].duration : -Infinity;
  const inTransition = prevIndex >= 0 && t < prevEnd;

  if (!inTransition) {
    const localT = t - startTimes[activeIndex];
    drawSegment(ctx, segments[activeIndex], localT, settings);
  } else {
    const prevSeg = segments[prevIndex];
    const curSeg = segments[activeIndex];
    const prevLocalT = t - startTimes[prevIndex];
    const curLocalT = t - startTimes[activeIndex];
    const progress = Math.min(Math.max(curLocalT / settings.transitionDuration, 0), 1);
    transitionCtxA.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawSegment(transitionCtxA, prevSeg, prevLocalT, settings);
    transitionCtxB.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawSegment(transitionCtxB, curSeg, curLocalT, settings);
    const type = pickTransitionType(settings, prevIndex);
    compositeTransition(ctx, transitionBufferA, transitionBufferB, progress, type);
  }

  if (settings.template !== "opening") {
    drawVignette(ctx, settings.theme.accent);
  }
}

// --- エンドロール（本のページをめくる演出）---

function endRollPhotoImg(photo) {
  return photo.kind === "video" ? photo.videoEl : photo.img;
}

// ページに動画を使う場合、初回だけ再生を開始する（写真と混在させても壊れないように）。
function ensureEndRollVideoPlaying(photo) {
  if (photo.kind !== "video" || photo._bgStarted) return;
  photo._bgStarted = true;
  try {
    photo.videoEl.currentTime = 0;
  } catch (err) {
    // seek前に呼ばれるブラウザもあるため失敗は無視する
  }
  photo.videoEl.play().catch(() => {
    // 自動再生がブロックされても録画自体は続行する
  });
}

// 指定した矩形いっぱいに、Ken Burns風のズーム/パンをかけながら写真・動画を描画する
// （エンドロールのページ写真専用。キャプションや表示サイズ設定は考慮しない）。
function drawCoverZoomPhoto(ctx, img, progress, variant, frameX, frameY, frameW, frameH) {
  const zoomIn = variant % 2 === 0;
  const scale = zoomIn ? 1 + ZOOM_AMOUNT * progress : 1 + ZOOM_AMOUNT * (1 - progress);
  const { width: imgW, height: imgH } = intrinsicSize(img);
  const imgRatio = imgW / imgH;
  const frameRatio = frameW / frameH;
  let baseW, baseH;
  if (imgRatio > frameRatio) {
    baseH = frameH;
    baseW = baseH * imgRatio;
  } else {
    baseW = frameW;
    baseH = baseW / imgRatio;
  }
  const drawW = baseW * scale;
  const drawH = baseH * scale;
  const maxOffsetX = (drawW - frameW) / 2;
  const maxOffsetY = (drawH - frameH) / 2;
  const directions = [
    [-1, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
  ];
  const [dx, dy] = directions[variant % directions.length];
  const panProgress = zoomIn ? progress : 1 - progress;
  const offsetX = dx * maxOffsetX * panProgress;
  const offsetY = dy * maxOffsetY * panProgress;

  ctx.save();
  ctx.beginPath();
  ctx.rect(frameX, frameY, frameW, frameH);
  ctx.clip();
  ctx.drawImage(
    img,
    frameX + frameW / 2 - drawW / 2 + offsetX,
    frameY + frameH / 2 - drawH / 2 + offsetY,
    drawW,
    drawH
  );
  ctx.restore();
}

// テーマカラーごとの「紙」の色味（背景の紙色・ビネット・インク色・アクセント線）。
// onPhotoTextは、写真を背景にしたページでインクの代わりに使う明るい文字色
// （紙の色ではなく写真+暗幕の上に乗るため、はっきり読める明るいトーンにしてある）。
const ENDROLL_PAPER_THEMES = {
  pink: { paper1: "#faf3e6", paper2: "#efe0c7", ink: "#4a3527", accent: "#b8865b", onPhotoText: "#fdf6ec" },
  navy: { paper1: "#f2ede0", paper2: "#e2d9c2", ink: "#2c2a3a", accent: "#5a5470", onPhotoText: "#f1eef8" },
  green: { paper1: "#f5f1e2", paper2: "#e6ddbf", ink: "#33402c", accent: "#6b7d4f", onPhotoText: "#f2f6e6" },
};

// wrapTextと同じ折り返しアルゴリズムで行分割しつつ、各行の先頭が元のテキストの
// 何文字目から始まるか（start）も一緒に返す。タイピング演出で「あと何文字まで
// 見せるか（revealCount）」を各行にマッピングするために必要。
function wrapTextWithOffsets(ctx, text, maxWidth) {
  const paragraphs = String(text).split("\n");
  const result = [];
  let offset = 0;
  paragraphs.forEach((para, pIdx) => {
    if (para === "") {
      result.push({ line: "", start: offset });
    } else {
      let line = "";
      let lineStart = offset;
      for (const ch of para) {
        const test = line + ch;
        if (line !== "" && ctx.measureText(test).width > maxWidth) {
          result.push({ line, start: lineStart });
          lineStart += line.length;
          line = ch;
        } else {
          line = test;
        }
      }
      if (line) result.push({ line, start: lineStart });
    }
    offset += para.length;
    if (pIdx < paragraphs.length - 1) offset += 1; // 消費される"\n"の分
  });
  return result;
}

// 写真の縦横比を保ったまま、写真全体が見切れないようにフレーム内に収めて描画する
// （drawCoverZoomPhotoの「はみ出た分を切り取って埋める」のとは逆に、余る分は
// 何も描かない＝呼び出し側で背景を別に埋めておく前提）。
function drawContainPhoto(ctx, img, frameX, frameY, frameW, frameH) {
  const { width: imgW, height: imgH } = intrinsicSize(img);
  const imgRatio = imgW / imgH;
  const frameRatio = frameW / frameH;
  let drawW, drawH;
  if (imgRatio > frameRatio) {
    drawW = frameW;
    drawH = drawW / imgRatio;
  } else {
    drawH = frameH;
    drawW = drawH * imgRatio;
  }
  ctx.drawImage(img, frameX + (frameW - drawW) / 2, frameY + (frameH - drawH) / 2, drawW, drawH);
}

// エンドロールの1ページ分を描画する。見出しページは中央にお礼のメッセージを表示。
// 通常ページは、写真があればページ全体を写真の背景にし（なければ本のページの
// ような紙の質感の背景）、グループ見出し・来賓の名前とメッセージを、お名前→
// メッセージの順に1人ずつ1文字ずつタイピングされるように表示する
// （ページ間の動きはcompositeTransitionの"pageflip"が担当する）。
function drawEndRollPage(ctx, seg, localT, settings) {
  const paper = ENDROLL_PAPER_THEMES[settings.endrollThemeKey] || ENDROLL_PAPER_THEMES.pink;
  const hasPhotoBg = !seg.isHeaderPage && !!seg.photo;

  if (hasPhotoBg) {
    ensureEndRollVideoPlaying(seg.photo);
    const bgImg = endRollPhotoImg(seg.photo);
    // 写真が見切れないよう、まず拡大＆ぼかした同じ写真でページ全体を埋め、
    // その上に写真全体（縦横比そのまま）を重ねて表示する。
    ctx.save();
    ctx.filter = "blur(24px)";
    drawCoverZoomPhoto(ctx, bgImg, 0.5, 0, 0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
    drawContainPhoto(ctx, bgImg, 0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    grad.addColorStop(0, paper.paper1);
    grad.addColorStop(1, paper.paper2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const vign = ctx.createRadialGradient(
      CANVAS_W / 2,
      CANVAS_H / 2,
      CANVAS_H * 0.3,
      CANVAS_W / 2,
      CANVAS_H / 2,
      CANVAS_H * 0.78
    );
    vign.addColorStop(0, "rgba(0,0,0,0)");
    vign.addColorStop(1, "rgba(0,0,0,0.12)");
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  ctx.save();
  ctx.strokeStyle = hasPhotoBg ? "rgba(255,255,255,0.55)" : paper.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, CANVAS_W - 60, CANVAS_H - 60);
  ctx.restore();

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (seg.isHeaderPage) {
    ctx.font = "700 46px serif";
    ctx.fillStyle = paper.ink;
    ctx.fillText(seg.headerLine1, CANVAS_W / 2, CANVAS_H / 2 - (seg.headerLine2 ? 26 : 0));
    if (seg.headerLine2) {
      ctx.font = "300 26px serif";
      ctx.fillText(seg.headerLine2, CANVAS_W / 2, CANVAS_H / 2 + 30);
    }
    ctx.restore();
    return;
  }

  const textColor = hasPhotoBg ? paper.onPhotoText : paper.ink;
  let y = 90;

  if (seg.group) {
    ctx.font = "700 32px serif";
    ctx.fillStyle = textColor;
    ctx.fillText(seg.group + (seg.isContinuation ? "（つづき）" : ""), CANVAS_W / 2, y);
    y += 22;
    ctx.strokeStyle = paper.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2 - 70, y);
    ctx.lineTo(CANVAS_W / 2 + 70, y);
    ctx.stroke();
    y += ENDROLL_PAGE_GROUP_HEADING_GAP;
  } else {
    y += 20;
  }

  const schedule = computeEndRollTypingSchedule(seg.entries, settings.endrollSpeed);

  schedule.forEach(({ entry, start, nameDur, gapDur, messageDur }) => {
    const elapsed = localT - start;

    let revealedName = "";
    if (entry.name) {
      if (elapsed <= 0) {
        revealedName = "";
      } else if (nameDur <= 0) {
        revealedName = entry.name;
      } else {
        const frac = Math.min(elapsed / nameDur, 1);
        revealedName = entry.name.slice(0, Math.ceil(entry.name.length * frac));
      }
    }
    ctx.font = "600 26px serif";
    ctx.fillStyle = paper.accent;
    if (revealedName) ctx.fillText(revealedName, CANVAS_W / 2, y);
    y += ENDROLL_NAME_GAP;

    ctx.font = "300 20px serif";
    ctx.fillStyle = textColor;
    const fullLines = entry.message ? wrapTextWithOffsets(ctx, entry.message, ENDROLL_MAX_TEXT_WIDTH) : [];

    let revealCount = 0;
    if (entry.message) {
      const messageElapsed = elapsed - nameDur - gapDur;
      if (messageElapsed <= 0) {
        revealCount = 0;
      } else if (messageDur <= 0) {
        revealCount = entry.message.length;
      } else {
        const frac = Math.min(messageElapsed / messageDur, 1);
        revealCount = Math.ceil(entry.message.length * frac);
      }
    }

    fullLines.forEach(({ line, start: lineStart }) => {
      const shownLen = Math.max(0, Math.min(line.length, revealCount - lineStart));
      const shown = line.slice(0, shownLen);
      if (shown) ctx.fillText(shown, CANVAS_W / 2, y);
      y += ENDROLL_MESSAGE_LINE_HEIGHT;
    });
    y += ENDROLL_ENTRY_GAP;
  });

  ctx.restore();
}

function drawSegment(ctx, seg, localT, settings) {
  if (seg.type === "title") {
    drawTitleCard(ctx, seg, localT, settings);
  } else if (seg.type === "impact-text") {
    drawImpactCard(ctx, seg, localT, settings);
  } else if (seg.type === "countdown-number") {
    drawCountdownNumber(ctx, seg, localT, settings);
  } else if (seg.type === "endroll-page") {
    drawEndRollPage(ctx, seg, localT, settings);
  } else {
    drawPhoto(ctx, seg, localT, settings);
  }
}

// --- 動画生成（MediaRecorder） ---

function pickMimeType() {
  const candidates = [
    // iOS(Safari含む)は、ブラウザのMediaRecorder自体はWebM(VP9/Opus)の
    // isTypeSupportedにtrueを返すことがあるが、そのWebMファイルは「写真に保存」や
    // 他アプリへの共有（LINEなど）に使われるOS側のメディア基盤では扱えず、
    // 長押し保存や共有が壊れる（リンクだけが送られて動画が開けない等）原因になる。
    // MP4(H.264/AAC)はどのプラットフォームでも安全に扱えるため、対応していれば必ず優先する。
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function extensionForMimeType(mimeType) {
  return mimeType && mimeType.includes("mp4") ? "mp4" : "webm";
}

function baseMimeType(mimeType) {
  return (mimeType || "video/webm").split(";")[0].trim();
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

// BGMのテンポ（拍の間隔）をおおまかに検出する。低域（キック・ベース帯域）を
// 強調したエネルギー包絡線から立ち上がり（オンセット）を検出し、オンセット間隔の
// 中央値をテンポの目安として採用する簡易的な手法（完璧な検出ではない）。
async function detectBeats(file) {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const decodeCtx = new AudioCtx();
  let audioBuffer;
  try {
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    decodeCtx.close();
  }

  const sampleRate = audioBuffer.sampleRate;
  const analyzeSeconds = Math.min(audioBuffer.duration, BEAT_ANALYSIS_MAX_SECONDS);
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offline = new OfflineCtx(1, Math.ceil(sampleRate * analyzeSeconds), sampleRate);
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  const lowpass = offline.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 150;
  source.connect(lowpass);
  lowpass.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const data = rendered.getChannelData(0);

  const hopSeconds = 0.02;
  const hopSize = Math.max(1, Math.round(sampleRate * hopSeconds));
  const frameCount = Math.floor(data.length / hopSize);
  const energies = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    const start = i * hopSize;
    const end = start + hopSize;
    for (let j = start; j < end; j++) {
      const v = data[j];
      sum += v * v;
    }
    energies[i] = sum / hopSize;
  }

  const windowFrames = Math.round(1 / hopSeconds);
  const minGapFrames = Math.round(0.25 / hopSeconds);
  const onsets = [];
  let lastOnsetFrame = -Infinity;
  for (let i = 0; i < frameCount; i++) {
    const winStart = Math.max(0, i - windowFrames);
    let sum = 0;
    for (let k = winStart; k < i; k++) sum += energies[k];
    const count = i - winStart;
    const localAvg = count > 0 ? sum / count : 0;
    if (energies[i] > localAvg * 1.4 && energies[i] > 1e-6 && i - lastOnsetFrame >= minGapFrames) {
      onsets.push(i * hopSeconds);
      lastOnsetFrame = i;
    }
  }

  if (onsets.length < 4) {
    return { beatInterval: 60 / 124, confident: false };
  }

  const intervals = [];
  for (let i = 1; i < onsets.length; i++) intervals.push(onsets[i] - onsets[i - 1]);
  intervals.sort((a, b) => a - b);
  let beatInterval = intervals[Math.floor(intervals.length / 2)];

  // 検出間隔がテンポの整数倍(半分・2倍など)になりがちなため、妥当なBPM帯に収める
  const minInterval = 60 / BEAT_MAX_BPM;
  const maxInterval = 60 / BEAT_MIN_BPM;
  for (let guard = 0; beatInterval < minInterval && guard < 8; guard++) beatInterval *= 2;
  for (let guard = 0; beatInterval > maxInterval && guard < 8; guard++) beatInterval /= 2;

  return { beatInterval, confident: true };
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

async function renderVideo({ audioFiles, beatSyncCutDuration, onProgress } = {}) {
  let settings = getSettings();
  if (countPhotos(settings) === 0) {
    throw new Error("写真・動画・メッセージを1つ以上追加してください");
  }
  if (beatSyncCutDuration) {
    settings = {
      ...settings,
      beatSyncDuration: beatSyncCutDuration,
      // 短い拍間隔にトランジションが食い込みすぎないよう、切り替え長も合わせて短縮する
      transitionDuration: Math.min(settings.transitionDuration, beatSyncCutDuration * 0.4),
    };
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
  timeline.segments.forEach((seg) => {
    if (seg.type === "photo" && seg.photo.kind === "video") {
      seg.photo.videoEl.pause();
      try {
        seg.photo.videoEl.currentTime = 0;
      } catch (err) {
        // 何もしない（サムネイル表示が先頭フレームに戻らないだけ）
      }
    }
    if (seg.type === "endroll-page" && seg.photo && seg.photo.kind === "video") {
      seg.photo.videoEl.pause();
      seg.photo._bgStarted = false;
      try {
        seg.photo.videoEl.currentTime = 0;
      } catch (err) {
        // 何もしない（サムネイル表示が先頭フレームに戻らないだけ）
      }
    }
  });
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

// --- 下書き（写真・動画・入力内容）の一時保存 ---
// 生成した動画そのものではなく、選んだ写真・動画・入力した文章・設定を
// この端末のIndexedDBにだけ保存する（サーバーには送信しない）。写真・動画は
// Blobのまま保存できるため、次回開いたときに元のファイルとして復元できる。

const DRAFT_DB_NAME = "wedding-movie-draft-db";
const DRAFT_STORE_NAME = "drafts";
const DRAFT_KEY = "current";

function openDraftDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DRAFT_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDraftToDB(data) {
  const db = await openDraftDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
    tx.objectStore(DRAFT_STORE_NAME).put(data, DRAFT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDraftFromDB() {
  const db = await openDraftDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, "readonly");
    const req = tx.objectStore(DRAFT_STORE_NAME).get(DRAFT_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteDraftFromDB() {
  const db = await openDraftDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
    tx.objectStore(DRAFT_STORE_NAME).delete(DRAFT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function collectGroupDraftItems(group) {
  return group.photos
    .filter((p) => p.file) // 元ファイルの参照がないものは復元できないため対象外
    .map((p) => ({
      kind: p.kind,
      blob: p.file,
      fileName: p.file.name,
      fileType: p.file.type,
      caption: p.caption || "",
      clipSeconds: p.kind === "video" ? p.clipSeconds : undefined,
      duration: p.kind === "image" ? p.duration : undefined,
      captionFontSize: p.captionFontSize,
      captionFade: p.captionFade,
      displayScale: p.displayScale,
      endrollGroup: p.endrollGroup || "",
    }));
}

function collectDraftData() {
  return {
    savedAt: Date.now(),
    template: getTemplate(),
    fields: {
      title1: els.title1.value,
      title2: els.title2.value,
      dateText: els.dateText.value,
      endMessage: els.endMessage.value,
      theme: els.themeSelect.value,
      photoDuration: els.photoDuration.value,
      photoDisplayScale: els.photoDisplayScale.value,
      transitionType: els.transitionType.value,
      transitionDuration: els.transitionDuration.value,
      opGroomName: els.opGroomName.value,
      opGroomSub1: els.opGroomSub1.value,
      opGroomSub2: els.opGroomSub2.value,
      opBrideName: els.opBrideName.value,
      opBrideSub1: els.opBrideSub1.value,
      opBrideSub2: els.opBrideSub2.value,
      opNeonColor: els.opNeonColor.value,
      opPhotoDuration: els.opPhotoDuration.value,
      opPhotoDisplayScale: els.opPhotoDisplayScale.value,
      opTransitionType: els.opTransitionType.value,
      opTransitionDuration: els.opTransitionDuration.value,
      captionStyle: els.captionStyle.value,
      captionFontSize: els.captionFontSize.value,
      captionFade: els.captionFade.value,
      opCaptionStyle: els.opCaptionStyle.value,
      opCaptionFontSize: els.opCaptionFontSize.value,
      opCaptionFade: els.opCaptionFade.value,
      beatSyncEnabled: els.beatSyncEnabled.checked,
      beatSyncInterval: els.beatSyncInterval.value,
      endrollTitle1: els.endrollTitle1.value,
      endrollTitle2: els.endrollTitle2.value,
      endrollDateText: els.endrollDateText.value,
      endrollTheme: els.endrollTheme.value,
      endrollHeaderLine1: els.endrollHeaderLine1.value,
      endrollHeaderLine2: els.endrollHeaderLine2.value,
      endrollSpeed: els.endrollSpeed.value,
    },
    groups: {
      standard: collectGroupDraftItems(standardGroup),
      groom: collectGroupDraftItems(groomGroup),
      bride: collectGroupDraftItems(brideGroup),
      together: collectGroupDraftItems(togetherGroup),
      endroll: collectGroupDraftItems(endrollGroup),
    },
    bgmFiles: state.bgmFiles.map((t) => ({
      blob: t.file,
      fileName: t.file.name,
      fileType: t.file.type,
    })),
    guestMessages: state.guestMessages.map((g) => ({ name: g.name, group: g.group, message: g.message })),
  };
}

async function restoreDraftData(data) {
  const f = data.fields || {};
  els.title1.value = f.title1 || "";
  els.title2.value = f.title2 || "";
  els.dateText.value = f.dateText || "";
  els.endMessage.value = f.endMessage || "";
  els.themeSelect.value = f.theme || "pink";
  els.photoDuration.value = f.photoDuration || 4;
  els.photoDisplayScale.value = f.photoDisplayScale || 100;
  els.transitionType.value = f.transitionType || "crossfade";
  els.transitionDuration.value = f.transitionDuration || 0.8;
  els.opGroomName.value = f.opGroomName || "";
  els.opGroomSub1.value = f.opGroomSub1 || "";
  els.opGroomSub2.value = f.opGroomSub2 || "";
  els.opBrideName.value = f.opBrideName || "";
  els.opBrideSub1.value = f.opBrideSub1 || "";
  els.opBrideSub2.value = f.opBrideSub2 || "";
  els.opNeonColor.value = f.opNeonColor || "pink";
  els.opPhotoDuration.value = f.opPhotoDuration || 1;
  els.opPhotoDisplayScale.value = f.opPhotoDisplayScale || 100;
  els.opTransitionType.value = f.opTransitionType || "flash";
  els.opTransitionDuration.value = f.opTransitionDuration || 0.3;
  els.captionStyle.value = f.captionStyle || "simple";
  els.captionFontSize.value = f.captionFontSize || 32;
  els.captionFade.value = f.captionFade || "fade";
  els.opCaptionStyle.value = f.opCaptionStyle || "simple";
  els.opCaptionFontSize.value = f.opCaptionFontSize || 32;
  els.opCaptionFade.value = f.opCaptionFade || "fade";
  els.beatSyncEnabled.checked = !!f.beatSyncEnabled;
  els.beatSyncInterval.value = f.beatSyncInterval || 2;
  els.endrollTitle1.value = f.endrollTitle1 || "";
  els.endrollTitle2.value = f.endrollTitle2 || "";
  els.endrollDateText.value = f.endrollDateText || "";
  els.endrollTheme.value = f.endrollTheme || "pink";
  els.endrollHeaderLine1.value = f.endrollHeaderLine1 || "";
  els.endrollHeaderLine2.value = f.endrollHeaderLine2 || "";
  els.endrollSpeed.value = f.endrollSpeed || "normal";

  const templateValue = ["opening", "endroll"].includes(data.template) ? data.template : "standard";
  const templateRadio = document.querySelector(`input[name="template"][value="${templateValue}"]`);
  if (templateRadio) templateRadio.checked = true;
  updateTemplateVisibility();

  await standardGroup.restoreItems((data.groups && data.groups.standard) || []);
  await groomGroup.restoreItems((data.groups && data.groups.groom) || []);
  await brideGroup.restoreItems((data.groups && data.groups.bride) || []);
  await togetherGroup.restoreItems((data.groups && data.groups.together) || []);
  await endrollGroup.restoreItems((data.groups && data.groups.endroll) || []);

  state.bgmFiles = (data.bgmFiles || []).map((b) => ({
    id: state.nextBgmId++,
    file: new File([b.blob], b.fileName, { type: b.fileType }),
  }));
  renderBgmList();
  updateAddBgmButtonState();

  state.guestMessages = (data.guestMessages || []).map((g) => ({
    id: state.nextGuestMessageId++,
    name: g.name || "",
    group: g.group || "",
    message: g.message || "",
  }));
  renderGuestMessageList();

  updateDurationEstimate();
}

// スマホのブラウザ標準の共有シート(Web Share API)経由でLINEなどに動画ファイルを
// 直接渡せるようにする。サーバーには一切アップロードしない。対応していない
// ブラウザ（多くのデスクトップブラウザ含む）では共有ボタン自体を表示しない。
function updateShareButton(blob, filename, btnEl, hintEl) {
  // 一部のブラウザは "video/webm;codecs=vp9,opus" のようにcodecs付きのtypeだと
  // canShareがfalseを返すことがあるため、共有判定・共有自体は素のMIMEタイプで行う。
  const file = new File([blob], filename, { type: baseMimeType(blob.type) });
  const supported = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));

  if (!supported) {
    btnEl.classList.add("hidden");
    hintEl.textContent =
      "この端末・ブラウザでは直接共有できません。「ダウンロード」または「新しいタブで開く」から動画を保存し、" +
      "LINEアプリの「+」やアルバムから送信してください。LINEなどアプリ内のブラウザで開いている場合は、" +
      "Safari／Chromeで開き直すと使えるようになることがあります。";
    hintEl.classList.remove("hidden");
    return;
  }

  btnEl.classList.remove("hidden");
  hintEl.classList.add("hidden");
  btnEl.onclick = async () => {
    try {
      await navigator.share({ files: [file], title: "結婚式ムービー", text: "結婚式ムービー" });
    } catch (err) {
      if (err && err.name === "AbortError") return; // 共有シートをキャンセルしただけなので何もしない
      hintEl.textContent = `共有に失敗しました（${err.message || err}）。「ダウンロード」または「新しいタブで開く」から動画を保存し、LINEアプリから送信してください。`;
      hintEl.classList.remove("hidden");
    }
  };
}

els.createBtn.addEventListener("click", async () => {
  const initialSettings = getSettings();
  if (countPhotos(initialSettings) === 0) {
    alert(
      initialSettings.template === "endroll"
        ? "来賓へのメッセージを1件以上追加してください"
        : "写真・動画を1つ以上追加してください"
    );
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
    const filename = `wedding-movie-silent.${extensionForMimeType(blob.type)}`;
    els.previewVideo.src = url;
    els.formatSilentInfo.textContent = `書き出し形式: ${blob.type || "不明"}`;
    els.downloadSilent.href = url;
    els.downloadSilent.download = filename;
    els.opentabSilent.href = url;
    els.previewBox.classList.remove("hidden");
    updateShareButton(blob, filename, els.shareSilentBtn, els.shareSilentHint);
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

  let beatSyncCutDuration;
  if (els.beatSyncEnabled.checked) {
    setProgress(els.bgmProgressFill, els.bgmProgressLabel, 0, "BGMのテンポを解析中…");
    try {
      const beatInfo = await detectBeats(state.bgmFiles[0].file);
      const beatsPerCut = Number(els.beatSyncInterval.value) || 2;
      beatSyncCutDuration = beatInfo.beatInterval * beatsPerCut;
      if (!beatInfo.confident) {
        alert("BGMのテンポを自動検出できなかったため、124BPM相当を仮定して調整します（曲によってはズレる場合があります）");
      }
    } catch (err) {
      alert(`BGMのテンポ解析に失敗したため、通常の設定で書き出します: ${err.message || err}`);
    }
  }

  setProgress(els.bgmProgressFill, els.bgmProgressLabel, 0, "BGMを合成中…");

  try {
    const blob = await renderVideo({
      audioFiles: state.bgmFiles.map((track) => track.file),
      beatSyncCutDuration,
      onProgress: (ratio) =>
        setProgress(els.bgmProgressFill, els.bgmProgressLabel, ratio, `BGMを合成中… ${Math.round(ratio * 100)}%`),
    });
    const url = URL.createObjectURL(blob);
    const filename = `wedding-movie.${extensionForMimeType(blob.type)}`;
    els.finalVideo.src = url;
    els.formatFinalInfo.textContent = `書き出し形式: ${blob.type || "不明"}`;
    els.downloadFinal.href = url;
    els.downloadFinal.download = filename;
    els.opentabFinal.href = url;
    els.finalBox.classList.remove("hidden");
    updateShareButton(blob, filename, els.shareFinalBtn, els.shareFinalHint);
    await fixVideoDuration(els.finalVideo);
    setProgress(els.bgmProgressFill, els.bgmProgressLabel, 1, "完成しました");
  } catch (err) {
    alert(`BGM付き書き出しに失敗しました: ${err.message || err}`);
    els.bgmProgressBox.classList.add("hidden");
  } finally {
    updateAddBgmButtonState();
  }
});

// --- 下書きUIの配線 ---

if (!window.indexedDB) {
  els.draftSection.classList.add("hidden");
} else {
  els.saveDraftBtn.addEventListener("click", async () => {
    els.saveDraftBtn.disabled = true;
    els.draftStatus.textContent = "保存中…";
    try {
      const data = collectDraftData();
      await saveDraftToDB(data);
      els.draftStatus.textContent = `保存しました（${new Date(data.savedAt).toLocaleString("ja-JP")}）`;
      els.deleteDraftBtn.classList.remove("hidden");
    } catch (err) {
      els.draftStatus.textContent = `保存に失敗しました: ${err.message || err}`;
    } finally {
      els.saveDraftBtn.disabled = false;
    }
  });

  els.deleteDraftBtn.addEventListener("click", async () => {
    if (!confirm("保存した下書きを削除しますか？")) return;
    try {
      await deleteDraftFromDB();
      els.draftStatus.textContent = "下書きを削除しました";
      els.deleteDraftBtn.classList.add("hidden");
      els.draftRestoreBox.classList.add("hidden");
    } catch (err) {
      els.draftStatus.textContent = `削除に失敗しました: ${err.message || err}`;
    }
  });

  els.restoreDraftBtn.addEventListener("click", async () => {
    if (!confirm("現在の内容を上書きして、保存した下書きを復元しますか？")) return;
    els.restoreDraftBtn.disabled = true;
    els.draftStatus.textContent = "復元中…";
    try {
      const data = await loadDraftFromDB();
      if (!data) {
        els.draftStatus.textContent = "下書きが見つかりませんでした";
        return;
      }
      await restoreDraftData(data);
      els.draftStatus.textContent = "下書きを復元しました";
    } catch (err) {
      els.draftStatus.textContent = `復元に失敗しました: ${err.message || err}`;
    } finally {
      els.restoreDraftBtn.disabled = false;
    }
  });

  (async () => {
    try {
      const data = await loadDraftFromDB();
      if (data) {
        els.draftRestoreBox.classList.remove("hidden");
        els.draftSavedAt.textContent = new Date(data.savedAt).toLocaleString("ja-JP");
        els.deleteDraftBtn.classList.remove("hidden");
      }
    } catch (err) {
      // IndexedDBが使えない/壊れている環境では下書き機能を静かに諦める
    }
  })();
}

updateDurationEstimate();
