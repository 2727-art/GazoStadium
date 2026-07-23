(function () {
  "use strict";

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

  const app = document.querySelector("#app");
  const toast = document.querySelector("#toast");
  const destroyDialog = document.querySelector("#destroyDialog");
  const audioStudioDialog = document.querySelector("#audioStudioDialog");
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
  let landingTopMessageIndex = 0;
  let profileAvatarReadyPromise = null;
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

  function renderLandingTopMessageContent() {
    const messages = window.HariaiOnline?.getTopMessages?.() || [];
    const status = window.HariaiOnline?.getTopMessagesStatus?.() || "idle";
    const mutedCount = Number(window.HariaiOnline?.getMutedTopMessageCount?.() || 0);
    const resetMuted = mutedCount > 0
      ? `<button class="community-reset" type="button" data-top-message-reset>非表示をリセット（${mutedCount}）</button>`
      : "";
    if ((status === "idle" || status === "loading") && !messages.length) {
      return `<div class="community-message-state"><span class="community-message-spark" aria-hidden="true">♡</span><p>みんなのメッセージを読み込んでいます…</p></div>`;
    }
    if (status === "error" && !messages.length) {
      return `<div class="community-message-state"><span class="community-message-spark" aria-hidden="true">♡</span><p>メッセージを読み込めませんでした。</p><button class="community-retry" type="button" data-top-message-retry>再読み込み</button>${resetMuted}</div>`;
    }
    if (!messages.length) {
      return `<div class="community-message-state"><span class="community-message-spark" aria-hidden="true">♡</span><p>まだメッセージはありません。ポイントショップから最初のひとことを届けませんか？</p><button class="community-shop-link" type="button" data-top-message-shop>投稿枠を見る</button>${resetMuted}</div>`;
    }
    landingTopMessageIndex %= messages.length;
    const message = messages[landingTopMessageIndex];
    const title = message.title
      ? `<span class="community-title ${escapeHtml(message.titleClassName || "")}"><span aria-hidden="true">${escapeHtml(message.titleIcon || "◆")}</span>${escapeHtml(message.title)}</span>`
      : "";
    const count = messages.length > 1 ? `<span class="community-position">${landingTopMessageIndex + 1} / ${messages.length}</span>` : "";
    return `<article class="community-message-card">
      <span class="community-quote" aria-hidden="true">♡</span>
      <div class="community-message-body"><p>${escapeHtml(message.text)}</p><div class="community-author">${title}<strong>${escapeHtml(message.name)}</strong></div></div>
      <div class="community-message-controls">${count}<button type="button" data-top-message-mute="${escapeHtml(message.entryId)}" aria-label="${escapeHtml(message.name)}のメッセージを非表示">この人を非表示</button>${resetMuted}</div>
    </article>`;
  }

  function renderLandingTopMessagePanel() {
    return `<section class="landing-community" id="topMessagePanel" aria-label="トップメッセージ">
      <div class="community-message-head"><div><span>COMMUNITY MESSAGE</span><strong>みんなのひとこと</strong></div><small>最新5件を8秒ごとに表示</small></div>
      <div id="topMessageContent" aria-live="polite">${renderLandingTopMessageContent()}</div>
    </section>`;
  }

  function bindLandingTopMessageEvents() {
    document.querySelector("[data-top-message-retry]")?.addEventListener("click", () => window.HariaiOnline?.refreshTopMessages?.());
    document.querySelector("[data-top-message-shop]")?.addEventListener("click", () => openOnlineFeature("openPointShop"));
    document.querySelector("[data-top-message-mute]")?.addEventListener("click", (event) => {
      landingTopMessageIndex = 0;
      window.HariaiOnline?.muteTopMessage?.(event.currentTarget.dataset.topMessageMute);
      showToast("このプレイヤーのトップメッセージをこの端末で非表示にしました。");
    });
    document.querySelector("[data-top-message-reset]")?.addEventListener("click", () => {
      landingTopMessageIndex = 0;
      window.HariaiOnline?.clearMutedTopMessages?.();
      showToast("トップメッセージの非表示設定をリセットしました。");
    });
  }

  function updateLandingTopMessagePanel() {
    const content = document.querySelector("#topMessageContent");
    if (!content) return;
    content.innerHTML = renderLandingTopMessageContent();
    bindLandingTopMessageEvents();
  }

  function renderLanding() {
    const lobbyStats = window.HariaiOnline?.getLobbyStats?.() || {};
    const modeStats = (mode) => lobbyStats[mode] || { waiting: null, playing: null };
    const soloStats = modeStats("solo");
    const strategyStats = modeStats("strategy");
    const teamStats = modeStats("team");
    const royaleStats = modeStats("royale");
    const statValue = (value) => Number.isInteger(value) ? value : "--";
    return `<section class="screen hero">
      <div>
        <span class="eyebrow hero-eyebrow"><i aria-hidden="true">♥</i><span>好きな画像で、気軽にオンライン対戦</span><i aria-hidden="true">✦</i></span>
        <h1 aria-label="貼り合え。YOUR FAVORITE, YOUR POWER."><span class="hero-title-text">貼り合え</span><span class="hero-heart" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><defs><linearGradient id="heroHeartGradient" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse"><stop stop-color="#ff6b85"/><stop offset="0.58" stop-color="#ff4f72"/><stop offset="1" stop-color="#66e9df"/></linearGradient></defs><path d="M32 58C28.8 54.8 8.1 42.8 5.1 26.1 2.6 12.1 10.1 4 20.1 4 25.9 4 30 7 32 11c2-4 6.1-7 11.9-7 10 0 17.5 8.1 15 22.1C55.9 42.8 35.2 54.8 32 58Z" fill="url(#heroHeartGradient)"/><path d="M13.5 19.5C15.2 12.4 22.5 9.4 27.4 14" fill="none" stroke="rgba(255,255,255,.72)" stroke-linecap="round" stroke-width="3"/></svg></span><span class="hero-tagline">YOUR FAVORITE, YOUR POWER.</span></h1>
        <p class="hero-welcome"><span aria-hidden="true">♡</span><strong>はじめてでも大丈夫。</strong>あなたの「好き」が、いちばんのカードです。</p>
        <p class="hero-copy">
          お気に入りの画像を5枚選んで、知らない誰かと楽しく採点。
          1on1、協力型2on2、4人で最後の1人を決めるバトルロワイヤルを選べます。
        </p>
        <ul class="hero-assurances" aria-label="安心して遊べるポイント">
          <li>匿名で参加</li><li>画像はサーバー保存なし</li><li>ひとりでも友達とでも</li>
        </ul>
        <div class="hero-actions">
          <button class="button button-primary hero-mode-button" id="onlineButton"><small>気軽にスタート</small><span>通常型1on1対戦</span></button>
          <button class="button button-strategy hero-mode-button" id="strategyLabButton"><small>弱点を見抜こう</small><span>戦略型1on1対戦</span></button>
          <button class="button button-cyan hero-mode-button" id="teamBattleButton"><small>ふたりで協力</small><span>2on2チーム対戦</span></button>
          <button class="button button-royale hero-mode-button" id="royaleBattleButton"><small>最後のひとりへ</small><span>4人バトルロワイヤル</span></button>
          <button class="button button-ghost hero-utility-button" id="rankingButton">オンライン総合ランキング</button>
          <button class="button button-ghost hero-utility-button" id="dailyMissionButton">デイリーミッション</button>
          <button class="button button-ghost hero-utility-button" id="pointShopButton">ポイントショップ</button>
          <button class="button hero-audio-tool-button" id="audioStudioButton"><small>端末内だけで録音・変換</small><span>♪ 10秒音声をつくる</span></button>
        </div>
        ${renderLandingTopMessagePanel()}
        <div class="mode-lobby-stats" aria-label="モード別オンライン対戦の参加状況">
          <article class="lobby-mode-card solo"><div class="lobby-mode-head"><span>通常型1ON1</span><small>STANDARD</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbySoloWaitingCount">${statValue(soloStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbySoloPlayingCount">${statValue(soloStats.playing)}</span><em>人</em></strong></div>
          </div></article>
          <article class="lobby-mode-card strategy"><div class="lobby-mode-head"><span>戦略型1ON1</span><small>STRATEGY</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbyStrategyWaitingCount">${statValue(strategyStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbyStrategyPlayingCount">${statValue(strategyStats.playing)}</span><em>人</em></strong></div>
          </div></article>
          <article class="lobby-mode-card team"><div class="lobby-mode-head"><span>2ON2</span><small>TEAM BATTLE</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbyTeamWaitingCount">${statValue(teamStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbyTeamPlayingCount">${statValue(teamStats.playing)}</span><em>人</em></strong></div>
          </div></article>
          <article class="lobby-mode-card royale"><div class="lobby-mode-head"><span>BATTLE ROYALE</span><small>4 PLAYER</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbyRoyaleWaitingCount">${statValue(royaleStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbyRoyalePlayingCount">${statValue(royaleStats.playing)}</span><em>人</em></strong></div>
          </div></article>
        </div>
        <p class="lobby-privacy">対戦人数にトップページの閲覧者は含みません。購入者のトップメッセージだけ表示名・称号とともに公開され、匿名UID・ルーム情報は表示しません。</p>
        <p class="mode-note">画像と戦略型の添付音声は対戦中だけ相手へ直接送信され、Firebaseには保存されません。</p>
      </div>
    </section>`;
  }

  function renderLandingScreen() {
    currentScreen = "landing";
    expandedRankingEntryId = "";
    rankingComments = [];
    rankingCommentsStatus = "idle";
    setLandingChrome();
    app.innerHTML = renderLanding();
    document.querySelector("#strategyLabButton")?.addEventListener("click", startStrategyLab);
    document.querySelector("#onlineButton")?.addEventListener("click", startOnlineBattle);
    document.querySelector("#teamBattleButton")?.addEventListener("click", startTeamBattle);
    document.querySelector("#royaleBattleButton")?.addEventListener("click", startRoyaleBattle);
    document.querySelector("#rankingButton")?.addEventListener("click", () => renderRankingScreen({ refresh: true }));
    document.querySelector("#dailyMissionButton")?.addEventListener("click", () => openOnlineFeature("openDailyMissions"));
    document.querySelector("#pointShopButton")?.addEventListener("click", () => openOnlineFeature("openPointShop"));
    document.querySelector("#audioStudioButton")?.addEventListener("click", openAudioStudio);
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

  function refreshSelectedRankingPeriod() {
    const info = rankingPeriodInfo();
    rankingDisplayedPeriodKey = info.key;
    expandedRankingEntryId = "";
    rankingComments = [];
    rankingCommentsStatus = "idle";
    window.HariaiOnline?.refreshLeaderboard?.(rankingPeriod);
  }

  function selectRankingPeriod(period) {
    if (!["daily", "weekly", "monthly"].includes(period) || period === rankingPeriod) return;
    rankingPeriod = period;
    refreshSelectedRankingPeriod();
  }

  function refreshRankingAtPeriodBoundary() {
    if (currentScreen !== "ranking") return;
    const info = rankingPeriodInfo();
    const monthlyInfo = window.HariaiOnline?.getLeaderboardPeriodInfo?.("monthly");
    const loadedMonthlyKey = window.HariaiOnline?.getMonthlyBeyondPeriodKey?.() || "";
    if (
      (info.key && info.key !== rankingDisplayedPeriodKey)
      || (monthlyInfo?.key && monthlyInfo.key !== loadedMonthlyKey)
    ) refreshSelectedRankingPeriod();
  }

  function renderRankingScreen({ refresh = false, preserveScroll = false } = {}) {
    currentScreen = "ranking";
    setLandingChrome();
    const entries = window.HariaiOnline?.getLeaderboard?.() || [];
    const status = window.HariaiOnline?.getLeaderboardStatus?.() || "idle";
    const participationMenu = window.HariaiOnline?.renderOverallRankingParticipation?.({
      controlId: "rankingOverallParticipation",
    }) || "";
    const periodInfo = rankingPeriodInfo();
    const resetLabel = rankingResetLabel(periodInfo.nextResetAt);
    const rows = entries.length ? entries.map((entry, index) => {
      const matches = Number(entry.wins || 0) + Number(entry.losses || 0) + Number(entry.draws || 0);
      const hasModePoints = entry.modePoints && typeof entry.modePoints === "object";
      const modePoints = {
        solo: Number(hasModePoints ? entry.modePoints.solo || 0 : entry.points || 0),
        strategy: Number(hasModePoints ? entry.modePoints.strategy || 0 : 0),
        team: Number(hasModePoints ? entry.modePoints.team || 0 : 0),
        royale: Number(hasModePoints ? entry.modePoints.royale || 0 : 0),
      };
      const modeBreakdown = `<span class="ranking-mode-points" aria-label="モード別期間ポイント"><em>通常 ${modePoints.solo}</em><em>戦略 ${modePoints.strategy}</em><em>2on2 ${modePoints.team}</em><em>BR ${modePoints.royale}</em></span>`;
      const provisional = matches < Number(periodInfo.minimumMatches || 1);
      const xHandle = /^[A-Za-z0-9_]{1,15}$/.test(String(entry.xHandle || "")) ? String(entry.xHandle) : "";
      const xLink = xHandle ? `<a class="ranking-x-link" href="https://x.com/${encodeURIComponent(xHandle)}" target="_blank" rel="noopener noreferrer">X&nbsp;@${escapeHtml(xHandle)}</a>` : "";
      const entryId = String(entry.entryId || "");
      const expanded = expandedRankingEntryId === entryId;
      const commentsEnabled = entry.commentsEnabled !== false;
      const overallRating = normalizeOverallRating(entry.rating);
      const monthlyBeyondRank = Number(window.HariaiOnline?.getMonthlyBeyondRank?.(entryId, overallRating) || 0);
      const ratingClass = monthlyBeyondRank > 0 ? BEYOND_RATING_CLASS : overallRatingClass(overallRating);
      const ratingClassBadge = renderOverallRatingClassBadge(ratingClass, overallRating, { monthlyRank: monthlyBeyondRank });
      return `<article class="ranking-entry ranking-class-${ratingClass.key} ${expanded ? "is-expanded" : ""}">
        <div class="ranking-row">
          <strong class="ranking-position">${index + 1}</strong>
          <div class="ranking-player"><b>${escapeHtml(entry.name)}</b>${xLink}<small>${provisional ? `仮順位 / ${matches}戦` : `${matches}戦`}</small></div>
          <div class="ranking-rating"><strong>${Number(entry.points || 0)}</strong><small>PERIOD PT</small></div>
          <div class="ranking-record"><span>総合 ${Number(entry.wins || 0)}勝 ${Number(entry.losses || 0)}敗 ${Number(entry.draws || 0)}分</span><div class="ranking-overall-rate"><small>総合RATE ${overallRating}</small>${ratingClassBadge}</div>${modeBreakdown}</div>
          <button class="ranking-comment-toggle" type="button" data-ranking-comments-toggle="${escapeHtml(entryId)}" aria-expanded="${expanded}" aria-controls="rankingComments-${escapeHtml(entryId)}" ${commentsEnabled ? "" : "disabled"}>${commentsEnabled ? (expanded ? "閉じる" : "コメント") : "受付停止"}</button>
        </div>
        ${expanded ? renderRankingCommentPanel(entry) : ""}
      </article>`;
    }).join("") : status === "error"
      ? `<div class="ranking-empty">ランキングを取得できませんでした。<br /><button class="button button-ghost button-small" id="rankingRetryButton">もう一度取得</button></div>`
      : status === "ready"
        ? `<div class="ranking-empty">この期間にはまだ対戦記録がありません。<br />オンライン対戦4モードの完了後に集計されます。</div>`
        : `<div class="ranking-empty">ランキングを取得しています…</div>`;
    app.innerHTML = `<section class="screen ranking-screen">
      <div class="section-head">
        <div><span class="eyebrow">ONLINE OVERALL RANKING / TOP 50</span><h1>オンライン総合ランキング</h1>
          <p>順位は4モード共通の期間ポイント、基本クラスは累積総合RATEで決まります。</p></div>
        <button class="button button-ghost button-small" id="rankingBackButton">タイトルへ</button>
      </div>
      ${participationMenu}
      <div class="ranking-period-tabs" role="tablist" aria-label="ランキング期間">
        <button type="button" role="tab" data-ranking-period="daily" aria-selected="${rankingPeriod === "daily"}" class="${rankingPeriod === "daily" ? "is-active" : ""}">デイリー</button>
        <button type="button" role="tab" data-ranking-period="weekly" aria-selected="${rankingPeriod === "weekly"}" class="${rankingPeriod === "weekly" ? "is-active" : ""}">ウィークリー</button>
        <button type="button" role="tab" data-ranking-period="monthly" aria-selected="${rankingPeriod === "monthly"}" class="${rankingPeriod === "monthly" ? "is-active" : ""}">マンスリー</button>
      </div>
      <div class="ranking-period-summary"><strong>${escapeHtml(periodInfo.label)}</strong><span>勝利・BR優勝3pt ／ 引き分け・BR2位1pt${resetLabel ? ` ／ 次回切替 ${escapeHtml(resetLabel)}` : ""}</span></div>
      <div class="ranking-notice">通常型1on1・戦略型1on1・2on2・バトルロワイヤルを合算します。期間戦績は日本時間で自動切替、総合RATEはリセットされません。BEYONDはRATE 1400以上＋月間10位以内の名誉クラスです。クラスはランキングだけに表示し、対戦相手には表示しません。</div>
      ${renderOverallRatingClassGuide()}
      <div class="ranking-list" aria-label="プレイヤーランキング">${rows}</div>
      <p class="ranking-casual-note">総合ランキング導入後に完了した4モードのオンライン対戦を集計します。バトルロワイヤルは1位を勝利、2位を引き分け、3・4位を敗北として扱います。カジュアル版のため、RATEと戦績はブラウザからFirebaseへ送信されます。</p>
    </section>`;
    document.querySelector("#rankingBackButton")?.addEventListener("click", renderLandingScreen);
    document.querySelector("#rankingRetryButton")?.addEventListener("click", refreshSelectedRankingPeriod);
    document.querySelectorAll("[data-ranking-period]").forEach((button) => {
      button.addEventListener("click", () => selectRankingPeriod(button.dataset.rankingPeriod));
    });
    window.HariaiOnline?.bindOverallRankingParticipation?.({
      controlId: "rankingOverallParticipation",
      onUpdate: () => renderRankingScreen({ preserveScroll: true }),
    });
    bindRankingCommentEvents();
    app.focus({ preventScroll: true });
    if (!preserveScroll) window.scrollTo({ top: 0, behavior: "smooth" });
    if (refresh) refreshSelectedRankingPeriod();
  }

  function startOnlineBattle() {
    openOnlineFeature("start");
  }

  function startStrategyLab() {
    if (window.HariaiStrategy?.start) {
      window.HariaiStrategy.start();
      return;
    }
    showToast("戦略型1on1対戦を読み込んでいます…");
    window.addEventListener("hariai-strategy-ready", () => window.HariaiStrategy?.start?.(), { once: true });
  }

  function startTeamBattle() {
    if (window.HariaiTeam?.start) {
      window.HariaiTeam.start();
      return;
    }
    showToast("2on2機能を読み込んでいます…");
    window.addEventListener("hariai-team-ready", () => window.HariaiTeam?.start?.(), { once: true });
  }

  function startRoyaleBattle() {
    if (window.HariaiRoyale?.start) {
      window.HariaiRoyale.start();
      return;
    }
    showToast("バトルロワイヤル機能を読み込んでいます…");
    window.addEventListener("hariai-royale-ready", () => window.HariaiRoyale?.start?.(), { once: true });
  }

  function openOnlineFeature(method) {
    if (window.HariaiOnline?.[method]) {
      window.HariaiOnline[method]();
      return;
    }
    showToast("オンライン機能を読み込んでいます…");
    window.addEventListener("hariai-online-ready", () => window.HariaiOnline?.[method]?.(), { once: true });
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
    if (privacy) privacy.textContent = "P2P画像転送";
    if (footerItems[0]) footerItems[0].textContent = "ONLINE 1ON1 + STRATEGY + 2ON2 + BATTLE ROYALE / FIREBASE + WEBRTC";
    if (footerItems[1]) footerItems[1].textContent = "画像と戦略型の添付音声は対戦相手へ直接送信し、サーバーへ保存しません";
    const title = destroyDialog?.querySelector("h2");
    const body = destroyDialog?.querySelector("p");
    const confirm = destroyDialog?.querySelector("#confirmDestroy");
    if (title) title.textContent = "この対戦を破棄しますか？";
    if (body) body.textContent = "勝敗と連勝数には影響しません。選択した画像とチャットはすべて破棄されます。";
    if (confirm) confirm.textContent = "ルームを破棄";
  }

  document.querySelector("#homeLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (window.HariaiStrategy?.isActive?.()) {
      window.HariaiStrategy.requestHome();
      return;
    }
    if (window.HariaiRoyale?.isActive?.()) {
      window.HariaiRoyale.requestHome();
      return;
    }
    if (window.HariaiTeam?.isActive?.()) {
      window.HariaiTeam.requestHome();
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
    if (window.HariaiRoyale?.isActive?.()) {
      window.setTimeout(() => window.HariaiRoyale.destroyRoom(), 0);
      return;
    }
    if (window.HariaiTeam?.isActive?.()) {
      window.setTimeout(() => window.HariaiTeam.destroyRoom(), 0);
      return;
    }
    if (window.HariaiOnline?.isActive?.()) {
      window.setTimeout(() => window.HariaiOnline.destroyRoom(), 0);
    }
  });

  window.HariaiApp = {
    returnHome: renderLandingScreen,
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

  window.addEventListener("hariai-online-ready", () => {
    if (currentScreen === "ranking") refreshSelectedRankingPeriod();
    if (document.querySelector("#topMessagePanel")) window.HariaiOnline?.refreshTopMessages?.();
  });

  window.addEventListener("hariai-top-messages-updated", () => {
    const messages = window.HariaiOnline?.getTopMessages?.() || [];
    if (landingTopMessageIndex >= messages.length) landingTopMessageIndex = 0;
    updateLandingTopMessagePanel();
  });

  window.setInterval(refreshRankingAtPeriodBoundary, 60_000);
  window.setInterval(() => {
    if (!document.querySelector("#topMessagePanel")) return;
    const messages = window.HariaiOnline?.getTopMessages?.() || [];
    if (messages.length > 1) {
      landingTopMessageIndex = (landingTopMessageIndex + 1) % messages.length;
      updateLandingTopMessagePanel();
    }
  }, 8_000);
  window.setInterval(() => {
    if (document.querySelector("#topMessagePanel")) window.HariaiOnline?.refreshTopMessages?.({ silent: true });
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    refreshRankingAtPeriodBoundary();
    if (document.querySelector("#topMessagePanel")) window.HariaiOnline?.refreshTopMessages?.({ silent: true });
  });

  renderLandingScreen();
})();
