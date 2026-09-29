(function () {
  "use strict";

  const STORAGE_KEY = "hariai-stadium-sound-enabled-v1";
  const BGM_STORAGE_KEY = "hariai-stadium-bgm-enabled-v1";
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  // 商用利用できる効果音・BGMの素材を用意したら、ここにパスを書くと合成音の代わりに再生する。
  // 例: flip: "assets/sfx/flip.mp3"。書いていない音と、読み込みに失敗した音は合成音で鳴らす。
  const SOUND_FILES = Object.freeze({});
  // 例: lobby: "assets/bgm/lobby.mp3", battle: "assets/bgm/battle.mp3"。1つでも書くとBGMボタンが出る。
  const BGM_FILES = Object.freeze({});

  let enabled = readFlag(STORAGE_KEY);
  let bgmEnabled = readFlag(BGM_STORAGE_KEY);
  let context = null;
  let masterGain = null;
  let bgmGain = null;
  let bgmSource = null;
  let bgmScene = "";
  const buffers = new Map();

  function readFlag(key) {
    try {
      return localStorage.getItem(key) !== "false";
    } catch (error) {
      return true;
    }
  }

  function writeFlag(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (error) {
      // 保存できない環境では、このページを開いている間だけ設定を使う。
    }
  }

  function ensureAudio() {
    if (!AudioContextClass) return null;
    if (!context) {
      context = new AudioContextClass();
      masterGain = context.createGain();
      masterGain.gain.value = 0.42;
      masterGain.connect(context.destination);
      bgmGain = context.createGain();
      bgmGain.gain.value = 0.22;
      bgmGain.connect(context.destination);
    }
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
  }

  function effectsContext() {
    return enabled ? ensureAudio() : null;
  }

  function tone(frequency, startOffset, duration, options = {}) {
    const audio = effectsContext();
    if (!audio || !masterGain) return;
    const start = audio.currentTime + startOffset;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, start + duration);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.12, start + Math.min(options.attack || 0.012, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  // 雑音を帯域で絞って鳴らす。swell で音が大きくなっていく（逆再生のシンバル風）。
  function noise(startOffset, duration, volume = 0.05, options = {}) {
    const audio = effectsContext();
    if (!audio || !masterGain) return;
    const sampleCount = Math.max(1, Math.floor(audio.sampleRate * duration));
    const buffer = audio.createBuffer(1, sampleCount, audio.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      const progress = index / sampleCount;
      const envelope = options.swell ? progress * progress : 1 - progress;
      channel[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const start = audio.currentTime + startOffset;
    filter.type = options.filter || "highpass";
    filter.frequency.setValueAtTime(options.frequency || 850, start);
    if (options.endFrequency) {
      filter.frequency.exponentialRampToValueAtTime(options.endFrequency, start + duration);
    }
    if (options.q) filter.Q.value = options.q;
    gain.gain.setValueAtTime(volume, start);
    if (!options.swell) gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(start);
  }

  function loadBuffer(url) {
    const audio = ensureAudio();
    if (!audio) return Promise.resolve(null);
    return fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
      .then((data) => new Promise((resolve, reject) => audio.decodeAudioData(data, resolve, reject)))
      .catch(() => null);
  }

  function bufferFor(name, url) {
    if (!url) return null;
    const cached = buffers.get(url);
    if (cached instanceof AudioBuffer) return cached;
    if (!buffers.has(url)) {
      buffers.set(url, loadBuffer(url).then((buffer) => {
        buffers.set(url, buffer);
        return buffer;
      }));
    }
    return null;
  }

  // 素材があれば素材を、なければ（または読み込み中は）合成音を鳴らす。
  function play(name, synth) {
    if (!enabled) return;
    const buffer = bufferFor(name, SOUND_FILES[name]);
    const audio = effectsContext();
    if (buffer && audio && masterGain) {
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(masterGain);
      source.start();
      return;
    }
    synth();
  }

  function playButton(kind = "normal") {
    play(`button-${kind}`, () => {
      if (kind === "danger") {
        tone(190, 0, 0.08, { type: "square", endFrequency: 135, volume: 0.08 });
        return;
      }
      if (kind === "select") {
        tone(520, 0, 0.045, { type: "triangle", volume: 0.075 });
        tone(700, 0.045, 0.055, { type: "triangle", volume: 0.065 });
        return;
      }
      if (kind === "card") {
        noise(0, 0.07, 0.05, { filter: "bandpass", frequency: 2600, endFrequency: 1400, q: 1.2 });
        tone(660, 0.02, 0.05, { type: "triangle", volume: 0.045 });
        return;
      }
      if (kind === "lock") {
        tone(1200, 0, 0.03, { type: "square", volume: 0.06 });
        tone(240, 0.02, 0.14, { type: "triangle", endFrequency: 180, volume: 0.1 });
        tone(720, 0.06, 0.12, { type: "sine", volume: 0.05 });
        return;
      }
      if (kind === "confirm") {
        tone(390, 0, 0.065, { type: "triangle", volume: 0.08 });
        tone(585, 0.055, 0.09, { type: "triangle", volume: 0.085 });
        return;
      }
      tone(420, 0, 0.045, { type: "sine", endFrequency: 540, volume: 0.065 });
    });
  }

  // 1点から10点へ、ドから一段ずつ音が上がる。
  const SCORE_NOTES = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51];

  function playScoreSelect(score) {
    const index = Math.max(1, Math.min(10, Number(score) || 1)) - 1;
    play("score-select", () => {
      tone(SCORE_NOTES[index], 0, 0.12, { type: "triangle", volume: 0.08 });
      if (index >= 7) tone(SCORE_NOTES[index] * 1.5, 0.04, 0.16, { type: "sine", volume: 0.045 });
      if (index === 9) noise(0.02, 0.18, 0.03, { frequency: 6000 });
    });
  }

  function playCritical() {
    play("critical", () => {
      noise(0, 0.12, 0.075);
      tone(165, 0, 0.22, { type: "sawtooth", endFrequency: 330, volume: 0.075 });
      tone(330, 0.045, 0.2, { type: "square", endFrequency: 660, volume: 0.055 });
      tone(880, 0.19, 0.18, { type: "triangle", endFrequency: 1320, volume: 0.08 });
      tone(2637, 0.2, 0.4, { type: "sine", volume: 0.03 });
    });
  }

  function playPerfect() {
    play("perfect", () => {
      noise(0, 0.16, 0.06);
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        tone(frequency, index * 0.075, 0.19, { type: "triangle", volume: 0.085 });
      });
      tone(1567.98, 0.3, 0.38, { type: "sine", endFrequency: 2093, volume: 0.065 });
      [2093, 2637, 3136].forEach((frequency, index) => {
        tone(frequency, 0.42 + index * 0.05, 0.9, { type: "sine", volume: 0.022, attack: 0.02 });
      });
    });
  }

  function playCountdown(second) {
    play(second <= 0 ? "countdown-end" : "countdown", () => {
      if (second <= 0) {
        tone(180, 0, 0.11, { type: "square", endFrequency: 110, volume: 0.09 });
        tone(360, 0.08, 0.13, { type: "sawtooth", endFrequency: 240, volume: 0.065 });
        return;
      }
      // 心音のように低く二拍
      const frequency = second === 1 ? 96 : second === 2 ? 88 : 80;
      tone(frequency, 0, 0.12, { type: "sine", endFrequency: frequency * 0.7, volume: 0.16 });
      tone(frequency * 0.9, 0.16, 0.1, { type: "sine", endFrequency: frequency * 0.6, volume: 0.11 });
      tone(second === 1 ? 880 : 660, 0, 0.05, { type: "square", volume: 0.035 });
    });
  }

  function playVersus() {
    play("versus", () => {
      noise(0, 0.2, 0.09, { filter: "lowpass", frequency: 1800 });
      tone(110, 0, 0.35, { type: "sawtooth", endFrequency: 55, volume: 0.1 });
      tone(1320, 0.02, 0.5, { type: "triangle", endFrequency: 990, volume: 0.04 });
    });
  }

  function playFlip() {
    play("flip", () => {
      noise(0, 0.22, 0.06, { filter: "bandpass", frequency: 900, endFrequency: 3600, q: 0.8 });
    });
  }

  function playReveal() {
    play("reveal", () => {
      noise(0, 0.26, 0.05, { filter: "bandpass", frequency: 1200, endFrequency: 5200, q: 0.8 });
      [1318.51, 1567.98, 2093, 2637].forEach((frequency, index) => {
        tone(frequency, 0.08 + index * 0.045, 0.32, { type: "sine", volume: 0.035 });
      });
    });
  }

  function playRoll() {
    play("roll", () => {
      for (let index = 0; index < 10; index += 1) {
        tone(1400 + (index % 2) * 200, index * 0.055, 0.025, { type: "square", volume: 0.025 });
      }
    });
  }

  function playLand() {
    play("land", () => {
      tone(140, 0, 0.18, { type: "sine", endFrequency: 80, volume: 0.12 });
      tone(784, 0.02, 0.22, { type: "triangle", volume: 0.05 });
    });
  }

  function playDamage(amount = 5) {
    play("damage", () => {
      const weight = Math.max(0.6, Math.min(1.4, Number(amount) / 6));
      noise(0, 0.14, 0.06 * weight, { filter: "lowpass", frequency: 900 });
      tone(120, 0, 0.26, { type: "sine", endFrequency: 48, volume: 0.16 * weight });
    });
  }

  function playFinish(signature = false) {
    play(signature ? "finish-signature" : "finish", () => {
      noise(0, 0.5, 0.05, { swell: true, filter: "highpass", frequency: 2500 });
      noise(0.5, 0.35, 0.1, { filter: "lowpass", frequency: 1600 });
      tone(98, 0.5, 0.6, { type: "sawtooth", endFrequency: 41, volume: 0.12 });
      tone(196, 0.52, 0.4, { type: "square", endFrequency: 98, volume: 0.05 });
      if (signature) {
        [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((frequency, index) => {
          tone(frequency, 0.62 + index * 0.06, 1.1, { type: "triangle", volume: 0.045, attack: 0.02 });
        });
      }
    });
  }

  function playWin() {
    play("win", () => {
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        tone(frequency, index * 0.1, 0.16, { type: "triangle", volume: 0.08 });
      });
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency) => {
        tone(frequency, 0.32, 0.9, { type: "triangle", volume: 0.045, attack: 0.02 });
      });
    });
  }

  function playLose() {
    play("lose", () => {
      [392, 311.13, 261.63].forEach((frequency, index) => {
        tone(frequency, index * 0.16, 0.42, { type: "sine", volume: 0.06, attack: 0.03 });
      });
    });
  }

  // BGMは素材がある場面だけ流す。場面が同じなら流し続ける。
  function setBgm(scene = "") {
    const url = BGM_FILES[scene] || "";
    if (scene === bgmScene && (bgmSource || !url)) return;
    bgmScene = scene;
    stopBgm();
    if (!url || !bgmEnabled || !enabled) return;
    const cached = buffers.get(url);
    const start = (buffer) => {
      if (!buffer || bgmScene !== scene || bgmSource || !bgmEnabled || !enabled) return;
      const audio = ensureAudio();
      if (!audio || !bgmGain) return;
      bgmSource = audio.createBufferSource();
      bgmSource.buffer = buffer;
      bgmSource.loop = true;
      bgmSource.connect(bgmGain);
      bgmSource.start();
    };
    if (cached instanceof AudioBuffer) start(cached);
    else {
      bufferFor(scene, url);
      Promise.resolve(buffers.get(url)).then(start);
    }
  }

  function stopBgm() {
    if (!bgmSource) return;
    try {
      bgmSource.stop();
    } catch (error) {
      // すでに止まっている
    }
    bgmSource.disconnect();
    bgmSource = null;
  }

  function playMatchReady() {
    play("match-ready", () => {
      tone(659.25, 0, 0.18, { type: "sine", endFrequency: 698.46, volume: 0.055 });
      tone(987.77, 0.14, 0.28, { type: "sine", endFrequency: 1046.5, volume: 0.06 });
    });
  }

  function classifyButton(button) {
    if (button.classList.contains("button-danger")) return "danger";
    if (button.matches("[data-online-score]")) return "score";
    if (button.matches("[data-online-card], [data-card]")) return "card";
    if (button.matches(".score-button")) return "select";
    if (button.matches("#onlineLockSelection, #onlineLockScore")) return "lock";
    if (button.matches(".button-primary, .score-lock, .vl-main-button")) return "confirm";
    return "normal";
  }

  function updateToggle() {
    const button = document.querySelector("#audioToggle");
    if (button) {
      button.textContent = enabled ? "SE ON" : "SE OFF";
      button.setAttribute("aria-pressed", String(enabled));
      button.setAttribute("aria-label", enabled ? "効果音をオフにする" : "効果音をオンにする");
      button.title = enabled ? "効果音：オン" : "効果音：オフ";
    }
    if (!Object.keys(BGM_FILES).length || !button) return;
    let bgmButton = document.querySelector("#bgmToggle");
    if (!bgmButton) {
      bgmButton = document.createElement("button");
      bgmButton.type = "button";
      bgmButton.id = "bgmToggle";
      bgmButton.className = "audio-toggle";
      button.after(bgmButton);
    }
    bgmButton.textContent = bgmEnabled ? "BGM ON" : "BGM OFF";
    bgmButton.setAttribute("aria-pressed", String(bgmEnabled));
    bgmButton.setAttribute("aria-label", bgmEnabled ? "BGMをオフにする" : "BGMをオンにする");
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    writeFlag(STORAGE_KEY, enabled);
    updateToggle();
    if (enabled) {
      playButton("confirm");
      const scene = bgmScene;
      bgmScene = "";
      setBgm(scene);
    } else {
      stopBgm();
    }
  }

  function setBgmEnabled(nextEnabled) {
    bgmEnabled = Boolean(nextEnabled);
    writeFlag(BGM_STORAGE_KEY, bgmEnabled);
    updateToggle();
    const scene = bgmScene;
    bgmScene = "";
    if (bgmEnabled) setBgm(scene);
    else {
      bgmScene = scene;
      stopBgm();
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.id === "audioToggle") {
      setEnabled(!enabled);
      return;
    }
    if (button.id === "bgmToggle") {
      setBgmEnabled(!bgmEnabled);
      return;
    }
    const kind = classifyButton(button);
    if (kind === "score") playScoreSelect(button.dataset.onlineScore);
    else playButton(kind);
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateToggle, { once: true });
  } else {
    updateToggle();
  }

  window.HariaiAudio = {
    playButton,
    playCritical,
    playPerfect,
    playCountdown,
    playMatchReady,
    playResult(score) {
      if (score === 10) playPerfect();
      else if (score >= 8) playCritical();
    },
    playScoreSelect,
    playVersus,
    playFlip,
    playReveal,
    playRoll,
    playLand,
    playDamage,
    playFinish,
    playWin,
    playLose,
    setBgm,
    isEnabled: () => enabled,
    setEnabled,
  };
})();
