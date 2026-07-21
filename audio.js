(function () {
  "use strict";

  const STORAGE_KEY = "hariai-stadium-sound-enabled-v1";
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let enabled = localStorage.getItem(STORAGE_KEY) !== "false";
  let context = null;
  let masterGain = null;

  function ensureAudio() {
    if (!enabled || !AudioContextClass) return null;
    if (!context) {
      context = new AudioContextClass();
      masterGain = context.createGain();
      masterGain.gain.value = 0.42;
      masterGain.connect(context.destination);
    }
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
  }

  function tone(frequency, startOffset, duration, options = {}) {
    const audio = ensureAudio();
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
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.12, start + Math.min(0.012, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function noise(startOffset, duration, volume = 0.05) {
    const audio = ensureAudio();
    if (!audio || !masterGain) return;
    const sampleCount = Math.max(1, Math.floor(audio.sampleRate * duration));
    const buffer = audio.createBuffer(1, sampleCount, audio.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      const fade = 1 - (index / sampleCount);
      channel[index] = (Math.random() * 2 - 1) * fade;
    }
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const start = audio.currentTime + startOffset;
    filter.type = "highpass";
    filter.frequency.value = 850;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(start);
  }

  function playButton(kind = "normal") {
    if (kind === "danger") {
      tone(190, 0, 0.08, { type: "square", endFrequency: 135, volume: 0.08 });
      return;
    }
    if (kind === "select") {
      tone(520, 0, 0.045, { type: "triangle", volume: 0.075 });
      tone(700, 0.045, 0.055, { type: "triangle", volume: 0.065 });
      return;
    }
    if (kind === "confirm") {
      tone(390, 0, 0.065, { type: "triangle", volume: 0.08 });
      tone(585, 0.055, 0.09, { type: "triangle", volume: 0.085 });
      return;
    }
    tone(420, 0, 0.045, { type: "sine", endFrequency: 540, volume: 0.065 });
  }

  function playCritical() {
    noise(0, 0.12, 0.075);
    tone(165, 0, 0.22, { type: "sawtooth", endFrequency: 330, volume: 0.075 });
    tone(330, 0.045, 0.2, { type: "square", endFrequency: 660, volume: 0.055 });
    tone(880, 0.19, 0.18, { type: "triangle", endFrequency: 1320, volume: 0.08 });
  }

  function playPerfect() {
    noise(0, 0.16, 0.06);
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      tone(frequency, index * 0.075, 0.19, { type: "triangle", volume: 0.085 });
    });
    tone(1567.98, 0.3, 0.38, { type: "sine", endFrequency: 2093, volume: 0.065 });
  }

  function playCountdown(second) {
    if (second <= 0) {
      tone(180, 0, 0.11, { type: "square", endFrequency: 110, volume: 0.09 });
      tone(360, 0.08, 0.13, { type: "sawtooth", endFrequency: 240, volume: 0.065 });
      return;
    }
    const frequency = second === 1 ? 880 : second === 2 ? 720 : 600;
    tone(frequency, 0, 0.075, { type: "square", endFrequency: frequency * 0.92, volume: 0.07 });
  }

  function classifyButton(button) {
    if (button.classList.contains("button-danger")) return "danger";
    if (button.matches(".score-button, [data-card], [data-online-card]")) return "select";
    if (button.matches(".button-primary, .score-lock")) return "confirm";
    return "normal";
  }

  function updateToggle() {
    const button = document.querySelector("#audioToggle");
    if (!button) return;
    button.textContent = enabled ? "SE ON" : "SE OFF";
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "効果音をオフにする" : "効果音をオンにする");
    button.title = enabled ? "効果音：オン" : "効果音：オフ";
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    localStorage.setItem(STORAGE_KEY, String(enabled));
    updateToggle();
    if (enabled) playButton("confirm");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.id === "audioToggle") {
      setEnabled(!enabled);
      return;
    }
    playButton(classifyButton(button));
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
    playResult(score) {
      if (score === 10) playPerfect();
      else if (score >= 8) playCritical();
    },
    isEnabled: () => enabled,
    setEnabled,
  };
})();
