(function () {
  "use strict";

  const RETIRED_TRAINING_DATABASE_NAME = "hariai-training-v6";
  const RETIRED_TRAINING_STORAGE_KEYS = Object.freeze([
    "hariai-training-v6-safety",
  ]);

  function purgeRetiredTrainingLocalData() {
    try {
      RETIRED_TRAINING_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Storage can be unavailable in privacy modes; retirement must still continue.
    }
    try {
      globalThis.indexedDB?.deleteDatabase?.(RETIRED_TRAINING_DATABASE_NAME);
    } catch {
      // A stale tab can temporarily block deletion. A later page load retries it.
    }
  }

  purgeRetiredTrainingLocalData();

  const MAX_ROUNDS = 5;
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_IMAGE_SIDE = 1600;
  const PROFILE_AVATAR_SIDE = 256;
  const PROFILE_AVATAR_DB_NAME = "hariai-stadium-profile-v1";
  const PROFILE_AVATAR_STORE_NAME = "assets";
  const PROFILE_AVATAR_RECORD_KEY = "profile-avatar";
  const GAME_AUDIO_MAX_SECONDS = 10;
  const GAME_AUDIO_SAMPLE_RATE = 22_050;
  const GAME_AUDIO_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  const GAME_AUDIO_MAX_OUTPUT_BYTES = 480 * 1024;
  const OFFICIAL_GAME_URL = "https://gazostadium.anjugames.workers.dev/";
  const FREE_TABLE_INVITE_QUERY_KEY = "freeTableInvite";
  const OVERALL_RATING_CLASSES = Object.freeze([
    { key: "beginner", label: "Beginner", emblem: "◇", min: 100, max: 1024, range: "100–1024" },
    { key: "great", label: "Great", emblem: "✦", min: 1025, max: 1049, range: "1025–1049" },
    { key: "expert", label: "Expert", emblem: "◆", min: 1050, max: 1099, range: "1050–1099" },
    { key: "veteran", label: "Veteran", emblem: "✧", min: 1100, max: 1149, range: "1100–1149" },
    { key: "ultra", label: "Ultra", emblem: "★", min: 1150, max: 1199, range: "1150–1199" },
    { key: "master", label: "Master", emblem: "♛", min: 1200, max: 1299, range: "1200–1299" },
    { key: "legend", label: "Legend", emblem: "♛", min: 1300, max: 3000, range: "1300+" },
  ]);
  const BEYOND_RATING_CLASS = Object.freeze({
    key: "beyond",
    label: "BEYOND",
    emblem: "✺",
    min: 1400,
    max: 3000,
    range: "1400+ / 月間TOP10",
  });
  const CROWN_SIGNATURES = Object.freeze({
    upset: Object.freeze({ label: "番狂わせ", icon: "⚡", description: "期待勝率25％以下の相手に勝利" }),
    triple_unbeaten: Object.freeze({ label: "三戦無敗", icon: "✦", description: "三戦証明を無敗で完走" }),
    dual_mode: Object.freeze({ label: "両門踏破", icon: "◆", description: "通常型と戦略型の両方で証明" }),
    daily_champion: Object.freeze({ label: "デイリー王者", icon: "♛", description: "その日の第1王座を獲得" }),
    weekly_champion: Object.freeze({ label: "週間王者", icon: "♛", description: "週間王座サーキット1位" }),
    monthly_champion: Object.freeze({ label: "月間王者", icon: "✺", description: "月間王座サーキット1位" }),
  });
  const CROWN_THEMES = Object.freeze({
    rose: "ローズ",
    aqua: "アクア",
    violet: "バイオレット",
    gold: "ゴールド",
  });
  const CROWN_CIRCUIT_START_LABEL = "2026年7月28日";
  const CREATOR_CARD_TYPES = Object.freeze({
    illustration: Object.freeze({ label: "イラスト", icon: "✦" }),
    photo: Object.freeze({ label: "写真", icon: "▣" }),
    both: Object.freeze({ label: "イラスト・写真", icon: "◆" }),
    community: Object.freeze({ label: "対戦・交流", icon: "♡" }),
  });
  const CREATOR_CARD_THEMES = new Set([
    "basic-rose",
    "basic-aqua",
    "basic-violet",
    "basic-sunset",
    "premium-hologram",
    "premium-stardust",
    "premium-royal",
  ]);
  const CREATOR_CARD_GROWTH_LABELS = Object.freeze([
    "はじまり",
    "一枚目",
    "いつもの一枚",
    "育った一枚",
    "自分だけの名刺",
  ]);

  const app = document.querySelector("#app");
  const toast = document.querySelector("#toast");
  const destroyDialog = document.querySelector("#destroyDialog");
  const audioStudioDialog = document.querySelector("#audioStudioDialog");
  const ANJU_PAY_UNIT_NOTICE_KEY = "hariai-anju-pay-unit-notice-v1";
  let toastTimer = null;
  let currentScreen = "landing";
  let expandedRankingEntryId = "";
  let rankingComments = [];
  let rankingCommentsStatus = "idle";
  let rankingCommentsError = "";
  let rankingCommentIdentity = null;
  let rankingCommentIdentityStatus = "idle";
  let rankingPeriod = "weekly";
  let rankingDisplayedPeriodKey = "";
  let pendingRankingJump = "";
  let landingTopMessageIndex = 0;
  let landingTopMessagePaused = false;
  let profileAvatarReadyPromise = null;
  let pendingValueMarketDestination = "";
  let valueMarketReadyListenerPending = false;
  let pendingFleaMarketDestination = "";
  let fleaMarketReadyListenerPending = false;
  let pendingFreeTableIntent = "";
  let freeTableReadyListenerPending = false;
  let freeTableLaunchGeneration = 0;
  const profileAvatarState = { ready: false, blob: null, url: "" };
  const audioStudioState = {
    recorder: null,
    stream: null,
    chunks: [],
    timerId: null,
    timeoutId: null,
    startedAt: 0,
    discardRecording: false,
    processing: false,
    generation: 0,
    output: null,
  };

  const sampleThemes = [
    ["#142a25", "#66d18f", "#f4c96b"],
    ["#27203b", "#aa83ff", "#64e8d5"],
    ["#352119", "#ff8a5b", "#f5d48b"],
    ["#12273c", "#65c8ff", "#96efc0"],
    ["#2e1b2b", "#f27cab", "#e5e789"],
  ];

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function writeAscii(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  }

  function encodeMonoWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  async function processGameAudioFile(file, options = {}) {
    const maxSeconds = Math.min(GAME_AUDIO_MAX_SECONDS, Math.max(0.15, Number(options.maxSeconds || GAME_AUDIO_MAX_SECONDS)));
    const sampleRate = Math.max(8_000, Math.floor(Number(options.sampleRate || GAME_AUDIO_SAMPLE_RATE)));
    const maxSourceBytes = Math.max(1, Number(options.maxSourceBytes || GAME_AUDIO_MAX_SOURCE_BYTES));
    const maxOutputBytes = Math.max(1, Number(options.maxOutputBytes || GAME_AUDIO_MAX_OUTPUT_BYTES));
    if (!file || typeof file.arrayBuffer !== "function" || (file.type && !file.type.startsWith("audio/"))) throw new Error("音声ファイルを選択してください。");
    if (file.size > maxSourceBytes) throw new Error(`元の音声ファイルは${Math.round(maxSourceBytes / 1024 / 1024)}MB以下にしてください。`);
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioContextClass || !OfflineContextClass) throw new Error("このブラウザは音声変換に対応していません。");
    const context = new AudioContextClass();
    try {
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const sourceDuration = Number(decoded.duration || 0);
      const duration = Math.min(maxSeconds, sourceDuration);
      if (!Number.isFinite(duration) || duration < 0.15) throw new Error("0.15秒以上の音声を選択してください。");
      const frameCount = Math.max(1, Math.ceil(duration * sampleRate));
      const offline = new OfflineContextClass(1, frameCount, sampleRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0, 0, duration);
      const rendered = await offline.startRendering();
      const samples = new Float32Array(rendered.getChannelData(0));
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      const gain = peak > 0 ? Math.min(4, 0.92 / peak) : 1;
      if (gain !== 1) for (let index = 0; index < samples.length; index += 1) samples[index] *= gain;
      const audioBlob = encodeMonoWav(samples, sampleRate);
      if (audioBlob.size > maxOutputBytes) throw new Error("変換後の音声サイズがゲームの上限を超えました。");
      return {
        audioBlob,
        audioUrl: URL.createObjectURL(audioBlob),
        audioDuration: rendered.duration,
        audioCueStart: 0,
        audioName: String(options.audioName || file.name || "10秒音声").slice(0, 80),
        sourceDuration,
        sourceBytes: Number(file.size || 0),
        truncated: sourceDuration > maxSeconds + 0.01,
      };
    } finally {
      await context.close().catch(() => {});
    }
  }

  function formatFileSize(bytes) {
    const size = Math.max(0, Number(bytes || 0));
    if (size < 1024) return `${Math.round(size)} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function gameAudioDownloadName() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `hariai-audio-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.wav`;
  }

  function setAudioStudioStatus(message, tone = "") {
    const status = document.querySelector("#audioStudioStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function updateAudioStudioTimer(elapsedSeconds = 0) {
    const elapsed = Math.min(GAME_AUDIO_MAX_SECONDS, Math.max(0, Number(elapsedSeconds || 0)));
    const timer = document.querySelector("#audioStudioTimer");
    const progress = document.querySelector("#audioStudioProgress");
    if (timer) timer.textContent = elapsed.toFixed(1);
    if (progress) progress.style.width = `${(elapsed / GAME_AUDIO_MAX_SECONDS) * 100}%`;
  }

  function updateAudioStudioControls() {
    const recording = audioStudioState.recorder?.state === "recording";
    const busy = recording || audioStudioState.processing;
    const record = document.querySelector("#audioStudioRecord");
    const stop = document.querySelector("#audioStudioStop");
    const file = document.querySelector("#audioStudioFile");
    const reset = document.querySelector("#audioStudioReset");
    if (record) {
      record.disabled = busy || !navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window);
      record.textContent = recording ? "● 録音中…" : "● 録音を開始";
    }
    if (stop) stop.disabled = !recording;
    if (file) file.disabled = busy;
    if (reset) reset.disabled = busy;
  }

  function clearAudioStudioRecordingTimers() {
    window.clearInterval(audioStudioState.timerId);
    window.clearTimeout(audioStudioState.timeoutId);
    audioStudioState.timerId = null;
    audioStudioState.timeoutId = null;
  }

  function releaseAudioStudioStream() {
    audioStudioState.stream?.getTracks?.().forEach((track) => track.stop());
    audioStudioState.stream = null;
  }

  function releaseAudioStudioOutput() {
    if (audioStudioState.output?.audioUrl) URL.revokeObjectURL(audioStudioState.output.audioUrl);
    audioStudioState.output = null;
    const preview = document.querySelector("#audioStudioPreview");
    if (preview) {
      preview.pause();
      preview.removeAttribute("src");
      preview.load();
    }
  }

  function showAudioStudioResult(result) {
    releaseAudioStudioOutput();
    audioStudioState.output = result;
    const section = document.querySelector("#audioStudioResult");
    const preview = document.querySelector("#audioStudioPreview");
    const download = document.querySelector("#audioStudioDownload");
    const duration = document.querySelector("#audioStudioDuration");
    const sourceSize = document.querySelector("#audioStudioSourceSize");
    const outputSize = document.querySelector("#audioStudioOutputSize");
    if (section) section.hidden = false;
    if (preview) {
      preview.src = result.audioUrl;
      preview.load();
    }
    if (download) {
      download.href = result.audioUrl;
      download.download = gameAudioDownloadName();
    }
    if (duration) duration.textContent = `${Number(result.audioDuration || 0).toFixed(1)}秒${result.truncated ? "（先頭10秒）" : ""}`;
    if (sourceSize) sourceSize.textContent = formatFileSize(result.sourceBytes);
    if (outputSize) outputSize.textContent = formatFileSize(result.audioBlob?.size);
    setAudioStudioStatus("ゲーム用WAVへの変換が完了しました。試聴して保存できます。", "success");
    updateAudioStudioTimer(result.audioDuration);
  }

  function resetAudioStudio() {
    audioStudioState.generation += 1;
    releaseAudioStudioOutput();
    const result = document.querySelector("#audioStudioResult");
    const file = document.querySelector("#audioStudioFile");
    if (result) result.hidden = true;
    if (file) file.value = "";
    updateAudioStudioTimer(0);
    setAudioStudioStatus("録音するか、音声ファイルを選んでください。");
    updateAudioStudioControls();
  }

  async function convertAudioForStudio(file, generation = ++audioStudioState.generation) {
    audioStudioState.processing = true;
    updateAudioStudioControls();
    setAudioStudioStatus("先頭10秒をゲーム用の音質・容量へ変換しています…", "working");
    try {
      const result = await processGameAudioFile(file, { audioName: file?.name || "マイク録音" });
      if (generation !== audioStudioState.generation) {
        URL.revokeObjectURL(result.audioUrl);
        return;
      }
      showAudioStudioResult(result);
    } catch (error) {
      if (generation === audioStudioState.generation) setAudioStudioStatus(error?.message || "音声を変換できませんでした。", "error");
    } finally {
      audioStudioState.processing = false;
      updateAudioStudioControls();
    }
  }

  function stopAudioStudioRecording({ discard = false } = {}) {
    if (discard) {
      audioStudioState.discardRecording = true;
      audioStudioState.generation += 1;
    }
    clearAudioStudioRecordingTimers();
    if (audioStudioState.recorder?.state === "recording") {
      audioStudioState.recorder.stop();
    } else {
      releaseAudioStudioStream();
      audioStudioState.recorder = null;
      updateAudioStudioControls();
    }
  }

  function preferredRecordingMimeType() {
    if (!("MediaRecorder" in window) || typeof MediaRecorder.isTypeSupported !== "function") return "";
    return [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  async function startAudioStudioRecording() {
    if (audioStudioState.recorder?.state === "recording" || audioStudioState.processing) return;
    if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
      setAudioStudioStatus("このブラウザはマイク録音に対応していません。音声ファイルからの変換を利用してください。", "error");
      return;
    }
    const generation = ++audioStudioState.generation;
    audioStudioState.discardRecording = false;
    setAudioStudioStatus("マイクの使用許可を確認しています…", "working");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (generation !== audioStudioState.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = preferredRecordingMimeType();
      let recorder;
      try {
        recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: 64_000,
        });
      } catch {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      }
      audioStudioState.stream = stream;
      audioStudioState.recorder = recorder;
      audioStudioState.chunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) audioStudioState.chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        const chunks = audioStudioState.chunks.splice(0);
        const discard = audioStudioState.discardRecording || generation !== audioStudioState.generation;
        const type = recorder.mimeType || mimeType || chunks[0]?.type || "audio/webm";
        clearAudioStudioRecordingTimers();
        releaseAudioStudioStream();
        audioStudioState.recorder = null;
        audioStudioState.discardRecording = false;
        updateAudioStudioControls();
        if (discard || !chunks.length) return;
        const blob = new Blob(chunks, { type });
        convertAudioForStudio(blob, generation);
      }, { once: true });
      recorder.addEventListener("error", () => {
        setAudioStudioStatus("録音中にエラーが発生しました。", "error");
        stopAudioStudioRecording({ discard: true });
      }, { once: true });
      recorder.start(250);
      audioStudioState.startedAt = performance.now();
      updateAudioStudioTimer(0);
      setAudioStudioStatus("録音中です。10秒で自動停止します。", "recording");
      updateAudioStudioControls();
      audioStudioState.timerId = window.setInterval(() => {
        updateAudioStudioTimer((performance.now() - audioStudioState.startedAt) / 1000);
      }, 50);
      audioStudioState.timeoutId = window.setTimeout(() => stopAudioStudioRecording(), GAME_AUDIO_MAX_SECONDS * 1000);
    } catch (error) {
      releaseAudioStudioStream();
      audioStudioState.recorder = null;
      const message = error?.name === "NotAllowedError"
        ? "マイクの使用が許可されませんでした。ブラウザの権限を確認してください。"
        : error?.name === "NotFoundError"
          ? "利用できるマイクが見つかりませんでした。"
          : "マイク録音を開始できませんでした。";
      setAudioStudioStatus(message, "error");
      updateAudioStudioControls();
    }
  }

  function openAudioStudio() {
    if (!audioStudioDialog) return;
    updateAudioStudioControls();
    if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
      setAudioStudioStatus("このブラウザでは録音できませんが、音声ファイルの変換は利用できます。");
    }
    if (!audioStudioDialog.open) audioStudioDialog.showModal();
  }

  function bindAudioStudioEvents() {
    document.querySelector("#audioStudioRecord")?.addEventListener("click", startAudioStudioRecording);
    document.querySelector("#audioStudioStop")?.addEventListener("click", () => stopAudioStudioRecording());
    document.querySelector("#audioStudioReset")?.addEventListener("click", resetAudioStudio);
    document.querySelector("#audioStudioFile")?.addEventListener("change", (event) => {
      const file = event.currentTarget.files?.[0];
      if (file) convertAudioForStudio(file);
      event.currentTarget.value = "";
    });
    audioStudioDialog?.addEventListener("close", () => stopAudioStudioRecording({ discard: true }));
  }

  function normalizeResultShareLine(value, maxLength = 48) {
    const normalized = String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    return [...normalized].slice(0, maxLength).join("");
  }

  function buildResultShareText({ mode = "オンライン対戦", result = "-", details = [] } = {}) {
    const safeMode = normalizeResultShareLine(mode, 28) || "オンライン対戦";
    const safeResult = normalizeResultShareLine(result, 20) || "-";
    const safeDetails = (Array.isArray(details) ? details : [])
      .map((detail) => normalizeResultShareLine(detail, 42))
      .filter(Boolean)
      .slice(0, 2);
    return [
      `貼り合いスタジアム｜${safeMode}`,
      "",
      `RESULT：${safeResult}`,
      ...safeDetails,
      "",
      "#貼り合いスタジアム",
      OFFICIAL_GAME_URL,
    ].join("\n");
  }

  function createXResultPostUrl(resultDetails) {
    const intentUrl = new URL("https://x.com/intent/tweet");
    intentUrl.searchParams.set("text", buildResultShareText(resultDetails));
    intentUrl.searchParams.set("lang", "ja");
    return intentUrl.toString();
  }

  function renderResultShareButton(resultDetails) {
    return `<a class="button button-x-share" href="${escapeHtml(createXResultPostUrl(resultDetails))}" target="_blank" rel="noopener noreferrer" title="投稿内容はXで確認・編集できます"><span class="x-share-mark" aria-hidden="true">X</span><span>Xで結果をポスト</span></a>`;
  }

  function normalizeOverallRating(value) {
    const rating = Number(value);
    return Math.min(3000, Math.max(100, Math.round(Number.isFinite(rating) ? rating : 1000)));
  }

  function overallRatingClass(value) {
    const rating = normalizeOverallRating(value);
    return OVERALL_RATING_CLASSES.find((ratingClass) => rating <= ratingClass.max) || OVERALL_RATING_CLASSES.at(-1);
  }

  function renderOverallRatingClassBadge(ratingClass, rating, { decorative = false, monthlyRank = 0 } = {}) {
    const beyond = ratingClass.key === BEYOND_RATING_CLASS.key;
    const accessibleAttributes = decorative
      ? 'aria-hidden="true"'
      : beyond
        ? `aria-label="BEYONDクラス、月間総合ランキング${monthlyRank}位、総合RATE ${normalizeOverallRating(rating)}" title="BEYONDクラス / 月間${monthlyRank}位・総合RATE ${normalizeOverallRating(rating)}"`
        : `aria-label="総合RATEクラス ${ratingClass.label}、総合RATE ${normalizeOverallRating(rating)}" title="${ratingClass.label}クラス / 総合RATE ${ratingClass.range}"`;
    return `<span class="rating-class-badge class-${ratingClass.key}" ${accessibleAttributes}>
      <span class="rating-class-emblem" aria-hidden="true">${ratingClass.emblem}</span>
      <span class="rating-class-name">${ratingClass.label}</span>
      ${beyond ? `<span class="rating-class-rank">${decorative ? "TOP 10" : `M#${monthlyRank}`}</span>` : ""}
    </span>`;
  }

  function renderOverallRatingClassGuide() {
    const classItems = [...OVERALL_RATING_CLASSES, BEYOND_RATING_CLASS].map((ratingClass) => `<li>
      ${renderOverallRatingClassBadge(ratingClass, ratingClass.min, { decorative: true })}
      <small>RATE ${ratingClass.range}</small>
    </li>`).join("");
    return `<details class="rating-class-guide">
      <summary><span><small>OVERALL RATE CLASS</small><strong>総合RATEクラス</strong></span><em>ランキング限定表示</em></summary>
      <p>基本クラスはリセットされない総合RATEで判定します。BEYONDはRATE 1400以上かつ当月マンスリー総合ランキング10位以内の間だけ有効です。クラスは対戦画面には表示されません。</p>
      <ol>${classItems}</ol>
    </details>`;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function showAnjuPayUnitNoticeOnce() {
    try {
      if (window.localStorage.getItem(ANJU_PAY_UNIT_NOTICE_KEY) === "1") return;
      window.localStorage.setItem(ANJU_PAY_UNIT_NOTICE_KEY, "1");
    } catch {
      return;
    }
    window.setTimeout(() => {
      showToast("AnjuPayの単位を「Pay」に統一しました。残高・価格・仕様は変わりません。");
    }, 700);
  }

  function setBusy(isBusy, message = "画像を準備しています…") {
    document.querySelector("#loadingOverlay")?.remove();
    if (!isBusy) return;
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="loading-overlay" id="loadingOverlay" role="status" aria-live="polite">
        <div class="loading-card"><div class="loader"></div><strong>${escapeHtml(message)}</strong></div>
      </div>`,
      );
  }

  function normalizeCreatorCardPresentation(value = {}) {
    const creatorType = CREATOR_CARD_TYPES[value.creatorType]
      ? String(value.creatorType)
      : "community";
    const legacyPremium = Number(value.schemaVersion || 0) < 2;
    const requestedTheme = String(value.cardTheme || "");
    const cardTheme = CREATOR_CARD_THEMES.has(requestedTheme)
      ? requestedTheme
      : legacyPremium ? "premium-hologram" : "basic-rose";
    const growthLevel = Math.min(5, Math.max(1, Math.floor(Number(value.growthLevel || 1))));
    const xHandle = /^[A-Za-z0-9_]{1,15}$/.test(String(value.xHandle || ""))
      ? String(value.xHandle)
      : "";
    return {
      ...value,
      schemaVersion: Number(value.schemaVersion || 0),
      name: String(value.name || "PLAYER").trim().slice(0, 16) || "PLAYER",
      text: String(value.text || "").trim().slice(0, 30),
      creatorType,
      creatorTypeLabel: CREATOR_CARD_TYPES[creatorType].label,
      creatorTypeIcon: CREATOR_CARD_TYPES[creatorType].icon,
      cardTheme,
      growthLevel,
      growthLabel: CREATOR_CARD_GROWTH_LABELS[growthLevel - 1],
      xHandle,
      achievementShowcase: window.HariaiAchievements?.normalizeIds?.(value.achievementShowcase, 3) || [],
    };
  }

  function renderCreatorCard(value, { preview = false, compact = false } = {}) {
    const card = normalizeCreatorCardPresentation(value);
    const title = card.title
      ? `<span class="community-title ${escapeHtml(card.titleClassName || "")}"><span aria-hidden="true">${escapeHtml(card.titleIcon || "◆")}</span>${escapeHtml(card.title)}</span>`
      : "";
    const badges = window.HariaiAchievements?.renderBadges?.(card.achievementShowcase) || "";
    const xContent = card.xHandle
      ? preview
        ? `<span class="creator-card-x-link is-preview"><b aria-hidden="true">X</b>@${escapeHtml(card.xHandle)}</span>`
        : `<a class="creator-card-x-link" href="https://x.com/${encodeURIComponent(card.xHandle)}" target="_blank" rel="noopener noreferrer nofollow ugc" referrerpolicy="no-referrer"><b aria-hidden="true">X</b>作品を見る&nbsp;@${escapeHtml(card.xHandle)}</a>`
      : `<span class="creator-card-x-empty">Xリンクは公開されていません</span>`;
    return `<article class="creator-card creator-card-theme-${escapeHtml(card.cardTheme)} creator-card-stage-${card.growthLevel} ${compact ? "is-compact" : ""}" aria-label="${escapeHtml(card.name)}の推しカード">
      <span class="creator-card-sheen" aria-hidden="true"></span>
      <header class="creator-card-header"><span>MY FAVORITE CARD</span><b>STAGE ${card.growthLevel}<small>${escapeHtml(card.growthLabel)}</small></b></header>
      <div class="creator-card-identity"><span class="creator-card-type"><i aria-hidden="true">${escapeHtml(card.creatorTypeIcon)}</i>${escapeHtml(card.creatorTypeLabel)}</span><strong>${escapeHtml(card.name)}</strong>${title}</div>
      <blockquote>${escapeHtml(card.text || "あなたの「好き」を、ここに。")}</blockquote>
      <div class="creator-card-achievements">${badges || '<span class="creator-card-achievement-empty">育てると実績を飾れます</span>'}</div>
      <footer>${xContent}<span class="creator-card-brand">貼り合いスタジアム</span></footer>
    </article>`;
  }

  function creatorCardShareText(value) {
    const card = normalizeCreatorCardPresentation(value);
    return [
      `貼り合いスタジアムで「${card.name}」の推しカードを育てています。`,
      card.text,
      "",
      "#貼り合いスタジアム",
      OFFICIAL_GAME_URL,
    ].filter((line, index, values) => line || (index > 0 && values[index - 1])).join("\n");
  }

  function createXCreatorCardPostUrl(value) {
    const intentUrl = new URL("https://x.com/intent/tweet");
    intentUrl.searchParams.set("text", creatorCardShareText(value));
    intentUrl.searchParams.set("lang", "ja");
    return intentUrl.toString();
  }

  function creatorCardCanvasPalette(theme) {
    const palettes = {
      "basic-rose": ["#21121c", "#ff7194", "#ffd0dc", "#70e6dd"],
      "basic-aqua": ["#0d2025", "#56dfd8", "#c9fffb", "#ff91aa"],
      "basic-violet": ["#18132a", "#a68cff", "#e1d8ff", "#68e6dc"],
      "basic-sunset": ["#281716", "#ff966d", "#ffe0b0", "#ff6f9c"],
      "premium-hologram": ["#11182b", "#75f5e7", "#fff0ff", "#ff78ad"],
      "premium-stardust": ["#0d1026", "#9188ff", "#f7e7a9", "#69e5e0"],
      "premium-royal": ["#231708", "#edc66c", "#fff3c2", "#b383ff"],
    };
    return palettes[theme] || palettes["basic-rose"];
  }

  function drawCreatorCardWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines = 2) {
    const characters = Array.from(String(text || ""));
    const lines = [];
    let line = "";
    characters.forEach((character) => {
      const candidate = `${line}${character}`;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    lines.slice(0, maxLines).forEach((entry, index) => {
      const finalLine = index === maxLines - 1 && lines.length > maxLines
        ? `${Array.from(entry).slice(0, -1).join("")}…`
        : entry;
      context.fillText(finalLine, x, y + (index * lineHeight));
    });
  }

  async function createCreatorCardPngBlob(value) {
    const card = normalizeCreatorCardPresentation(value);
    await document.fonts?.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 675;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("カード画像を作成できませんでした。");
    const [surface, accent, text, subAccent] = creatorCardCanvasPalette(card.cardTheme);
    const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, "#080b13");
    background.addColorStop(0.52, surface);
    background.addColorStop(1, "#080c14");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = 0.15 + (card.growthLevel * 0.025);
    context.fillStyle = accent;
    context.beginPath();
    context.arc(1060, 70, 310, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = subAccent;
    context.beginPath();
    context.arc(100, 650, 260, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    context.beginPath();
    context.roundRect(48, 46, 1104, 583, 42);
    context.fillStyle = "rgba(8, 10, 18, 0.82)";
    context.fill();
    context.lineWidth = 3 + card.growthLevel;
    context.strokeStyle = accent;
    context.stroke();
    if (card.cardTheme.startsWith("premium-")) {
      const foil = context.createLinearGradient(100, 80, 1100, 600);
      foil.addColorStop(0, "rgba(255,255,255,.05)");
      foil.addColorStop(0.35, `${accent}66`);
      foil.addColorStop(0.58, `${subAccent}55`);
      foil.addColorStop(1, "rgba(255,255,255,.03)");
      context.fillStyle = foil;
      context.beginPath();
      context.roundRect(65, 63, 1070, 549, 34);
      context.fill();
    }
    context.fillStyle = accent;
    context.font = "900 25px system-ui, sans-serif";
    context.letterSpacing = "4px";
    context.fillText("MY FAVORITE CARD", 96, 112);
    context.letterSpacing = "0px";
    context.textAlign = "right";
    context.fillText(`STAGE ${card.growthLevel}  ${card.growthLabel}`, 1100, 112);
    context.textAlign = "left";
    context.fillStyle = subAccent;
    context.font = "900 28px system-ui, sans-serif";
    context.fillText(`${card.creatorTypeIcon}  ${card.creatorTypeLabel}`, 96, 178);
    context.fillStyle = text;
    context.font = "950 66px system-ui, sans-serif";
    context.fillText(card.name, 96, 260);
    if (card.title) {
      context.fillStyle = accent;
      context.font = "800 24px system-ui, sans-serif";
      context.fillText(`${card.titleIcon || "◆"}  ${card.title}`, 96, 305);
    }
    context.fillStyle = "#ffffff";
    context.font = "800 42px system-ui, sans-serif";
    drawCreatorCardWrappedText(context, card.text, 96, card.title ? 370 : 350, 960, 54, 2);
    const achievementDefinitions = card.achievementShowcase
      .map((id) => window.HariaiAchievements?.byId?.get?.(id))
      .filter(Boolean);
    context.font = "800 24px system-ui, sans-serif";
    let badgeX = 96;
    achievementDefinitions.forEach((definition) => {
      const label = `${definition.icon} ${definition.name}`;
      const width = Math.min(290, context.measureText(label).width + 34);
      context.fillStyle = "rgba(255,255,255,.09)";
      context.beginPath();
      context.roundRect(badgeX, 472, width, 48, 24);
      context.fill();
      context.fillStyle = "#f4ecf2";
      context.fillText(label, badgeX + 17, 505);
      badgeX += width + 14;
    });
    context.fillStyle = card.xHandle ? accent : "#8c93a3";
    context.font = "800 26px system-ui, sans-serif";
    context.fillText(card.xHandle ? `X  @${card.xHandle}` : "Xリンクは非公開", 96, 566);
    context.textAlign = "right";
    context.fillStyle = "#aab1c0";
    context.font = "700 21px system-ui, sans-serif";
    context.fillText("貼り合いスタジアム  gazostadium.anjugames.workers.dev", 1100, 566);
    return canvasToBlob(canvas, "image/png");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function renderLandingTopMessageContent() {
    const messages = window.HariaiOnline?.getTopMessages?.() || [];
    const status = window.HariaiOnline?.getTopMessagesStatus?.() || "idle";
    const mutedCount = Number(window.HariaiOnline?.getMutedTopMessageCount?.() || 0);
    const resetMuted = mutedCount > 0
      ? `<button class="community-reset" type="button" data-top-message-reset>非表示をリセット（${mutedCount}）</button>`
      : "";
    if ((status === "idle" || status === "loading") && !messages.length) {
      return `<div class="community-message-state"><span class="community-message-spark" aria-hidden="true">♡</span><p>みんなの推しカードを読み込んでいます…</p></div>`;
    }
    if (status === "error" && !messages.length) {
      return `<div class="community-message-state"><span class="community-message-spark" aria-hidden="true">♡</span><p>推しカードを読み込めませんでした。</p><button class="community-retry" type="button" data-top-message-retry>再読み込み</button>${resetMuted}</div>`;
    }
    if (!messages.length) {
      return `<div class="community-message-state"><span class="community-message-spark" aria-hidden="true">♡</span><p>まだ公開カードはありません。あなたの「好き」を育てたカードを最初に飾ってみませんか？</p><button class="community-shop-link" type="button" data-top-message-compose>カードをつくる</button>${resetMuted}</div>`;
    }
    landingTopMessageIndex %= messages.length;
    const message = messages[landingTopMessageIndex];
    const count = messages.length > 1 ? `<span class="community-position">${landingTopMessageIndex + 1} / ${messages.length}</span>` : "";
    const navigation = messages.length > 1
      ? `<div class="community-card-navigation"><button type="button" data-top-message-prev aria-label="前の推しカード">‹</button><button type="button" data-top-message-next aria-label="次の推しカード">›</button></div>`
      : "";
    return `<div class="community-card-stage">
      ${renderCreatorCard(message, { compact: true })}
      <div class="community-message-controls"><span>${count}${navigation}</span><button type="button" data-top-message-mute="${escapeHtml(message.entryId)}" aria-label="${escapeHtml(message.name)}のカードを非表示">この人を非表示</button>${resetMuted}</div>
    </div>`;
  }

  function renderLandingTopMessagePanel() {
    return `<section class="landing-community" id="topMessagePanel" aria-label="みんなの推しカード">
      <div class="community-message-head"><div class="community-message-title"><span>PLAYER SHOWCASE</span><strong>みんなの推しカード</strong></div><div class="community-head-actions"><small>${landingTopMessagePaused ? "自動切替は停止中" : "日替わり順・10秒ごとに表示"}</small><button class="community-autoplay-toggle" type="button" data-top-message-autoplay aria-pressed="${landingTopMessagePaused}">${landingTopMessagePaused ? "自動切替を再開" : "自動切替を停止"}</button><button type="button" data-top-message-compose>自分のカードを飾る</button></div></div>
      <div id="topMessageContent">${renderLandingTopMessageContent()}</div>
    </section>`;
  }

  function renderLandingFleaPanel() {
    return `<section class="landing-flea" id="fleaMarketPanel" aria-labelledby="fleaMarketPanelTitle">
      <div class="landing-flea-mark" aria-hidden="true"><span>一日棚</span><strong>◇</strong></div>
      <div class="landing-flea-copy">
        <span class="eyebrow">ANJUPAY FLEA MARKET</span>
        <h2 id="fleaMarketPanelTitle">AnjuPayフリマ</h2>
        <p class="landing-flea-lead">ことばから、推しに出会う。</p>
        <p>イラスト・実写・衣装コーデを、画像ではなく言葉で紹介する今日だけの一日棚です。売りっ子カードから人柄を見つけることも、紹介する一品から読むこともできます。</p>
        <small>フリマの取引は、推し値市場の販売実績・ランキング・常連帳・店主評価へ加算しません。出品・売却・購入は独立したAnjuPayフリマ実績にだけ記録され、本人が選んだ解除済みの推し値市場実績は売りっ子カードへ飾れます。実物・画像データ・衣服・権利の受け渡しはありません。</small>
        <div class="landing-flea-actions"><button class="button button-primary" id="fleaMarketSellersButton" type="button">今日の売りっ子を見る</button><button class="button button-ghost" id="fleaMarketBrowseButton" type="button">一品から見る</button><button class="button button-ghost" id="fleaMarketSellButton" type="button">今日の一品を出す</button></div>
      </div>
    </section>`;
  }

  function bindLandingTopMessageEvents() {
    document.querySelector("[data-top-message-retry]")?.addEventListener("click", async () => {
      await window.HariaiOnline?.refreshTopMessages?.();
      updateLandingTopMessagePanel({ focusSelector: "[data-top-message-autoplay]" });
    });
    document.querySelectorAll("[data-top-message-compose]").forEach((button) => {
      button.onclick = () => openOnlineFeature("openCreatorCard");
    });
    const autoplayButton = document.querySelector("[data-top-message-autoplay]");
    if (autoplayButton) {
      autoplayButton.onclick = () => {
        landingTopMessagePaused = !landingTopMessagePaused;
        autoplayButton.setAttribute("aria-pressed", String(landingTopMessagePaused));
        autoplayButton.textContent = landingTopMessagePaused ? "自動切替を再開" : "自動切替を停止";
        const status = autoplayButton.parentElement?.querySelector("small");
        if (status) status.textContent = landingTopMessagePaused ? "自動切替は停止中" : "日替わり順・10秒ごとに表示";
      };
    }
    document.querySelector("[data-top-message-mute]")?.addEventListener("click", (event) => {
      landingTopMessageIndex = 0;
      window.HariaiOnline?.muteTopMessage?.(event.currentTarget.dataset.topMessageMute);
      updateLandingTopMessagePanel({ focusSelector: "[data-top-message-autoplay]" });
      showToast("このプレイヤーの推しカードをこの端末で非表示にしました。");
    });
    document.querySelector("[data-top-message-prev]")?.addEventListener("click", () => {
      const messages = window.HariaiOnline?.getTopMessages?.() || [];
      if (!messages.length) return;
      landingTopMessageIndex = (landingTopMessageIndex - 1 + messages.length) % messages.length;
      updateLandingTopMessagePanel({ focusSelector: "[data-top-message-prev]" });
    });
    document.querySelector("[data-top-message-next]")?.addEventListener("click", () => {
      const messages = window.HariaiOnline?.getTopMessages?.() || [];
      if (!messages.length) return;
      landingTopMessageIndex = (landingTopMessageIndex + 1) % messages.length;
      updateLandingTopMessagePanel({ focusSelector: "[data-top-message-next]" });
    });
    document.querySelector("[data-top-message-reset]")?.addEventListener("click", () => {
      landingTopMessageIndex = 0;
      window.HariaiOnline?.clearMutedTopMessages?.();
      updateLandingTopMessagePanel({ focusSelector: "[data-top-message-autoplay]" });
      showToast("推しカードの非表示設定をリセットしました。");
    });
  }

  function updateLandingTopMessagePanel({ focusSelector = "" } = {}) {
    const content = document.querySelector("#topMessageContent");
    if (!content) return;
    content.innerHTML = renderLandingTopMessageContent();
    bindLandingTopMessageEvents();
    if (focusSelector) document.querySelector(focusSelector)?.focus();
  }

  function freeTableLampPresentation(value) {
    const welcomingRooms = Number.isInteger(value?.welcomingRooms)
      && value.welcomingRooms > 0
      ? value.welcomingRooms
      : 0;
    if (!welcomingRooms) {
      return {
        lit: false,
        welcomingRooms: 0,
        eyebrow: "勝ち負けを置いて、ひと休み",
        label: "貼り合い自由卓",
      };
    }
    return {
      lit: true,
      welcomingRooms,
      eyebrow: `◌ いま、${welcomingRooms}卓に灯りがついています`,
      label: "お迎え中の一席をのぞく",
    };
  }

  function updateLandingFreeTableEntrance() {
    if (currentScreen !== "landing") return;
    const freeTableStats = window.HariaiOnline?.getLobbyStats?.().freeTable || {};
    const presentation = freeTableLampPresentation(freeTableStats);
    const button = document.querySelector("#freeTableButton");
    const statusButton = document.querySelector("#freeTableStatusButton");
    if (button) {
      const eyebrow = button.querySelector("small");
      const label = button.querySelector("span");
      if (eyebrow) eyebrow.textContent = presentation.eyebrow;
      if (label) label.textContent = presentation.label;
      button.dataset.freeTableIntent = presentation.lit ? "lamp" : "hall";
      button.classList.toggle("is-lit", presentation.lit);
      button.setAttribute(
        "aria-label",
        presentation.lit
          ? `貼り合い自由卓。いま${presentation.welcomingRooms}卓がお迎え中です。部屋札をのぞく`
          : "貼り合い自由卓を開く",
      );
    }
    if (statusButton) {
      if (!presentation.lit && document.activeElement === statusButton) {
        button?.focus({ preventScroll: true });
      }
      statusButton.hidden = !presentation.lit;
      statusButton.textContent = presentation.lit
        ? `◌ お迎え中の${presentation.welcomingRooms}卓を見る`
        : "";
      statusButton.setAttribute(
        "aria-label",
        presentation.lit
          ? `貼り合い自由卓のお迎え中${presentation.welcomingRooms}卓を見る`
          : "貼り合い自由卓を開く",
      );
    }
  }

  function aiTextTrainingRecentWindowLabel(value) {
    const recentWindowMs = Number(value);
    if (!Number.isFinite(recentWindowMs) || recentWindowMs <= 0) return "少し前にも";
    const minutes = Math.max(1, Math.round(recentWindowMs / 60_000));
    if (minutes === 60) return "この1時間にも";
    if (minutes > 60 && minutes % 60 === 0) return `この${minutes / 60}時間にも`;
    return `この${minutes}分にも`;
  }

  function aiTextTrainingLightsPresentation(value) {
    const activeCount = Number.isInteger(value?.activeCount) && value.activeCount >= 0
      ? value.activeCount
      : null;
    if (activeCount === null) {
      return {
        state: "checking",
        activeCount: null,
        heading: "仲間の気配を確認しています…",
        detail: "確認中でも、自分のペースですぐに始められます。",
        ariaLabel: "文字コラジムの灯り。仲間の気配を確認しています。",
      };
    }
    if (activeCount > 0) {
      return {
        state: "active",
        activeCount,
        heading: `いま${activeCount}人が、それぞれの場所でトレーニング中`,
        detail: "あなたも、自分のペースでこの輪に加われます",
        ariaLabel: `文字コラジムの灯り。いま${activeCount}人が、それぞれの場所でトレーニング中です。`,
      };
    }
    if (value?.hasRecentActivity === true) {
      return {
        state: "recent",
        activeCount: 0,
        heading: "いまは静かな時間です。",
        detail: `${aiTextTrainingRecentWindowLabel(value.recentWindowMs)}、誰かのトレーニングの灯りがありました`,
        ariaLabel: "文字コラジムの灯り。いまは静かですが、少し前に仲間の灯りがありました。",
      };
    }
    return {
      state: "quiet",
      activeCount: 0,
      heading: "いまは静かな時間です。",
      detail: "始めると、ここに最初の灯りがともります",
      ariaLabel: "文字コラジムの灯り。始めると、ここに最初の灯りがともります。",
    };
  }

  function renderAiTextTrainingLightDots(presentation) {
    const visibleCount = presentation.state === "active"
      ? Math.min(7, Math.max(1, presentation.activeCount))
      : presentation.state === "checking"
        ? 3
        : 1;
    const dots = Array.from(
      { length: visibleCount },
      (_, index) => `<i style="--training-light-index:${index}" aria-hidden="true"></i>`,
    ).join("");
    const overflow = presentation.state === "active" && presentation.activeCount > visibleCount
      ? `<b aria-hidden="true">+${presentation.activeCount - visibleCount}</b>`
      : "";
    return `${dots}${overflow}`;
  }

  function updateAiTextTrainingLightDots(element, presentation) {
    if (!element) return;
    const visibleCount = presentation.state === "active"
      ? Math.min(7, Math.max(1, presentation.activeCount))
      : presentation.state === "checking"
        ? 3
        : 1;
    const nodes = Array.from({ length: visibleCount }, (_, index) => {
      const dot = document.createElement("i");
      dot.style.setProperty("--training-light-index", String(index));
      dot.setAttribute("aria-hidden", "true");
      return dot;
    });
    if (presentation.state === "active" && presentation.activeCount > visibleCount) {
      const overflow = document.createElement("b");
      overflow.setAttribute("aria-hidden", "true");
      overflow.textContent = `+${presentation.activeCount - visibleCount}`;
      nodes.push(overflow);
    }
    element.replaceChildren(...nodes);
  }

  function renderAiTextTrainingLights(value) {
    const presentation = aiTextTrainingLightsPresentation(value);
    return `<aside class="training-lights-card is-${presentation.state}" id="aiTextTrainingLights" data-training-lights-state="${presentation.state}" aria-label="${escapeHtml(presentation.ariaLabel)}">
      <div class="training-lights-visual" aria-hidden="true"><span class="training-lights-dots" id="aiTextTrainingLightDots">${renderAiTextTrainingLightDots(presentation)}</span><small>TRAINING LIGHTS</small></div>
      <div class="training-lights-copy" aria-live="polite" aria-atomic="true"><span>文字コラジムの灯り</span><strong id="aiTextTrainingLightsHeading">${escapeHtml(presentation.heading)}</strong><p id="aiTextTrainingLightsDetail">${escapeHtml(presentation.detail)}</p><small>名前も画像も表示しない、匿名の仲間の気配です。</small></div>
      <button class="button training-lights-start" id="aiTextTrainingLightsStartButton" type="button">自分のペースで始める</button>
    </aside>`;
  }

  function updateLandingAiTextTrainingLights() {
    if (currentScreen !== "landing") return;
    const card = document.querySelector("#aiTextTrainingLights");
    if (!card) return;
    const stats = window.HariaiOnline?.getLobbyStats?.().aiTextTraining || {};
    const presentation = aiTextTrainingLightsPresentation(stats);
    card.className = `training-lights-card is-${presentation.state}`;
    card.dataset.trainingLightsState = presentation.state;
    card.setAttribute("aria-label", presentation.ariaLabel);
    const dots = document.querySelector("#aiTextTrainingLightDots");
    const heading = document.querySelector("#aiTextTrainingLightsHeading");
    const detail = document.querySelector("#aiTextTrainingLightsDetail");
    updateAiTextTrainingLightDots(dots, presentation);
    if (heading) heading.textContent = presentation.heading;
    if (detail) detail.textContent = presentation.detail;
  }

  function lobbyStatsRefreshPresentation(value = {}) {
    const available = value.available !== false;
    const cooldownRemainingMs = Math.max(0, Number(value.cooldownRemainingMs || 0));
    const lastUpdatedAt = Number(value.lastUpdatedAt || 0);
    const error = String(value.error || "");
    const formattedTime = lastUpdatedAt > 0
      ? new Intl.DateTimeFormat("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(lastUpdatedAt))
      : "";
    let message = "最初の状況を読み込んでいます…";
    if (!available) message = "プレビュー中はFirebaseへ接続しません。";
    else if (value.loading) message = "待機・対戦・開室状況を確認しています…";
    else if (error) message = formattedTime ? `${error} 表示の確認時刻 ${formattedTime}` : error;
    else if (formattedTime) message = `最終更新 ${formattedTime}（取得時点の参考値）`;
    return {
      busy: Boolean(value.loading),
      disabled: !available || Boolean(value.loading) || cooldownRemainingMs > 0,
      label: value.loading ? "最新の状況を読み込み中…" : "最新の状況を読み込む",
      message,
    };
  }

  function renderLanding() {
    const lobbyStats = window.HariaiOnline?.getLobbyStats?.() || {};
    const modeStats = (mode) => lobbyStats[mode] || { waiting: null, playing: null };
    const soloStats = modeStats("solo");
    const strategyStats = modeStats("strategy");
    const aiTextTrainingStats = lobbyStats.aiTextTraining || {};
    const freeTableStats = lobbyStats.freeTable || { welcomingRooms: null, seatedRooms: null };
    const freeTableLamp = freeTableLampPresentation(freeTableStats);
    const marketStats = lobbyStats.market || { sellerWaiting: null, buyerWaiting: null, negotiating: null };
    const lobbyRefresh = lobbyStatsRefreshPresentation(
      window.HariaiOnline?.getLobbyStatsRefreshStatus?.() || { available: true, loading: true },
    );
    const statValue = (value) => Number.isInteger(value) ? value : "--";
    return `<section class="screen hero">
      <div>
        <span class="eyebrow hero-eyebrow"><i aria-hidden="true">♥</i><span>好きな画像で、対戦もひと休みも</span><i aria-hidden="true">✦</i></span>
        <h1 aria-label="貼り合え。YOUR FAVORITE, YOUR POWER."><span class="hero-title-text">貼り合え</span><span class="hero-heart" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><defs><linearGradient id="heroHeartGradient" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse"><stop stop-color="#ff6b85"/><stop offset="0.58" stop-color="#ff4f72"/><stop offset="1" stop-color="#66e9df"/></linearGradient></defs><path d="M32 58C28.8 54.8 8.1 42.8 5.1 26.1 2.6 12.1 10.1 4 20.1 4 25.9 4 30 7 32 11c2-4 6.1-7 11.9-7 10 0 17.5 8.1 15 22.1C55.9 42.8 35.2 54.8 32 58Z" fill="url(#heroHeartGradient)"/><path d="M13.5 19.5C15.2 12.4 22.5 9.4 27.4 14" fill="none" stroke="rgba(255,255,255,.72)" stroke-linecap="round" stroke-width="3"/></svg></span><span class="hero-tagline">YOUR FAVORITE, YOUR POWER.</span></h1>
        <p class="hero-welcome"><span aria-hidden="true">♡</span><strong>はじめてでも大丈夫。</strong>あなたの「好き」が、いちばんのカードです。</p>
        <p class="hero-copy">
          好きな画像で良さを伝え合う1on1や、AnjuPayで推し値を競う市場。
          最大10枚のロスターからAIが5枚をDRAWする、ソロの「AI文字コラトレーニング」も選べます。
          疲れたら、勝敗のない「貼り合い自由卓」でひと休みできます。
        </p>
        <ul class="hero-assurances" aria-label="安心して遊べる理由">
          <li>匿名で参加</li><li>画像はサーバー保存なし</li><li>ひとりでも友達とでも</li>
        </ul>
        <div class="hero-actions">
          <button class="button button-primary hero-mode-button" id="onlineButton"><small>気軽にスタート</small><span>通常型1on1対戦</span></button>
          <button class="button button-strategy hero-mode-button" id="strategyLabButton"><small>弱点を見抜こう</small><span>戦略型1on1対戦</span></button>
          <button class="button hero-free-table-button hero-mode-button${freeTableLamp.lit ? " is-lit" : ""}" id="freeTableButton" data-free-table-intent="${freeTableLamp.lit ? "lamp" : "hall"}" aria-label="${freeTableLamp.lit ? `貼り合い自由卓。いま${freeTableLamp.welcomingRooms}卓がお迎え中です。部屋札をのぞく` : "貼り合い自由卓を開く"}"><small>${freeTableLamp.eyebrow}</small><span>${freeTableLamp.label}</span></button>
          <button class="button hero-market-button hero-mode-button" id="valueMarketButton"><small>AnjuPayで推し値を決める</small><span>推し値市場 / VALUE MARKET</span></button>
          <button class="button hero-ai-text-training-button hero-mode-button" id="aiTextTrainingButton"><small>最大10枚から5枚をDRAW。ひとりですぐ運動</small><span>AIと対戦しよう 文字コラトレーニング</span></button>
          <button class="button button-ghost hero-utility-button hero-market-ranking-button" id="valueMarketRankingButton"><span aria-hidden="true">♡</span> 推し値市場ランキング</button>
          <button class="button button-ghost hero-utility-button" id="rankingButton">オンライン総合ランキング</button>
          <button class="button button-ghost hero-utility-button" id="achievementButton">実績コレクション</button>
          <button class="button button-ghost hero-utility-button" id="dailyMissionButton">デイリーミッション</button>
          <button class="button button-ghost hero-utility-button" id="pointShopButton">AnjuPayストア</button>
          <button class="button hero-account-button hero-utility-button" id="accountButton">AnjuPayウォレット</button>
          <button class="button hero-audio-tool-button" id="audioStudioButton"><small>端末内だけで録音・変換</small><span>♪ 10秒音声をつくる</span></button>
        </div>
        ${renderAiTextTrainingLights(aiTextTrainingStats)}
        ${renderLandingTopMessagePanel()}
        ${renderLandingFleaPanel()}
        <div class="mode-lobby-stats" aria-label="モード別の参加・開室状況">
          <article class="lobby-mode-card solo"><div class="lobby-mode-head"><span>通常型1ON1</span><small>STANDARD</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbySoloWaitingCount">${statValue(soloStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbySoloPlayingCount">${statValue(soloStats.playing)}</span><em>人</em></strong></div>
          </div></article>
          <article class="lobby-mode-card strategy"><div class="lobby-mode-head"><span>戦略型1ON1</span><small>STRATEGY</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbyStrategyWaitingCount">${statValue(strategyStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbyStrategyPlayingCount">${statValue(strategyStats.playing)}</span><em>人</em></strong></div>
          </div></article>
          <article class="lobby-mode-card free-table-status"><div class="lobby-mode-head"><span>貼り合い自由卓</span><small>FREE TABLE</small></div><div class="lobby-mode-counts">
            <div><small>お迎え中</small><strong><span id="lobbyFreeTableWelcomingCount">${statValue(freeTableStats.welcomingRooms)}</span><em>卓</em></strong></div>
            <div><small>同席中</small><strong><span id="lobbyFreeTableSeatedCount">${statValue(freeTableStats.seatedRooms)}</span><em>卓</em></strong></div>
          </div><button class="button lobby-free-table-lamp-link" id="freeTableStatusButton" type="button" data-free-table-intent="lamp"${freeTableLamp.lit ? "" : " hidden"}>${freeTableLamp.lit ? `◌ お迎え中の${freeTableLamp.welcomingRooms}卓を見る` : ""}</button></article>
          <article class="lobby-mode-card market"><div class="lobby-mode-head"><span>推し値市場</span><small>VALUE MARKET</small></div><div class="lobby-mode-counts market-counts">
            <div><small>売り手待機</small><strong><span id="lobbyMarketSellerWaitingCount">${statValue(marketStats.sellerWaiting)}</span><em>人</em></strong></div>
            <div><small>買い手待機</small><strong><span id="lobbyMarketBuyerWaitingCount">${statValue(marketStats.buyerWaiting)}</span><em>人</em></strong></div>
            <div><small>商談中</small><strong><span id="lobbyMarketNegotiatingCount">${statValue(marketStats.negotiating)}</span><em>件</em></strong></div>
          </div></article>
        </div>
        <div class="lobby-stats-refresh" id="lobbyStatsRefreshPanel" aria-live="polite" aria-busy="${lobbyRefresh.busy ? "true" : "false"}">
          <button class="button button-ghost" id="lobbyStatsRefreshButton" type="button"${lobbyRefresh.disabled ? " disabled" : ""}>${escapeHtml(lobbyRefresh.label)}</button>
          <span id="lobbyStatsRefreshStatus">${escapeHtml(lobbyRefresh.message)}</span>
        </div>
        <p class="lobby-privacy">対戦人数にトップページの閲覧者は含みません。自由卓は人数ではなく、お迎え中・同席中の卓数です。推し値市場の商談中は、売り手と買い手の両方が通信中の商談件数です。推しカードは本人が公開した表示名・活動札・紹介文・称号・実績・成長段階・任意のXだけを表示し、匿名UID・勝敗・画像・ルーム情報は表示しません。</p>
        <p class="mode-note">文字コラトレーニングの候補画像（最大10枚）とDRAW結果は端末内だけで使用します。対人モードの画像・音声・短尺動画は、対戦中または自由卓の同席中だけ相手へ直接送信され、Firebaseには保存されません。</p>
      </div>
    </section>`;
  }

  function renderLandingScreen() {
    cancelPendingFreeTableLaunch();
    pendingValueMarketDestination = "";
    pendingFleaMarketDestination = "";
    currentScreen = "landing";
    expandedRankingEntryId = "";
    rankingComments = [];
    rankingCommentsStatus = "idle";
    setLandingChrome();
    app.innerHTML = renderLanding();
    window.dispatchEvent(new Event("hariai-landing-rendered"));
    document.querySelector(".screen.hero")?.addEventListener("click", (event) => {
      const control = event.target.closest?.("button, a");
      if (!control) return;
      if (!control.matches("#valueMarketButton, #valueMarketRankingButton")) pendingValueMarketDestination = "";
      if (!control.matches("#fleaMarketSellersButton, #fleaMarketBrowseButton, #fleaMarketSellButton")) pendingFleaMarketDestination = "";
      if (!control.matches("#freeTableButton, #freeTableStatusButton")) cancelPendingFreeTableLaunch();
    }, { capture: true });
    document.querySelector("#strategyLabButton")?.addEventListener("click", startStrategyLab);
    document.querySelector("#onlineButton")?.addEventListener("click", startOnlineBattle);
    document.querySelector("#aiTextTrainingButton")?.addEventListener("click", startAiTextTraining);
    document.querySelector("#aiTextTrainingLightsStartButton")?.addEventListener("click", startAiTextTraining);
    document.querySelector("#freeTableButton")?.addEventListener("click", (event) => {
      startFreeTable({ intent: event.currentTarget.dataset.freeTableIntent });
    });
    document.querySelector("#freeTableStatusButton")?.addEventListener("click", () => {
      startFreeTable({ intent: "lamp" });
    });
    document.querySelector("#valueMarketButton")?.addEventListener("click", startValueMarket);
    document.querySelector("#valueMarketRankingButton")?.addEventListener("click", startValueMarketRankings);
    document.querySelector("#fleaMarketSellersButton")?.addEventListener("click", startFleaMarketSellers);
    document.querySelector("#fleaMarketBrowseButton")?.addEventListener("click", startFleaMarketBrowse);
    document.querySelector("#fleaMarketSellButton")?.addEventListener("click", startFleaMarketSell);
    document.querySelector("#rankingButton")?.addEventListener("click", () => renderRankingScreen({ refresh: true }));
    document.querySelector("#achievementButton")?.addEventListener("click", () => openOnlineFeature("openAchievements"));
    document.querySelector("#dailyMissionButton")?.addEventListener("click", () => openOnlineFeature("openDailyMissions"));
    document.querySelector("#pointShopButton")?.addEventListener("click", () => openOnlineFeature("openPointShop"));
    document.querySelector("#accountButton")?.addEventListener("click", startAccount);
    document.querySelector("#audioStudioButton")?.addEventListener("click", openAudioStudio);
    document.querySelector("#lobbyStatsRefreshButton")?.addEventListener("click", () => {
      window.HariaiOnline?.refreshLobbyPublicStats?.().catch(() => {});
    });
    bindLandingTopMessageEvents();
    window.HariaiOnline?.refreshTopMessages?.();
    app.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rankingCommentDate(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "日時不明";
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(Number(timestamp)));
  }

  function renderRankingCommentPanel(entry) {
    const entryId = String(entry.entryId || "");
    if (entry.commentsEnabled === false) {
      return `<div class="ranking-comments-panel is-disabled"><p>このプレイヤーはコメント受付を停止しています。</p></div>`;
    }
    if (rankingCommentsStatus === "loading") {
      return `<div class="ranking-comments-panel"><p>コメントを読み込んでいます…</p></div>`;
    }
    if (rankingCommentsStatus === "error") {
      return `<div class="ranking-comments-panel"><p>${escapeHtml(rankingCommentsError || "コメントを取得できませんでした。")}</p><button class="button button-ghost button-small" data-ranking-comments-retry="${escapeHtml(entryId)}">再読み込み</button></div>`;
    }

    const identityEntryId = String(rankingCommentIdentity?.entryId || "");
    const commentItems = rankingComments.length ? rankingComments.map((comment) => {
      const canDelete = rankingCommentIdentity?.canPost
        && (identityEntryId === comment.authorEntryId || identityEntryId === entryId);
      return `<li class="ranking-comment-item">
        <div class="ranking-comment-meta"><strong>${escapeHtml(comment.authorName)}</strong><time>${escapeHtml(rankingCommentDate(comment.updatedAt))}</time></div>
        <p>${escapeHtml(comment.text)}</p>
        ${canDelete ? `<button class="ranking-comment-delete" type="button" data-ranking-comment-delete="${escapeHtml(comment.authorEntryId)}" data-ranking-comment-target="${escapeHtml(entryId)}">削除</button>` : ""}
      </li>`;
    }).join("") : `<li class="ranking-comment-empty">まだコメントはありません。</li>`;

    let composer = "";
    if (rankingCommentIdentityStatus === "loading") {
      composer = `<p class="ranking-comment-guide">投稿資格を確認しています…</p>`;
    } else if (rankingCommentIdentityStatus !== "ready") {
      composer = `<div class="ranking-comment-auth"><p>ランキング参加者は、このプレイヤーへ1件コメントできます。</p><button class="button button-ghost button-small" type="button" data-ranking-comment-auth="${escapeHtml(entryId)}">投稿資格を確認</button></div>`;
    } else if (!rankingCommentIdentity?.canPost) {
      composer = `<p class="ranking-comment-guide">コメントするには、いずれかのオンライン対戦準備画面またはランキング画面で「オンライン総合ランキングに参加する」を有効にしてください。</p>`;
    } else if (identityEntryId === entryId) {
      composer = `<p class="ranking-comment-guide">自分の欄には投稿できません。寄せられたコメントは削除できます。</p>`;
    } else {
      const ownComment = rankingComments.find((comment) => comment.authorEntryId === identityEntryId);
      composer = `<form class="ranking-comment-form" data-ranking-comment-form="${escapeHtml(entryId)}">
        <label for="rankingCommentText">${ownComment ? "自分のコメントを更新" : "このプレイヤーへコメント"}</label>
        <textarea id="rankingCommentText" maxlength="80" rows="2" required placeholder="URLを含まない1行80文字以内">${escapeHtml(ownComment?.text || "")}</textarea>
        <div><small>1人につき1件。改行とURLは使えません。</small><button class="button button-primary button-small" type="submit">${ownComment ? "更新する" : "投稿する"}</button></div>
      </form>`;
    }

    return `<div class="ranking-comments-panel" id="rankingComments-${escapeHtml(entryId)}">
      <div class="ranking-comments-head"><strong>プレイヤーコメント</strong><small>新しい順・最大20件</small></div>
      <ul class="ranking-comment-list">${commentItems}</ul>
      ${composer}
    </div>`;
  }

  async function loadRankingComments(entryId) {
    const targetId = String(entryId || "");
    rankingCommentsStatus = "loading";
    rankingCommentsError = "";
    rankingComments = [];
    renderRankingScreen({ preserveScroll: true });
    try {
      const comments = await window.HariaiOnline?.getLeaderboardComments?.(targetId);
      if (expandedRankingEntryId !== targetId) return;
      rankingComments = Array.isArray(comments) ? comments : [];
      rankingCommentsStatus = "ready";
    } catch (error) {
      if (expandedRankingEntryId !== targetId) return;
      rankingCommentsStatus = "error";
      rankingCommentsError = error?.message || "コメントを取得できませんでした。";
    }
    renderRankingScreen({ preserveScroll: true });
  }

  function toggleRankingComments(entryId) {
    const targetId = String(entryId || "");
    if (expandedRankingEntryId === targetId) {
      expandedRankingEntryId = "";
      rankingComments = [];
      rankingCommentsStatus = "idle";
      renderRankingScreen({ preserveScroll: true });
      return;
    }
    expandedRankingEntryId = targetId;
    loadRankingComments(targetId);
  }

  async function prepareRankingCommentIdentity(entryId) {
    rankingCommentIdentityStatus = "loading";
    renderRankingScreen({ preserveScroll: true });
    try {
      rankingCommentIdentity = await window.HariaiOnline?.getLeaderboardCommentIdentity?.();
      rankingCommentIdentityStatus = "ready";
    } catch (error) {
      rankingCommentIdentity = null;
      rankingCommentIdentityStatus = "idle";
      showToast(error?.message || "投稿資格を確認できませんでした。");
    }
    if (expandedRankingEntryId === entryId) renderRankingScreen({ preserveScroll: true });
  }

  async function submitRankingComment(form) {
    const targetId = String(form.dataset.rankingCommentForm || "");
    const textarea = form.querySelector("textarea");
    try {
      setBusy(true, "コメントを保存しています…");
      await window.HariaiOnline?.saveLeaderboardComment?.(targetId, textarea?.value || "");
      showToast("コメントを保存しました。");
      await loadRankingComments(targetId);
    } catch (error) {
      showToast(error?.message || "コメントを保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function removeRankingComment(targetId, authorId) {
    if (!window.confirm("このコメントを削除しますか？")) return;
    try {
      setBusy(true, "コメントを削除しています…");
      await window.HariaiOnline?.deleteLeaderboardComment?.(targetId, authorId);
      showToast("コメントを削除しました。");
      await loadRankingComments(targetId);
    } catch (error) {
      showToast(error?.message || "コメントを削除できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  function bindRankingCommentEvents() {
    document.querySelectorAll("[data-ranking-comments-toggle]").forEach((button) => {
      button.addEventListener("click", () => toggleRankingComments(button.dataset.rankingCommentsToggle));
    });
    document.querySelector("[data-ranking-comments-retry]")?.addEventListener("click", (event) => {
      loadRankingComments(event.currentTarget.dataset.rankingCommentsRetry);
    });
    document.querySelector("[data-ranking-comment-auth]")?.addEventListener("click", (event) => {
      prepareRankingCommentIdentity(event.currentTarget.dataset.rankingCommentAuth);
    });
    document.querySelector("[data-ranking-comment-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitRankingComment(event.currentTarget);
    });
    document.querySelectorAll("[data-ranking-comment-delete]").forEach((button) => {
      button.addEventListener("click", () => removeRankingComment(button.dataset.rankingCommentTarget, button.dataset.rankingCommentDelete));
    });
  }

  function rankingPeriodInfo() {
    return window.HariaiOnline?.getLeaderboardPeriodInfo?.(rankingPeriod) || {
      period: rankingPeriod,
      key: "",
      label: "期間を確認中",
      nextResetAt: 0,
      minimumMatches: rankingPeriod === "daily" ? 1 : rankingPeriod === "weekly" ? 3 : 5,
      awardMinimumMatches: rankingPeriod === "monthly" ? 10 : rankingPeriod === "weekly" ? 3 : 1,
      serverAuthoritative: false,
    };
  }

  function rankingResetLabel(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "";
    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    }).format(new Date(Number(timestamp)));
  }

  function renderRankingXLink(entry, { featured = false } = {}) {
    const xHandle = /^[A-Za-z0-9_]{1,15}$/.test(String(entry?.xHandle || ""))
      ? String(entry.xHandle)
      : "";
    if (!xHandle) return "";
    const label = featured ? `Xで見る @${xHandle}` : `X @${xHandle}`;
    return `<a class="ranking-x-link ${featured ? "is-featured" : ""}" href="https://x.com/${encodeURIComponent(xHandle)}" target="_blank" rel="noopener noreferrer nofollow ugc" referrerpolicy="no-referrer">${escapeHtml(label)}</a>`;
  }

  function crownSignaturePresentation(value) {
    return CROWN_SIGNATURES[String(value || "")] || null;
  }

  function renderCrownSignature(entry, { large = false } = {}) {
    const signature = crownSignaturePresentation(entry?.crownSignatureId);
    if (!signature) return "";
    const theme = Object.hasOwn(CROWN_THEMES, entry?.crownTheme) ? entry.crownTheme : "rose";
    return `<span class="ranking-signature crown-theme-${escapeHtml(theme)} ${large ? "is-large" : ""}" title="${escapeHtml(signature.description)}"><i aria-hidden="true">${escapeHtml(signature.icon)}</i><span><small>SIGNATURE</small>${escapeHtml(signature.label)}</span></span>`;
  }

  function renderOverallLeaderboardSection() {
    const entries = window.HariaiOnline?.getOverallLeaderboard?.() || [];
    const status = window.HariaiOnline?.getOverallLeaderboardStatus?.() || "idle";
    const dashboard = window.HariaiOnline?.getRankingDashboard?.();
    const ownEntryId = String(dashboard?.entryId || "");
    const rows = entries.length ? entries.map((entry, index) => {
      const entryId = String(entry.entryId || "");
      const expanded = expandedRankingEntryId === entryId;
      const commentsEnabled = entry.commentsEnabled !== false;
      const overallRating = normalizeOverallRating(entry.rating);
      const monthlyBeyondRank = Number(window.HariaiOnline?.getMonthlyBeyondRank?.(entryId, overallRating) || 0);
      const ratingClass = monthlyBeyondRank > 0 ? BEYOND_RATING_CLASS : overallRatingClass(overallRating);
      const ratingClassBadge = renderOverallRatingClassBadge(ratingClass, overallRating, { monthlyRank: monthlyBeyondRank });
      const achievementBadges = window.HariaiAchievements?.renderBadges?.(entry.achievementShowcase) || "";
      const activeAward = entry.rankingAwardLabel && Number(entry.rankingAwardUntil || 0) > Date.now()
        ? `<span class="ranking-award-earned">${escapeHtml(entry.rankingAwardLabel)}</span>`
        : "";
      const theme = Object.hasOwn(CROWN_THEMES, entry.crownTheme) ? entry.crownTheme : "rose";
      return `<article class="ranking-entry overall-ranking-entry ranking-class-${ratingClass.key} crown-theme-${escapeHtml(theme)} ${entryId === ownEntryId ? "is-self" : ""} ${expanded ? "is-expanded" : ""}">
        <div class="ranking-row">
          <strong class="ranking-position">#${index + 1}</strong>
          <div class="ranking-player"><b>${escapeHtml(entry.name)}</b>${renderRankingXLink(entry)}<small>${Math.max(0, Number(entry.serverMatches || 0))}戦の検証済みRATE</small>${activeAward}${renderCrownSignature(entry)}${achievementBadges}</div>
          <div class="ranking-rating"><strong>${overallRating}</strong><small>OVERALL RATE</small></div>
          <div class="ranking-record"><span>${entryId === ownEntryId ? "あなたの現在席" : `上位 ${index + 1}席`}</span><div class="ranking-overall-rate">${ratingClassBadge}</div></div>
          <button class="ranking-comment-toggle" type="button" data-ranking-comments-toggle="${escapeHtml(entryId)}" aria-expanded="${expanded}" aria-controls="rankingComments-${escapeHtml(entryId)}" ${commentsEnabled ? "" : "disabled"}>${commentsEnabled ? (expanded ? "閉じる" : "コメント") : "受付停止"}</button>
        </div>
        ${expanded ? renderRankingCommentPanel(entry) : ""}
      </article>`;
    }).join("") : status === "error"
      ? `<div class="ranking-empty">総合RATEランキングを取得できませんでした。<br /><button class="button button-ghost button-small" id="overallRankingRetryButton">もう一度取得</button></div>`
      : status === "ready"
        ? `<div class="ranking-empty">総合RATEを公開しているプレイヤーはまだいません。</div>`
        : `<div class="ranking-empty">総合RATEランキングを取得しています…</div>`;
    return `<section class="ranking-overall-section" id="rankingOverallBoard" aria-labelledby="overallRateRankingTitle">
      <div class="ranking-board-head"><div><span class="eyebrow">PERMANENT STRENGTH / TOP 10</span><h2 id="overallRateRankingTitle">総合RATEランキング</h2></div><p>期間でリセットされない、通常型・戦略型1on1の上位10席です。</p></div>
      <div class="ranking-list" aria-label="総合RATEランキング TOP10">${rows}</div>
    </section>`;
  }

  function renderRankingSpotlight() {
    const dashboard = window.HariaiOnline?.getRankingDashboard?.();
    const spotlight = dashboard?.spotlight;
    if (!spotlight || (Number(spotlight.endsAt || 0) > 0 && Number(spotlight.endsAt) <= Date.now())) return "";
    const periodLabel = spotlight.period === "monthly"
      ? "MONTHLY CHAMPION"
      : spotlight.period === "weekly"
        ? "WEEKLY CHAMPION"
        : "TODAY'S CROWN";
    const score = spotlight.period === "daily"
      ? Number(spotlight.crownPower || spotlight.rating || 1000)
      : Number(spotlight.circuitScore || 0);
    const scoreLabel = spotlight.period === "daily" ? "PROOF RATE" : "CIRCUIT SCORE";
    const earnedSignatures = (spotlight.signatureIds || []).map((id) => {
      const signature = crownSignaturePresentation(id);
      return signature
        ? `<span title="${escapeHtml(signature.description)}">${escapeHtml(signature.icon)} ${escapeHtml(signature.label)}</span>`
        : "";
    }).join("");
    const theme = Object.hasOwn(CROWN_THEMES, spotlight.crownTheme) ? spotlight.crownTheme : "rose";
    return `<section class="crown-spotlight crown-theme-${escapeHtml(theme)}" aria-labelledby="crownSpotlightTitle">
      <div class="crown-spotlight-copy"><span class="eyebrow">24H X SPOTLIGHT</span><h2 id="crownSpotlightTitle">${escapeHtml(periodLabel)} — ${escapeHtml(spotlight.name)}</h2><p>王座を証明したプレイヤーのXを、24時間だけ主役席に掲示します。</p>${earnedSignatures ? `<div class="crown-proof-signatures">${earnedSignatures}</div>` : ""}</div>
      <div class="crown-spotlight-score"><strong>${score}</strong><small>${escapeHtml(scoreLabel)}</small>${renderCrownSignature(spotlight, { large: true })}</div>
      ${renderRankingXLink(spotlight, { featured: true })}
    </section>`;
  }

  function renderCrownRunPanel(dashboard) {
    const statusState = window.HariaiOnline?.getRankingDashboardStatus?.() || { status: "idle", busy: false };
    const dailyInfo = window.HariaiOnline?.getLeaderboardPeriodInfo?.("daily") || {};
    const run = dashboard?.run || null;
    const enabled = dashboard?.enabled === true;
    const count = Math.min(3, Math.max(0, Number(run?.matchCount || 0)));
    const runStatus = run?.status || "idle";
    const complete = runStatus === "complete" || runStatus === "finalized";
    const active = runStatus === "active";
    const crownPower = Number(run?.crownPower || dashboard?.overall?.rating || 1000);
    const startRating = Number(run?.ratingAtStart || dashboard?.overall?.rating || 1000);
    const progress = Math.round((count / 3) * 100);
    let action = "";
    let statusCopy = "好きな時間に開始し、その後の検証済み3試合だけで今日の席を決めます。";
    if (!dailyInfo.crownCircuit) {
      statusCopy = `三戦証明は${escapeHtml(CROWN_CIRCUIT_START_LABEL)}から始まります。`;
      action = `<button class="button button-primary" type="button" disabled>開始前です</button>`;
    } else if (!enabled) {
      statusCopy = "ランキング参加を有効にすると、今日の三戦証明を始められます。";
      action = `<button class="button button-primary" type="button" disabled>ランキング参加後に挑む</button>`;
    } else if (!run || runStatus === "idle" || runStatus === "expired") {
      action = `<button class="button button-primary" id="crownRunStartButton" type="button" ${statusState.busy ? "disabled" : ""}>今日の三戦証明を始める</button>`;
    } else if (active) {
      statusCopy = `次の正式対戦が${count + 1}戦目です。同じ相手は1日2戦まで。NO CONTESTは消費しません。`;
      action = `<div class="crown-run-mode-actions"><button class="button button-primary" id="crownRunSoloButton" type="button">通常型1on1へ</button><button class="button button-strategy" id="crownRunStrategyButton" type="button">戦略型1on1へ</button></div>`;
    } else if (complete) {
      const seat = Number(run.rank || 0) > 0 ? ` / 暫定 第${Number(run.rank)}王座` : "";
      statusCopy = `今日の証明RATE ${crownPower}${seat}。4戦目以降は今日の王座へ影響しません。`;
      action = `<div class="crown-run-complete"><strong>PROOF COMPLETE</strong><span>${run.spotlightEligible ? "Xスポットライト条件を満たしています" : "順位記録は有効です"}</span></div>`;
    }
    const earned = (run?.signatureIds || []).map((id) => {
      const signature = crownSignaturePresentation(id);
      return signature ? `<span title="${escapeHtml(signature.description)}">${escapeHtml(signature.icon)} ${escapeHtml(signature.label)}</span>` : "";
    }).join("");
    return `<section class="crown-proof-panel ${complete ? "is-complete" : active ? "is-active" : ""}" aria-labelledby="crownProofTitle">
      <div class="crown-proof-head"><div><span class="eyebrow">DAILY PROOF RUN</span><h2 id="crownProofTitle">今日の三戦証明</h2></div><strong>${count}<small>/3戦</small></strong></div>
      <div class="crown-proof-meter" role="progressbar" aria-label="三戦証明の進捗" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${count}"><i style="width:${progress}%"></i></div>
      <div class="crown-proof-stats"><span><small>開始RATE</small><strong>${startRating}</strong></span><span><small>${complete ? "証明RATE" : "暫定証明RATE"}</small><strong>${crownPower}</strong></span><span><small>異なる相手</small><strong>${Number(run?.uniqueOpponents || 0)}人</strong></span></div>
      <p>${statusCopy}${run?.endsAt ? ` 締切 ${escapeHtml(rankingResetLabel(run.endsAt))}` : ""}</p>
      ${earned ? `<div class="crown-proof-signatures" aria-label="今回解除したSIGNATURE">${earned}</div>` : ""}
      ${action}
    </section>`;
  }

  function renderCrownCustomization(dashboard) {
    if (!dashboard?.enabled) return "";
    const customization = dashboard.customization || {};
    const selectedTheme = Object.hasOwn(CROWN_THEMES, customization.crownTheme)
      ? customization.crownTheme
      : "rose";
    const availableThemes = Array.isArray(customization.availableThemes) && customization.availableThemes.length
      ? customization.availableThemes.filter((theme) => Object.hasOwn(CROWN_THEMES, theme))
      : Object.keys(CROWN_THEMES);
    const availableSignatureIds = Array.isArray(customization.availableSignatureIds)
      ? customization.availableSignatureIds.filter((id) => crownSignaturePresentation(id))
      : [];
    const selectedSignatureId = crownSignaturePresentation(customization.crownSignatureId)
      ? customization.crownSignatureId
      : "";
    const themeOptions = availableThemes.map((theme) => `<option value="${escapeHtml(theme)}" ${theme === selectedTheme ? "selected" : ""}>${escapeHtml(CROWN_THEMES[theme])}</option>`).join("");
    const signatureOptions = [
      `<option value="" ${selectedSignatureId ? "" : "selected"}>SIGNATUREを表示しない</option>`,
      ...availableSignatureIds.map((id) => `<option value="${escapeHtml(id)}" ${id === selectedSignatureId ? "selected" : ""}>${escapeHtml(CROWN_SIGNATURES[id].label)}</option>`),
    ].join("");
    return `<section class="crown-customization crown-theme-${escapeHtml(selectedTheme)}" aria-labelledby="crownCustomizationTitle">
      <div><span class="eyebrow">CROWN CUSTOMIZATION</span><h3 id="crownCustomizationTitle">王座の見せ方</h3><p>獲得済みのSIGNATUREと王座色を、自分で選んで公開できます。</p></div>
      <div class="crown-customization-controls"><label>王座色<select id="crownThemeSelect">${themeOptions}</select></label><label>SIGNATURE<select id="crownSignatureSelect">${signatureOptions}</select></label><button class="button button-ghost button-small" id="crownCustomizationSave" type="button">表示を保存</button></div>
    </section>`;
  }

  function renderRankingDashboardPanel() {
    const dashboard = window.HariaiOnline?.getRankingDashboard?.();
    const statusState = window.HariaiOnline?.getRankingDashboardStatus?.() || { status: "idle", error: "", busy: false };
    if (!dashboard && (statusState.status === "idle" || statusState.status === "loading")) {
      return `<section class="ranking-dashboard is-loading"><p>自分の順位と三戦証明を読み込んでいます…</p></section>`;
    }
    if (!dashboard && statusState.status === "error") {
      return `<section class="ranking-dashboard is-error"><p>${escapeHtml(statusState.error || "自分の順位情報を取得できませんでした。")}</p><button class="button button-ghost button-small" id="rankingDashboardRetryButton" type="button">もう一度取得</button></section>`;
    }
    const overall = dashboard?.overall || {};
    const rank = Number(overall.rank || 0);
    const participants = Number(overall.participantCount || 0);
    const topPercent = rank > 0 && participants > 0
      ? Math.max(1, Math.ceil(Number(overall.topPercent || (rank / participants) * 100)))
      : 0;
    const neighbors = Array.isArray(overall.neighbors) ? overall.neighbors : [];
    const neighborRows = neighbors.length ? neighbors.map((entry) => {
      const own = String(entry.entryId || "") === String(dashboard.entryId || "");
      return `<li class="${own ? "is-self" : ""}"><strong>#${Number(entry.rank || 0) || "—"}</strong><span>${escapeHtml(entry.name)}${own ? "<small>あなた</small>" : ""}</span><b>${Number(entry.rating || 1000)}<small>RATE</small></b></li>`;
    }).join("") : `<li class="is-empty">前後席は正式順位が付くと表示されます。</li>`;
    const nextSeatCopy = rank > 1
      ? `ひとつ上の席まで <strong>+${Math.max(1, Number(overall.nextSeatGap || 1))} RATE</strong>`
      : rank === 1 ? "<strong>現在、第1席です</strong>" : "正式順位を測定中です";
    const contextNotice = overall.contextAvailable === false
      ? `<p class="ranking-dashboard-context-notice" role="status">順位の周辺情報だけを更新中です。三戦証明と対戦はそのまま利用できます。</p>`
      : "";
    return `<section class="ranking-dashboard" aria-labelledby="rankingDashboardTitle">
      <div class="ranking-dashboard-head"><div><span class="eyebrow">YOUR RIVAL ZONE</span><h2 id="rankingDashboardTitle">あなたの現在地</h2></div><div class="ranking-dashboard-rank"><strong>${rank ? `#${rank}` : "—"}</strong><span>${topPercent ? `上位${topPercent}%` : "測定中"}</span></div></div>
      <div class="ranking-dashboard-summary"><span><small>総合RATE</small><strong>${Number(overall.rating || 1000)}</strong></span><span><small>自己最高</small><strong>${Number(overall.bestRank || 0) ? `#${Number(overall.bestRank)}` : "—"}</strong></span><p>${nextSeatCopy}</p></div>
      ${contextNotice}
      <ol class="ranking-neighbor-list" aria-label="自分の前後3人">${neighborRows}</ol>
      ${renderCrownRunPanel(dashboard)}
      ${renderCrownCustomization(dashboard)}
    </section>`;
  }

  function rankingAwardPreview(periodInfo, rank, matches) {
    if (!periodInfo.serverAuthoritative) return "";
    const minimum = Number(periodInfo.awardMinimumMatches || 1);
    if (matches < minimum) {
      return `<span class="ranking-award-preview is-progress">報酬対象まであと${minimum - matches}戦</span>`;
    }
    let label = periodInfo.period === "daily" ? `${rank}位記録対象` : periodInfo.period === "weekly" ? "週間参加記録対象" : "月間参加メダル対象";
    if (rank === 1) label = periodInfo.period === "daily" ? "暫定デイリー1位" : periodInfo.period === "weekly" ? "暫定週間チャンピオン" : "暫定月間チャンピオン";
    else if (rank <= 3) label = periodInfo.period === "daily" ? `暫定デイリーTOP${rank}` : periodInfo.period === "weekly" ? "暫定週間TOP3" : "暫定月間TOP3";
    else if (periodInfo.period !== "daily" && rank <= 10) label = periodInfo.period === "weekly" ? "暫定週間TOP10" : "暫定月間TOP10";
    return `<span class="ranking-award-preview">${escapeHtml(label)}</span>`;
  }

  function renderRankingAwardsPanel() {
    const value = window.HariaiOnline?.getServerRankingAwards?.() || { ready: false, awards: [] };
    if (!value.ready && !value.awards.length) return "";
    const now = Date.now();
    const awards = value.awards.slice(0, 8);
    const cards = awards.length
      ? awards.map((award) => {
        const active = Number(award.activeUntil || 0) > now;
        const periodLabel = award.period === "daily" ? "DAILY" : award.period === "weekly" ? "WEEKLY" : "MONTHLY";
        return `<li class="ranking-award-record ${active ? "is-active" : ""}">
          <span>${escapeHtml(periodLabel)} / ${escapeHtml(award.key)}</span>
          <strong>${escapeHtml(award.label || `${award.rank}位`)}</strong>
          <small>${award.rank}位・${award.matches}戦${active ? "・限定表示期間中" : ""}</small>
        </li>`;
      }).join("")
      : `<li class="ranking-award-empty">サーバーランキングの期間終了後、ここに参加記録と入賞記録が残ります。</li>`;
    return `<section class="ranking-awards-panel" aria-labelledby="rankingAwardsTitle">
      <div><span class="eyebrow">VERIFIED RANKING RECORDS</span><h2 id="rankingAwardsTitle">ランキング実績</h2></div>
      <ul>${cards}</ul>
    </section>`;
  }

  function renderMonthlyHallOfFame() {
    const records = window.HariaiOnline?.getMonthlyRankingHallOfFame?.() || [];
    if (!records.length) return "";
    const champions = records.slice(0, 6).map((record) => `<li>
      <span>${escapeHtml(record.key)}</span>
      <strong>${escapeHtml(record.name)}</strong>
      <small>${record.crownCircuit ? `王座スコア ${Number(record.circuitScore || 0)}・BEST証明RATE ${Number(record.bestCrownPower || record.rating || 1000)}` : `${record.points}点・${record.wins}勝 ${record.losses}敗 ${record.draws}分`}・参加${record.participants}人</small>
    </li>`).join("");
    return `<section class="ranking-hall-of-fame" aria-labelledby="rankingHallTitle">
      <div><span class="eyebrow">MONTHLY HALL OF FAME</span><h2 id="rankingHallTitle">歴代月間王者</h2></div>
      <ol>${champions}</ol>
    </section>`;
  }

  function refreshSelectedRankingPeriod({ force = false } = {}) {
    const info = rankingPeriodInfo();
    rankingDisplayedPeriodKey = info.key;
    expandedRankingEntryId = "";
    rankingComments = [];
    rankingCommentsStatus = "idle";
    return window.HariaiOnline?.refreshLeaderboard?.(rankingPeriod, { force });
  }

  function refreshRankingSurfaces() {
    refreshSelectedRankingPeriod();
    window.HariaiOnline?.refreshOverallLeaderboard?.();
    window.HariaiOnline?.refreshRankingDashboard?.();
  }

  function selectRankingPeriod(period) {
    if (!["daily", "weekly", "monthly"].includes(period) || period === rankingPeriod) return;
    rankingPeriod = period;
    return refreshSelectedRankingPeriod();
  }

  function rankingJumpSurfacesSettled() {
    const selectedStatus = window.HariaiOnline?.getLeaderboardStatus?.() || "idle";
    const overallStatus = window.HariaiOnline?.getOverallLeaderboardStatus?.() || "idle";
    const dashboardStatus = window.HariaiOnline?.getRankingDashboardStatus?.()?.status || "idle";
    return !["idle", "loading"].includes(selectedStatus)
      && !["idle", "loading"].includes(overallStatus)
      && !["idle", "loading"].includes(dashboardStatus);
  }

  function applyPendingRankingJump() {
    const targetName = pendingRankingJump;
    if (!targetName || currentScreen !== "ranking") return;
    const selector = targetName === "overall" ? "#rankingOverallBoard" : "#rankingCircuitBoard";
    window.requestAnimationFrame(() => {
      if (pendingRankingJump !== targetName || currentScreen !== "ranking") return;
      document.querySelector(selector)?.scrollIntoView({ behavior: "auto", block: "start" });
      if (rankingJumpSurfacesSettled()) pendingRankingJump = "";
    });
  }

  function navigateRankingSection(target) {
    const selected = String(target || "");
    if (selected === "overall") {
      pendingRankingJump = "overall";
      applyPendingRankingJump();
      return;
    }
    if (!["daily", "weekly", "monthly"].includes(selected)) return;
    pendingRankingJump = "circuit";
    selectRankingPeriod(selected);
    applyPendingRankingJump();
  }

  function refreshRankingAtPeriodBoundary() {
    if (currentScreen !== "ranking") return;
    const info = rankingPeriodInfo();
    if (info.key && info.key !== rankingDisplayedPeriodKey) {
      refreshRankingSurfaces();
      return;
    }
    const monthlyLoad = window.HariaiOnline?.getMonthlyBeyondLoadState?.();
    if (monthlyLoad?.currentPeriodKey
        && !monthlyLoad.ready
        && Date.now() >= Number(monthlyLoad.retryAt || 0)) {
      window.HariaiOnline?.refreshMonthlyBeyondRanking?.().catch((error) => console.error(error));
    }
  }

  async function beginDailyCrownRun() {
    try {
      setBusy(true, "今日の三戦証明を準備しています…");
      await window.HariaiOnline?.startCrownRun?.();
      showToast("三戦証明を開始しました。次の正式対戦から3試合を記録します。");
    } catch (error) {
      showToast(error?.message || "三戦証明を開始できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function saveCrownCustomization() {
    const crownTheme = document.querySelector("#crownThemeSelect")?.value || "rose";
    const crownSignatureId = document.querySelector("#crownSignatureSelect")?.value || "";
    try {
      setBusy(true, "王座の見せ方を保存しています…");
      await window.HariaiOnline?.setCrownCustomization?.({ crownTheme, crownSignatureId });
      showToast("王座の見せ方を保存しました。");
    } catch (error) {
      showToast(error?.message || "王座の見せ方を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  function bindRankingDashboardEvents() {
    document.querySelector("#rankingDashboardRetryButton")?.addEventListener("click", () => {
      window.HariaiOnline?.refreshRankingDashboard?.();
    });
    document.querySelector("#overallRankingRetryButton")?.addEventListener("click", () => {
      window.HariaiOnline?.refreshOverallLeaderboard?.();
    });
    document.querySelector("#crownRunStartButton")?.addEventListener("click", beginDailyCrownRun);
    document.querySelector("#crownRunSoloButton")?.addEventListener("click", startOnlineBattle);
    document.querySelector("#crownRunStrategyButton")?.addEventListener("click", startStrategyLab);
    document.querySelector("#crownCustomizationSave")?.addEventListener("click", saveCrownCustomization);
  }

  function renderRankingScreen({ refresh = false, preserveScroll = false } = {}) {
    if (currentScreen !== "ranking") pendingRankingJump = "";
    currentScreen = "ranking";
    setLandingChrome();
    const entries = window.HariaiOnline?.getLeaderboard?.() || [];
    const status = window.HariaiOnline?.getLeaderboardStatus?.() || "idle";
    const participationMenu = window.HariaiOnline?.renderOverallRankingParticipation?.({
      controlId: "rankingOverallParticipation",
    }) || "";
    const periodInfo = rankingPeriodInfo();
    const resetLabel = rankingResetLabel(periodInfo.nextResetAt);
    const monthlyOpening = window.HariaiOnline?.getCrownMonthlyOpeningStatus?.() || null;
    const monthlyOpeningPending = status === "ready"
      && periodInfo.period === "monthly"
      && periodInfo.crownCircuit
      && monthlyOpening?.pending === true;
    const monthlyOpeningNotice = monthlyOpeningPending
      ? `<aside class="crown-monthly-opening" aria-label="月間王座の開幕状況">
          <div><span>MONTHLY CROWN</span><strong>月間王座 開幕準備中</strong><p>月間王座は、同じプレイヤーが成立ウィークリーを${Number(monthlyOpening.requiredQualifyingWeeks || 2)}週そろえると開幕します。</p></div>
          <div class="crown-monthly-opening-progress"><span>最高進捗</span><strong>${Number(monthlyOpening.highestQualifyingWeeks || 0)}<small> / ${Number(monthlyOpening.requiredQualifyingWeeks || 2)}週</small></strong></div>
          <p class="crown-monthly-opening-note">${monthlyOpening.earliestOpeningAt ? `最短開幕目安 ${escapeHtml(rankingResetLabel(monthlyOpening.earliestOpeningAt))}以降。` : "同じプレイヤーの成立ウィークリーが2週そろった時点で開幕します。"} 各ウィークリーは成立デイリー2日以上で確定し、参加状況や集計処理により開幕は後ろへ延びる場合があります。</p>
        </aside>`
      : "";
    const rows = entries.length ? entries.map((entry, index) => {
      const entryId = String(entry.entryId || "");
      const expanded = expandedRankingEntryId === entryId;
      const commentsEnabled = entry.commentsEnabled !== false;
      const overallRating = normalizeOverallRating(entry.rating);
      const monthlyBeyondRank = Number(window.HariaiOnline?.getMonthlyBeyondRank?.(entryId, overallRating) || 0);
      const ratingClass = monthlyBeyondRank > 0 ? BEYOND_RATING_CLASS : overallRatingClass(overallRating);
      const ratingClassBadge = renderOverallRatingClassBadge(ratingClass, overallRating, { monthlyRank: monthlyBeyondRank });
      const achievementBadges = window.HariaiAchievements?.renderBadges?.(entry.achievementShowcase) || "";
      const activeAward = entry.rankingAwardLabel && Number(entry.rankingAwardUntil || 0) > Date.now()
        ? `<span class="ranking-award-earned">${escapeHtml(entry.rankingAwardLabel)}</span>`
        : "";
      const theme = Object.hasOwn(CROWN_THEMES, entry.crownTheme) ? entry.crownTheme : "rose";
      if (periodInfo.crownCircuit) {
        const proofCount = periodInfo.period === "daily"
          ? Number(entry.matchCount || 0)
          : Number(entry.qualifyingCount || 0);
        const score = periodInfo.period === "daily"
          ? Number(entry.crownPower || overallRating)
          : Number(entry.circuitScore || 0);
        const scoreLabel = periodInfo.period === "daily" ? "PROOF RATE" : "CIRCUIT SCORE";
        const seat = Number(entry.displayRank || 0);
        const provisional = entry.qualified !== true;
        const recordCopy = periodInfo.period === "daily"
          ? `${Number(entry.wins || 0)}勝 ${Number(entry.losses || 0)}敗 ${Number(entry.draws || 0)}分`
          : periodInfo.period === "weekly"
            ? `成立デイリー ${proofCount}日 / BEST ${Number(periodInfo.bestCount || 3)}`
            : `成立ウィークリー ${proofCount}週 / BEST ${Number(periodInfo.bestCount || 3)}`;
        const modeBreakdown = periodInfo.period === "daily"
          ? `<span class="ranking-mode-points" aria-label="証明に使ったモード"><em>通常 ${Number(entry.modeMatches?.solo || 0)}戦</em><em>戦略 ${Number(entry.modeMatches?.strategy || 0)}戦</em></span>`
          : "";
        return `<article class="ranking-entry crown-ranking-entry ranking-class-${ratingClass.key} crown-theme-${escapeHtml(theme)} is-server-verified ${provisional ? "is-provisional" : ""} ${expanded ? "is-expanded" : ""}">
          <div class="ranking-row">
            <strong class="ranking-position">${seat ? `#${seat}` : "審査中"}</strong>
            <div class="ranking-player"><b>${escapeHtml(entry.name)}</b>${renderRankingXLink(entry)}<small>${provisional ? `${proofCount}${periodInfo.period === "daily" ? "戦" : periodInfo.period === "weekly" ? "日" : "週"} / 成立条件まで挑戦中` : "王座スコア成立"}</small>${renderCrownSignature(entry)}${achievementBadges}</div>
            <div class="ranking-rating"><strong>${score}</strong><small>${scoreLabel}</small></div>
            <div class="ranking-record"><span>${recordCopy}</span><div class="ranking-overall-rate"><small>総合RATE ${overallRating}</small>${ratingClassBadge}</div>${modeBreakdown}</div>
            <button class="ranking-comment-toggle" type="button" data-ranking-comments-toggle="${escapeHtml(entryId)}" aria-expanded="${expanded}" aria-controls="rankingComments-${escapeHtml(entryId)}" ${commentsEnabled ? "" : "disabled"}>${commentsEnabled ? (expanded ? "閉じる" : "コメント") : "受付停止"}</button>
          </div>
          ${expanded ? renderRankingCommentPanel(entry) : ""}
        </article>`;
      }
      const matches = Number(entry.wins || 0) + Number(entry.losses || 0) + Number(entry.draws || 0);
      const hasModePoints = entry.modePoints && typeof entry.modePoints === "object";
      const modePoints = {
        solo: Number(hasModePoints ? entry.modePoints.solo || 0 : entry.points || 0),
        strategy: Number(hasModePoints ? entry.modePoints.strategy || 0 : 0),
      };
      const modeBreakdown = `<span class="ranking-mode-points" aria-label="モード別期間スコア"><em>通常 ${modePoints.solo}</em><em>戦略 ${modePoints.strategy}</em></span>`;
      const provisional = matches < Number(periodInfo.minimumMatches || 1);
      const awardPreview = rankingAwardPreview(periodInfo, index + 1, matches);
      return `<article class="ranking-entry ranking-class-${ratingClass.key} ${periodInfo.serverAuthoritative ? "is-server-verified" : "is-legacy-ranking"} ${expanded ? "is-expanded" : ""}">
        <div class="ranking-row">
          <strong class="ranking-position">${index + 1}</strong>
          <div class="ranking-player"><b>${escapeHtml(entry.name)}</b>${renderRankingXLink(entry)}<small>${provisional ? `仮順位 / ${matches}戦` : `${matches}戦`}</small>${activeAward}${awardPreview}${achievementBadges}</div>
          <div class="ranking-rating"><strong>${Number(entry.points || 0)}</strong><small>PERIOD SCORE</small></div>
          <div class="ranking-record"><span>総合 ${Number(entry.wins || 0)}勝 ${Number(entry.losses || 0)}敗 ${Number(entry.draws || 0)}分</span><div class="ranking-overall-rate"><small>総合RATE ${overallRating}</small>${ratingClassBadge}</div>${modeBreakdown}</div>
          <button class="ranking-comment-toggle" type="button" data-ranking-comments-toggle="${escapeHtml(entryId)}" aria-expanded="${expanded}" aria-controls="rankingComments-${escapeHtml(entryId)}" ${commentsEnabled ? "" : "disabled"}>${commentsEnabled ? (expanded ? "閉じる" : "コメント") : "受付停止"}</button>
        </div>
        ${expanded ? renderRankingCommentPanel(entry) : ""}
      </article>`;
    }).join("") : status === "error"
      ? `<div class="ranking-empty">ランキングを取得できませんでした。<br /><button class="button button-ghost button-small" id="rankingRetryButton">もう一度取得</button></div>`
      : status === "ready"
        ? `<div class="ranking-empty">${monthlyOpeningPending ? "まだ月間へ昇格したウィークリーはありません。デイリーの証明から最初の進捗が生まれます。" : periodInfo.crownCircuit ? "この期間には、まだ成立した王座証明がありません。通常型・戦略型1on1の証明から最初の席が生まれます。" : "この期間にはまだ対戦記録がありません。"}</div>`
        : `<div class="ranking-empty">ランキングを取得しています…</div>`;
    const periodScoreCopy = periodInfo.crownCircuit
      ? periodInfo.period === "daily"
        ? "宣言後の3戦だけ ／ 証明RATEで王座を決定"
        : periodInfo.period === "weekly"
          ? `成立デイリーのBEST ${Number(periodInfo.bestCount || 3)} ／ 2日で正式参加`
          : `成立ウィークリーのBEST ${Number(periodInfo.bestCount || 3)} ／ 2週で正式参加`
      : "勝利3点 ／ 引き分け1点";
    const trustTitle = periodInfo.crownCircuit
      ? "CROWN CIRCUIT V2"
      : periodInfo.serverAuthoritative ? "SERVER VERIFIED" : "LEGACY PERIOD";
    const trustCopy = periodInfo.crownCircuit
      ? "通常型・戦略型1on1の検証済み対戦だけを集計。デイリーは開始を宣言してからの3戦で成立し、終了後に王座を確定します。"
      : periodInfo.serverAuthoritative
        ? "この期間は通常型・戦略型1on1の検証済み正式対戦だけをサーバーで集計し、終了後にランキング実績を確定します。"
        : "移行前に始まった期間です。既存の期間記録を維持し、新しいランキングは通常型・戦略型1on1へ統一します。";
    app.innerHTML = `<section class="screen ranking-screen">
      <div class="section-head">
        <div><span class="eyebrow">STRENGTH / PROOF / PERSONAL CROWN</span><h1>オンライン総合ランキング</h1>
          <p>期間で消えない総合RATEを主役に、通常型・戦略型1on1で今日の王座を証明します。</p></div>
        <button class="button button-ghost button-small" id="rankingBackButton">タイトルへ</button>
      </div>
      <nav class="ranking-jump-nav" aria-label="ランキング内の移動">
        <span><strong>公開TOP10</strong><small>見たいランキングへすぐ移動</small></span>
        <div>
          <button type="button" data-ranking-jump="overall">総合RATE</button>
          <button type="button" data-ranking-jump="daily">デイリー</button>
          <button type="button" data-ranking-jump="weekly">ウィークリー</button>
          <button type="button" data-ranking-jump="monthly">マンスリー</button>
        </div>
      </nav>
      ${participationMenu}
      ${renderRankingDashboardPanel()}
      ${renderRankingSpotlight()}
      ${renderOverallLeaderboardSection()}
      ${renderOverallRatingClassGuide()}
      <section class="ranking-circuit-section" id="rankingCircuitBoard" aria-labelledby="crownCircuitRankingTitle">
        <div class="ranking-circuit-head"><div><span class="eyebrow">CROWN CIRCUIT / TOP 10</span><h2 id="crownCircuitRankingTitle">期間王座サーキット</h2></div><p>公開は上位10席。挑むと決めた日の短期決戦で、デイリーの好成績が週間・月間へ昇格します。</p></div>
        <div class="ranking-period-tabs" role="tablist" aria-label="ランキング期間">
          <button type="button" role="tab" data-ranking-period="daily" aria-selected="${rankingPeriod === "daily"}" class="${rankingPeriod === "daily" ? "is-active" : ""}">デイリー</button>
          <button type="button" role="tab" data-ranking-period="weekly" aria-selected="${rankingPeriod === "weekly"}" class="${rankingPeriod === "weekly" ? "is-active" : ""}">ウィークリー</button>
          <button type="button" role="tab" data-ranking-period="monthly" aria-selected="${rankingPeriod === "monthly"}" class="${rankingPeriod === "monthly" ? "is-active" : ""}">マンスリー</button>
        </div>
        <div class="ranking-period-summary"><strong>${escapeHtml(periodInfo.label)}</strong><span>${escapeHtml(periodScoreCopy)}${resetLabel ? ` ／ 次回切替 ${escapeHtml(resetLabel)}` : ""}</span></div>
        <div class="ranking-trust-notice ${periodInfo.crownCircuit || periodInfo.serverAuthoritative ? "is-verified" : "is-transition"}">
          <strong>${escapeHtml(trustTitle)}</strong>
          <span>${escapeHtml(trustCopy)}</span>
        </div>
        ${monthlyOpeningNotice}
        <div class="ranking-list" aria-label="期間王座ランキング">${rows}</div>
        <p class="ranking-casual-note">${periodInfo.crownCircuit ? "デイリーは毎日3戦で完結。週間は成立したデイリーの上位3日、月間は成立した週間の上位3週だけを採用します。参加しない日は減点されず、総合RATEもリセットされません。" : "移行前に確定した期間スコアは当時の記録として保持します。新しい集計対象は通常型・戦略型1on1だけです。"} BEYONDはRATE 1400以上＋月間10位以内の名誉クラスです。</p>
      </section>
      ${renderMonthlyHallOfFame()}
      ${renderRankingAwardsPanel()}
    </section>`;
    document.querySelector("#rankingBackButton")?.addEventListener("click", renderLandingScreen);
    document.querySelector("#rankingRetryButton")?.addEventListener("click", () => refreshSelectedRankingPeriod({ force: true }));
    document.querySelectorAll("[data-ranking-jump]").forEach((button) => {
      button.addEventListener("click", () => navigateRankingSection(button.dataset.rankingJump));
    });
    document.querySelectorAll("[data-ranking-period]").forEach((button) => {
      button.addEventListener("click", () => selectRankingPeriod(button.dataset.rankingPeriod));
    });
    window.HariaiOnline?.bindOverallRankingParticipation?.({
      controlId: "rankingOverallParticipation",
      onUpdate: () => {
        renderRankingScreen({ preserveScroll: true });
        refreshRankingSurfaces();
      },
    });
    bindRankingDashboardEvents();
    bindRankingCommentEvents();
    app.focus({ preventScroll: true });
    if (!preserveScroll) window.scrollTo({ top: 0, behavior: "smooth" });
    if (refresh) refreshRankingSurfaces();
    applyPendingRankingJump();
  }

  function releaseRankingScreenOwnership(nextScreen, featureActive) {
    if (currentScreen !== "ranking" || featureActive !== true) return;
    pendingRankingJump = "";
    currentScreen = nextScreen;
  }

  function startOnlineBattle() {
    openOnlineFeature("start", () => {
      releaseRankingScreenOwnership("online", window.HariaiOnline?.isActive?.() === true);
    });
  }

  function startStrategyLab() {
    const launch = () => {
      window.HariaiStrategy?.start?.();
      releaseRankingScreenOwnership("strategy", window.HariaiStrategy?.isActive?.() === true);
    };
    if (window.HariaiStrategy?.start) {
      launch();
      return;
    }
    showToast("戦略型1on1対戦を読み込んでいます…");
    window.addEventListener("hariai-strategy-ready", launch, { once: true });
  }

  function startAiTextTraining() {
    if (window.HariaiAiTextTraining?.start) {
      window.HariaiAiTextTraining.start();
      return;
    }
    showToast("AI文字コラトレーニングを読み込んでいます…");
    window.addEventListener(
      "hariai-ai-text-training-ready",
      () => window.HariaiAiTextTraining?.start?.(),
      { once: true },
    );
  }

  function cancelPendingFreeTableLaunch() {
    freeTableLaunchGeneration += 1;
    pendingFreeTableIntent = "";
    freeTableReadyListenerPending = false;
  }

  function startFreeTable({ intent = "hall" } = {}) {
    pendingFreeTableIntent = intent === "lamp" ? "lamp" : "hall";
    setLandingChrome();
    if (window.HariaiFreeTable?.start) {
      freeTableLaunchGeneration += 1;
      const nextIntent = pendingFreeTableIntent;
      pendingFreeTableIntent = "";
      freeTableReadyListenerPending = false;
      window.HariaiFreeTable.start({ intent: nextIntent });
      return;
    }
    showToast("貼り合い自由卓を読み込んでいます…");
    if (freeTableReadyListenerPending) return;
    const launchGeneration = ++freeTableLaunchGeneration;
    freeTableReadyListenerPending = true;
    window.addEventListener("hariai-free-table-ready", () => {
      if (launchGeneration !== freeTableLaunchGeneration || !pendingFreeTableIntent) return;
      freeTableReadyListenerPending = false;
      const nextIntent = pendingFreeTableIntent || "hall";
      pendingFreeTableIntent = "";
      window.HariaiFreeTable?.start?.({ intent: nextIntent });
    }, { once: true });
  }

  function openInitialFreeTableInvite() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(FREE_TABLE_INVITE_QUERY_KEY)) return false;
    const inviteId = params.get(FREE_TABLE_INVITE_QUERY_KEY) || "";
    if (window.HariaiFreeTable?.openInvite) {
      window.HariaiFreeTable.openInvite(inviteId);
      return true;
    }
    window.addEventListener(
      "hariai-free-table-ready",
      () => window.HariaiFreeTable?.openInvite?.(inviteId),
      { once: true },
    );
    return true;
  }

  function startValueMarket() {
    startValueMarketDestination("setup");
  }

  function startValueMarketRankings() {
    startValueMarketDestination("rankings");
  }

  function startValueMarketDestination(destination) {
    const normalizedDestination = destination === "rankings" ? "rankings" : "setup";
    const method = normalizedDestination === "rankings" ? "openRankingsFromLanding" : "start";
    if (typeof window.HariaiMarket?.[method] === "function") {
      pendingValueMarketDestination = "";
      window.HariaiMarket[method]();
      return;
    }
    if (window.HariaiMarket) {
      showToast("推し値市場を更新しました。ページを再読み込みしてお試しください。");
      return;
    }
    pendingValueMarketDestination = normalizedDestination;
    showToast(normalizedDestination === "rankings"
      ? "推し値市場ランキングを読み込んでいます…"
      : "推し値市場を読み込んでいます…");
    if (valueMarketReadyListenerPending) return;
    valueMarketReadyListenerPending = true;
    window.addEventListener("hariai-market-ready", () => {
      valueMarketReadyListenerPending = false;
      const requestedDestination = pendingValueMarketDestination;
      pendingValueMarketDestination = "";
      if (!requestedDestination || !document.querySelector(".screen.hero")) return;
      const requestedMethod = requestedDestination === "rankings" ? "openRankingsFromLanding" : "start";
      window.HariaiMarket?.[requestedMethod]?.();
    }, { once: true });
  }

  function startFleaMarketBrowse() {
    startFleaMarketDestination("shelf");
  }

  function startFleaMarketSellers() {
    startFleaMarketDestination("sellers");
  }

  function startFleaMarketSell() {
    startFleaMarketDestination("sell");
  }

  function startFleaMarketDestination(destination) {
    const initialScreen = ["sellers", "sell"].includes(destination) ? destination : "shelf";
    if (typeof window.HariaiFleaMarket?.start === "function") {
      pendingFleaMarketDestination = "";
      window.HariaiFleaMarket.start({ initialScreen });
      return;
    }
    if (window.HariaiFleaMarket) {
      showToast("AnjuPayフリマを更新しました。ページを再読み込みしてお試しください。");
      return;
    }
    pendingFleaMarketDestination = initialScreen;
    showToast(initialScreen === "sell"
      ? "AnjuPayフリマの出品画面を読み込んでいます…"
      : initialScreen === "sellers"
        ? "今日の売りっ子を読み込んでいます…"
        : "AnjuPayフリマの一日棚を読み込んでいます…");
    if (fleaMarketReadyListenerPending) return;
    fleaMarketReadyListenerPending = true;
    window.addEventListener("hariai-flea-market-ready", () => {
      fleaMarketReadyListenerPending = false;
      const requestedDestination = pendingFleaMarketDestination;
      pendingFleaMarketDestination = "";
      if (!requestedDestination || !document.querySelector(".screen.hero")) return;
      window.HariaiFleaMarket?.start?.({ initialScreen: requestedDestination });
    }, { once: true });
  }

  function startAccount() {
    if (window.HariaiAccount?.start) {
      window.HariaiAccount.start();
      return;
    }
    showToast("AnjuPayウォレットを読み込んでいます…");
    window.addEventListener("hariai-account-ready", () => window.HariaiAccount?.start?.(), { once: true });
  }

  function openOnlineFeature(method, onStarted) {
    const launch = () => {
      if (typeof window.HariaiOnline?.[method] !== "function") return;
      window.HariaiOnline[method]();
      onStarted?.();
    };
    if (typeof window.HariaiOnline?.[method] === "function") {
      launch();
      return;
    }
    showToast("オンライン機能を読み込んでいます…");
    window.addEventListener("hariai-online-ready", launch, { once: true });
  }

  async function processImageFile(file, position, options = {}) {
    if (!file.type.startsWith("image/")) throw new Error("画像ファイルだけ選択できます。");
    if (file.size > MAX_FILE_BYTES) throw new Error("15MBを超える画像は選択できません。");
    const bitmap = await decodeImage(file);
    const maxSide = Math.min(MAX_IMAGE_SIDE, Math.max(640, Number(options.maxSide || MAX_IMAGE_SIDE)));
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#090b12";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap.source, 0, 0, width, height);
    bitmap.close?.();
    const blob = await canvasToBlob(canvas, "image/webp", Math.max(0.65, Math.min(0.9, Number(options.quality || 0.86))));
    return makeDeckItem(blob, position);
  }

  function decodeImage(file) {
    if ("createImageBitmap" in window) {
      return createImageBitmap(file).then((source) => ({
        source,
        width: source.width,
        height: source.height,
        close: () => source.close(),
      })).catch(() => decodeImageWithElement(file));
    }
    return decodeImageWithElement(file);
  }

  function decodeImageWithElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        resolve({
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          close: () => URL.revokeObjectURL(url),
        });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("画像を読み込めませんでした。"));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("画像の変換に失敗しました。"));
      }, type, quality);
    });
  }

  function makeDeckItem(blob, position, { isSample = false } = {}) {
    return {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      blob,
      url: URL.createObjectURL(blob),
      position,
      used: false,
      isSample,
    };
  }

  function openProfileAvatarDatabase() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("このブラウザーはプロフィール画像の端末保存に対応していません。"));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PROFILE_AVATAR_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(PROFILE_AVATAR_STORE_NAME)) {
          request.result.createObjectStore(PROFILE_AVATAR_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("プロフィール画像の保存領域を開けませんでした。"));
    });
  }

  async function loadProfileAvatar() {
    try {
      const database = await openProfileAvatarDatabase();
      const blob = await new Promise((resolve, reject) => {
        const transaction = database.transaction(PROFILE_AVATAR_STORE_NAME, "readonly");
        const request = transaction.objectStore(PROFILE_AVATAR_STORE_NAME).get(PROFILE_AVATAR_RECORD_KEY);
        request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
        request.onerror = () => reject(request.error || new Error("プロフィール画像を読み込めませんでした。"));
      });
      database.close();
      replaceProfileAvatarCache(blob);
    } catch (error) {
      console.warn("Profile avatar storage is unavailable.", error);
    } finally {
      profileAvatarState.ready = true;
    }
    return getProfileAvatar();
  }

  function ensureProfileAvatarReady() {
    if (!profileAvatarReadyPromise) profileAvatarReadyPromise = loadProfileAvatar();
    return profileAvatarReadyPromise;
  }

  function replaceProfileAvatarCache(blob) {
    if (profileAvatarState.url) URL.revokeObjectURL(profileAvatarState.url);
    profileAvatarState.blob = blob instanceof Blob ? blob : null;
    profileAvatarState.url = profileAvatarState.blob ? URL.createObjectURL(profileAvatarState.blob) : "";
  }

  function getProfileAvatar() {
    return { ready: profileAvatarState.ready, blob: profileAvatarState.blob, url: profileAvatarState.url };
  }

  async function persistProfileAvatar(blob) {
    const database = await openProfileAvatarDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(PROFILE_AVATAR_STORE_NAME, "readwrite");
      transaction.objectStore(PROFILE_AVATAR_STORE_NAME).put(blob, PROFILE_AVATAR_RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("プロフィール画像を保存できませんでした。"));
      transaction.onabort = () => reject(transaction.error || new Error("プロフィール画像の保存が中断されました。"));
    });
    database.close();
  }

  async function deleteProfileAvatar() {
    await ensureProfileAvatarReady();
    const database = await openProfileAvatarDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(PROFILE_AVATAR_STORE_NAME, "readwrite");
        transaction.objectStore(PROFILE_AVATAR_STORE_NAME).delete(PROFILE_AVATAR_RECORD_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("プロフィール画像を削除できませんでした。"));
      });
    } finally {
      database.close();
    }
    replaceProfileAvatarCache(null);
  }

  async function prepareProfileAvatar(file) {
    if (!file?.type?.startsWith("image/")) throw new Error("プロフィール画像には画像ファイルを選択してください。");
    if (file.size > MAX_FILE_BYTES) throw new Error("15MBを超える画像は選択できません。");
    const bitmap = await decodeImage(file);
    const cropSide = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.max(0, Math.round((bitmap.width - cropSide) / 2));
    const sourceY = Math.max(0, Math.round((bitmap.height - cropSide) / 2));
    const canvas = document.createElement("canvas");
    canvas.width = PROFILE_AVATAR_SIDE;
    canvas.height = PROFILE_AVATAR_SIDE;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#151925";
    context.fillRect(0, 0, PROFILE_AVATAR_SIDE, PROFILE_AVATAR_SIDE);
    context.drawImage(bitmap.source, sourceX, sourceY, cropSide, cropSide, 0, 0, PROFILE_AVATAR_SIDE, PROFILE_AVATAR_SIDE);
    bitmap.close?.();
    return canvasToBlob(canvas, "image/webp", 0.82);
  }

  async function setProfileAvatarFromFile(file) {
    await ensureProfileAvatarReady();
    const blob = await prepareProfileAvatar(file);
    await persistProfileAvatar(blob);
    replaceProfileAvatarCache(blob);
    return getProfileAvatar();
  }

  function profileInitial(name) {
    return Array.from(String(name || "P").trim())[0]?.toUpperCase() || "P";
  }

  function renderBattleAvatar(name, url = "", { hidden = false, className = "" } = {}) {
    const safeName = escapeHtml(name || "PLAYER");
    const safeClassName = String(className || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (hidden) return `<span class="battle-avatar is-hidden ${safeClassName}" role="img" aria-label="${safeName}のプロフィール画像は非表示">×</span>`;
    if (url) return `<span class="battle-avatar has-image ${safeClassName}"><img src="${escapeHtml(url)}" alt="${safeName}のプロフィール画像" draggable="false" /></span>`;
    return `<span class="battle-avatar is-default ${safeClassName}" role="img" aria-label="${safeName}の初期プロフィールアイコン">${escapeHtml(profileInitial(name))}</span>`;
  }

  function normalizeAvatarControlId(value) {
    return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(String(value)) ? String(value) : "profileAvatar";
  }

  function renderProfileAvatarSetting({ controlId = "profileAvatar", name = "PLAYER" } = {}) {
    const safeControlId = normalizeAvatarControlId(controlId);
    const avatar = getProfileAvatar();
    return `<section class="profile-avatar-setting">
      <div class="profile-avatar-preview">${renderBattleAvatar(name, avatar.url)}</div>
      <div class="profile-avatar-copy"><strong>対戦中プロフィール画像</strong><p>この端末だけに保存し、対戦成立後に相手へP2P転送します。ランキングやトップページには表示しません。</p></div>
      <div class="profile-avatar-actions"><label class="button button-ghost button-small file-button">${avatar.url ? "画像を変更" : "画像を選択"}<input id="${safeControlId}Input" type="file" accept="image/png,image/jpeg,image/webp" /></label>
        <button class="button button-ghost button-small" type="button" id="${safeControlId}Remove" ${avatar.url ? "" : "disabled"}>画像を削除</button></div>
      <small>中央を正方形に切り抜きます。本人写真や個人情報が写った画像の使用にはご注意ください。</small>
    </section>`;
  }

  function bindProfileAvatarSetting({ controlId = "profileAvatar", onUpdate } = {}) {
    const safeControlId = normalizeAvatarControlId(controlId);
    const input = document.getElementById(`${safeControlId}Input`);
    input?.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true, "プロフィール画像を準備しています…");
      try {
        await setProfileAvatarFromFile(file);
        showToast("プロフィール画像をこの端末に保存しました。");
        onUpdate?.();
      } catch (error) {
        showToast(error?.message || "プロフィール画像を保存できませんでした。");
      } finally {
        setBusy(false);
      }
    });
    document.getElementById(`${safeControlId}Remove`)?.addEventListener("click", async () => {
      try {
        await deleteProfileAvatar();
        showToast("プロフィール画像を削除しました。");
        onUpdate?.();
      } catch (error) {
        showToast(error?.message || "プロフィール画像を削除できませんでした。");
      }
    });
  }

  const profileAvatar = {
    ready: ensureProfileAvatarReady,
    get: getProfileAvatar,
    renderSetting: renderProfileAvatarSetting,
    bindSetting: bindProfileAvatarSetting,
    renderBattle: renderBattleAvatar,
  };

  async function createSampleItems(playerIndex, count = MAX_ROUNDS, offset = 0) {
    const items = [];
    for (let index = 0; index < count; index += 1) {
      const position = offset + index;
      const blob = await createSampleImage(playerIndex, position);
      items.push(makeDeckItem(blob, position, { isSample: true }));
    }
    return items;
  }

  function createSampleImage(playerIndex, position) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    const palette = sampleThemes[(position + playerIndex * 2) % sampleThemes.length];
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, palette[0]);
    gradient.addColorStop(1, "#080a10");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = "rgba(255,255,255,.055)";
    context.lineWidth = 2;
    for (let x = 0; x <= canvas.width; x += 80) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 80) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
    }

    const centerX = 600 + (playerIndex === 0 ? -35 : 35);
    context.strokeStyle = palette[1];
    context.lineWidth = 18;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(centerX, 690);
    context.bezierCurveTo(centerX - 25, 530, centerX + 38, 375, centerX, 190);
    context.stroke();

    for (let leaf = 0; leaf < 7; leaf += 1) {
      const y = 540 - leaf * 58;
      const side = leaf % 2 === 0 ? -1 : 1;
      context.save();
      context.translate(centerX + side * (54 + leaf * 5), y);
      context.rotate(side * (0.42 + position * 0.025));
      const leafGradient = context.createLinearGradient(-100, 0, 100, 0);
      leafGradient.addColorStop(0, palette[1]);
      leafGradient.addColorStop(1, palette[2]);
      context.fillStyle = leafGradient;
      context.beginPath();
      context.ellipse(0, 0, 115 - leaf * 4, 48 + leaf * 2, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(255,255,255,.3)";
      context.lineWidth = 4;
      context.beginPath(); context.moveTo(-80, 0); context.lineTo(78, 0); context.stroke();
      context.restore();
    }

    context.fillStyle = "#d8c2a4";
    context.beginPath();
    context.roundRect(centerX - 150, 645, 300, 78, 22);
    context.fill();
    context.fillStyle = "#9c7558";
    context.beginPath();
    context.moveTo(centerX - 125, 710); context.lineTo(centerX + 125, 710);
    context.lineTo(centerX + 90, 850); context.lineTo(centerX - 90, 850); context.closePath();
    context.fill();

    context.fillStyle = "rgba(255,255,255,.82)";
    context.font = "800 30px system-ui, sans-serif";
    context.letterSpacing = "4px";
    context.fillText(`BOTANICAL ENTRY ${String(position + 1).padStart(2, "0")}`, 54, 70);
    context.fillStyle = "rgba(255,255,255,.46)";
    context.font = "700 20px system-ui, sans-serif";
    context.fillText(`ONLINE SAMPLE / PLAYER ${playerIndex + 1}`, 56, 106);
    return canvasToBlob(canvas, "image/webp", 0.9);
  }

  function setLandingChrome() {
    const status = document.querySelector(".status-dot");
    const privacy = document.querySelector(".privacy-badge");
    const footerItems = document.querySelectorAll(".site-footer span");
    if (status) status.innerHTML = "<i></i> ONLINE READY";
    if (privacy) privacy.textContent = "P2Pメディア転送";
    if (footerItems[0]) footerItems[0].textContent = "ONLINE 1ON1 + STRATEGY + SOLO AI TEXT TRAINING + FREE TABLE + MARKETS";
    if (footerItems[1]) footerItems[1].textContent = "ソロの最大10画像とDRAW結果は端末内。対人モードのメディアはP2Pで一時転送します";
    const title = destroyDialog?.querySelector("h2");
    const body = destroyDialog?.querySelector("p");
    const confirm = destroyDialog?.querySelector("#confirmDestroy");
    if (title) title.textContent = "この対戦を破棄しますか？";
    if (body) body.textContent = "勝敗と連勝数には影響しません。選択した画像とチャットはすべて破棄されます。";
    if (confirm) confirm.textContent = "ルームを破棄";
  }

  document.querySelector("#homeLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (window.HariaiAiTextTraining?.isActive?.()) {
      window.HariaiAiTextTraining.requestHome();
      return;
    }
    if (window.HariaiFreeTable?.isActive?.()) {
      const requestHome = window.HariaiFreeTable.requestHome || window.HariaiFreeTable.leave;
      requestHome?.();
      return;
    }
    if (window.HariaiAccount?.isActive?.()) {
      window.HariaiAccount.requestHome();
      return;
    }
    if (window.HariaiFleaMarket?.isActive?.()) {
      window.HariaiFleaMarket.requestHome();
      return;
    }
    if (window.HariaiMarket?.isActive?.()) {
      window.HariaiMarket.requestHome();
      return;
    }
    if (window.HariaiStrategy?.isActive?.()) {
      window.HariaiStrategy.requestHome();
      return;
    }
    if (window.HariaiOnline?.isActive?.()) {
      window.HariaiOnline.requestHome();
      return;
    }
    renderLandingScreen();
  });

  document.querySelector("#confirmDestroy")?.addEventListener("click", () => {
    if (window.HariaiStrategy?.isActive?.()) {
      window.setTimeout(() => window.HariaiStrategy.destroyRoom(), 0);
      return;
    }
    if (window.HariaiOnline?.isActive?.()) {
      window.setTimeout(() => window.HariaiOnline.destroyRoom(), 0);
    }
  });

  window.HariaiApp = {
    returnHome: renderLandingScreen,
    openFreeTable: startFreeTable,
    shared: {
      escapeHtml,
      showToast,
      setBusy,
      processImageFile,
      createSampleItems,
      profileAvatar,
      processGameAudioFile,
      buildResultShareText,
      createXResultPostUrl,
      renderResultShareButton,
      renderCreatorCard,
      createCreatorCardPngBlob,
      createXCreatorCardPostUrl,
      creatorCardShareText,
      downloadBlob,
      officialGameUrl: OFFICIAL_GAME_URL,
    },
  };

  profileAvatar.ready();
  bindAudioStudioEvents();
  window.addEventListener("pagehide", () => {
    stopAudioStudioRecording({ discard: true });
    releaseAudioStudioOutput();
  }, { once: true });

  window.addEventListener("hariai-leaderboard-updated", () => {
    if (currentScreen === "ranking") renderRankingScreen({ preserveScroll: true });
  });

  window.addEventListener("hariai-ranking-dashboard-updated", () => {
    if (currentScreen === "ranking") renderRankingScreen({ preserveScroll: true });
  });

  window.addEventListener("hariai-ranking-awards-updated", () => {
    if (currentScreen === "ranking") renderRankingScreen({ preserveScroll: true });
  });

  window.addEventListener("hariai-online-ready", () => {
    if (currentScreen === "ranking") refreshRankingSurfaces();
    if (document.querySelector("#topMessagePanel")) window.HariaiOnline?.refreshTopMessages?.();
    updateLandingFreeTableEntrance();
    updateLandingAiTextTrainingLights();
  });

  window.addEventListener("hariai-free-table-public-stats-updated", updateLandingFreeTableEntrance);
  window.addEventListener(
    "hariai-ai-text-training-public-stats-updated",
    updateLandingAiTextTrainingLights,
  );

  window.addEventListener("hariai-top-messages-updated", () => {
    const messages = window.HariaiOnline?.getTopMessages?.() || [];
    if (landingTopMessageIndex >= messages.length) landingTopMessageIndex = 0;
    if (document.querySelector("#topMessageContent")?.matches(":focus-within")) return;
    updateLandingTopMessagePanel();
  });

  window.setInterval(refreshRankingAtPeriodBoundary, 60_000);
  window.setInterval(() => {
    const panel = document.querySelector("#topMessagePanel");
    if (!panel) return;
    if (landingTopMessagePaused || panel.matches(":hover, :focus-within")) return;
    const messages = window.HariaiOnline?.getTopMessages?.() || [];
    if (messages.length > 1) {
      landingTopMessageIndex = (landingTopMessageIndex + 1) % messages.length;
      updateLandingTopMessagePanel();
    }
  }, 10_000);
  window.setInterval(() => {
    if (document.querySelector("#topMessagePanel")) window.HariaiOnline?.refreshTopMessages?.({ silent: true });
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    refreshRankingAtPeriodBoundary();
    if (document.querySelector("#topMessagePanel")) window.HariaiOnline?.refreshTopMessages?.({ silent: true });
  });

  renderLandingScreen();
  openInitialFreeTableInvite();
  showAnjuPayUnitNoticeOnce();
})();
