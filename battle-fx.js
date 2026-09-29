(function () {
  "use strict";

  // 通常型1on1の演出を再生する。演出はこの端末の表示だけで、対戦の進行・同期・送信は待たない。
  const SPEED_KEY = "hariai-battle-fx-speed-v1";
  const SPEEDS = { normal: 1, short: 0.5 };
  const FILL_WIDTH = 32;
  const SKIP_IGNORE = "button, a, input, textarea, select, summary, label, dialog, [data-fx-no-skip]";

  const played = new Set();
  const fillCache = new Map();
  let speedName = readSpeed();
  let active = null;
  let lightbox = null;

  function readSpeed() {
    try {
      return localStorage.getItem(SPEED_KEY) === "short" ? "short" : "normal";
    } catch (error) {
      return "normal";
    }
  }

  function applySpeed() {
    document.documentElement.style.setProperty("--vb-fx-speed", String(SPEEDS[speedName]));
  }

  function setSpeed(name) {
    speedName = name === "short" ? "short" : "normal";
    try {
      localStorage.setItem(SPEED_KEY, speedName);
    } catch (error) {
      // 保存できない環境でも、このページを開いている間は設定を使う。
    }
    applySpeed();
    return speedName;
  }

  function reducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  function cleanup(controller) {
    controller.timers.forEach((id) => window.clearTimeout(id));
    controller.intervals.forEach((id) => window.clearInterval(id));
    controller.timers = [];
    controller.intervals = [];
    controller.root.removeEventListener("click", controller.onSkip);
    if (active === controller) active = null;
  }

  function cancel() {
    if (active) cleanup(active);
  }

  /*
    steps: [[ms, (ctx) => {}], ...]
    同じ key の演出は一度だけ。再描画や「視差効果を減らす」では全ステップを即座に実行して完成状態にする。
    画面をタップすると残りのステップをまとめて実行して最後の状態へ飛ぶ。
  */
  function play(root, key, steps) {
    cancel();
    if (!root) return;
    const replay = played.has(key);
    played.add(key);
    const instant = replay || reducedMotion();
    const controller = { root, timers: [], intervals: [], onSkip: null, fast: instant };
    const context = {
      replay,
      root,
      get fast() { return controller.fast; },
      every(ms, fn) {
        if (controller.fast) return 0;
        const id = window.setInterval(fn, ms);
        controller.intervals.push(id);
        return id;
      },
      stop(id) {
        if (id) window.clearInterval(id);
      },
      sound(fn, { essential = false } = {}) {
        if (replay || (controller.fast && !essential)) return;
        try {
          fn();
        } catch (error) {
          // 音が鳴らなくても演出は続ける。
        }
      },
    };
    const pending = steps.map(([at, fn]) => ({ at, fn, done: false }));
    const runStep = (step) => {
      if (step.done) return;
      step.done = true;
      step.fn(context);
    };
    const finish = () => {
      root.dataset.fx = "done";
      cleanup(controller);
    };

    root.dataset.fx = "play";
    if (instant) {
      root.classList.add("vb-fx-instant");
      pending.forEach(runStep);
      finish();
      return;
    }

    const scale = SPEEDS[speedName];
    controller.onSkip = (event) => {
      if (event.target.closest(SKIP_IGNORE)) return;
      controller.fast = true;
      root.classList.add("vb-fx-instant");
      controller.intervals.forEach((id) => window.clearInterval(id));
      controller.intervals = [];
      pending.forEach(runStep);
      finish();
    };
    pending.forEach((step) => {
      controller.timers.push(window.setTimeout(() => {
        runStep(step);
        if (pending.every((item) => item.done)) finish();
      }, step.at * scale));
    });
    root.addEventListener("click", controller.onSkip);
    active = controller;
  }

  function isPlaying(root) {
    return Boolean(active && active.root === root);
  }

  function skip() {
    if (active?.onSkip) active.onSkip({ target: active.root });
  }

  // 金の粒。box の中に一度だけ飛び散らせて、終わったら消す。
  function burst(box, { count = 24, x = "50%", y = "45%", fall = false } = {}) {
    if (!box || reducedMotion()) return;
    const colors = ["#fff0c9", "#e6c17a", "#ff8ab6", "#ffffff", "#c99a4c"];
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement("i");
      const color = colors[index % colors.length];
      if (fall) {
        particle.className = "vb-confetti";
        particle.style.cssText = `--x:${Math.round(Math.random() * 100)}%;--dx:${Math.round(Math.random() * 120 - 60)}px;--d:${Math.round(Math.random() * 900)}ms;background:${color}`;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const radius = 80 + Math.random() * 130;
        particle.className = "vb-spark";
        particle.style.cssText = `--x:${x};--y:${y};--s:${3 + Math.round(Math.random() * 4)}px;--c:${color};--dx:${Math.round(Math.cos(angle) * radius)}px;--dy:${Math.round(Math.sin(angle) * radius)}px;--d:${Math.round(Math.random() * 120)}ms`;
      }
      fragment.append(particle);
    }
    box.append(fragment);
    window.setTimeout(() => box.replaceChildren(), fall ? 3400 : 1600);
  }

  // カードの余白を埋めるぼかし用に、32px幅の縮小版を作る。フルサイズにblurをかけるより軽い。
  function fillSource(url) {
    const cached = fillCache.get(url);
    return typeof cached === "string" ? cached : "";
  }

  function prepareFill(url) {
    if (!url || fillCache.has(url)) return;
    fillCache.set(url, null);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    const ready = image.decode ? image.decode() : new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    ready.then(() => {
      const width = FILL_WIDTH;
      const height = Math.max(1, Math.round((image.naturalHeight / Math.max(1, image.naturalWidth)) * width));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(image, 0, 0, width, height);
      const small = canvas.toDataURL("image/jpeg", 0.7);
      fillCache.set(url, small);
      document.querySelectorAll("img[data-fill-for]").forEach((fill) => {
        if (fill.dataset.fillFor !== url) return;
        fill.src = small;
        fill.classList.add("is-small");
      });
    }).catch(() => {
      fillCache.delete(url);
    });
  }

  function decode(urls) {
    const list = urls.filter(Boolean).map((url) => {
      const image = new Image();
      image.src = url;
      return image.decode ? image.decode().catch(() => {}) : Promise.resolve();
    });
    return Promise.all(list);
  }

  // 画像をタップした時の全画面表示
  function openLightbox(src, alt = "") {
    if (!src) return;
    closeLightbox();
    const overlay = document.createElement("div");
    overlay.className = "vb-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "画像の拡大表示");
    const image = document.createElement("img");
    image.src = src;
    image.alt = alt;
    image.draggable = false;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "vb-lightbox-close";
    close.textContent = "閉じる";
    const hint = document.createElement("small");
    hint.textContent = "ピンチで拡大・タップで閉じる";
    overlay.append(image, close, hint);
    overlay.addEventListener("click", closeLightbox);
    image.addEventListener("contextmenu", (event) => event.preventDefault());
    document.body.append(overlay);
    lightbox = { overlay, returnFocus: document.activeElement };
    close.focus({ preventScroll: true });
  }

  function closeLightbox() {
    if (!lightbox) return;
    const { overlay, returnFocus } = lightbox;
    lightbox = null;
    overlay.remove();
    returnFocus?.focus?.({ preventScroll: true });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (lightbox) {
      event.preventDefault();
      closeLightbox();
      return;
    }
    document.querySelectorAll(".vb-menu[open]").forEach((menu) => {
      menu.open = false;
      menu.querySelector("summary")?.focus({ preventScroll: true });
    });
  });

  // 対戦メニューは外側をタップしたら閉じる
  document.addEventListener("click", (event) => {
    document.querySelectorAll(".vb-menu[open]").forEach((menu) => {
      if (!menu.contains(event.target)) menu.open = false;
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest(".vb-screen [data-zoom-src]");
    if (!target) return;
    const root = target.closest(".vb-screen");
    if (isPlaying(root)) {
      skip();
      return;
    }
    openLightbox(target.dataset.zoomSrc, target.dataset.zoomAlt || "");
  });

  applySpeed();

  window.HariaiBattleFx = Object.freeze({
    play,
    cancel,
    hasPlayed: (key) => played.has(key),
    isPlaying,
    skip,
    burst,
    fillSource,
    prepareFill,
    decode,
    openLightbox,
    closeLightbox,
    getSpeed: () => speedName,
    setSpeed,
    reducedMotion,
  });
})();
