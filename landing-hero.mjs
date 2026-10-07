// トップの見本（なりきりDM）：口調スイッチ、見えた時に1回だけ流す演出、入口の人数の言い方。
// 見本は app.js の renderLanding が描き、この部品は描かれた後に動きだけを付ける。通信は行わない。
import { ROLEPLAY_VOICE_SETS } from "./finish-roleplay.mjs?v=finish-reply-v2-girl-voice-v1";

export const HERO_SCORE = 90;
export const HERO_DEFAULT_PERSONA = "tsuyotsuyo";
const INTRO_COUNT_DELAY_MS = 950;
const INTRO_COUNT_DURATION_MS = 700;

// 入口の人数の言い方。0人をそのまま出さず、いる方だけを言葉にする（app.js の初回表示と同じ判定）。
export function heroLiveState(solo) {
  const waiting = solo?.waiting;
  const playing = solo?.playing;
  if (!Number.isInteger(waiting) || !Number.isInteger(playing)) return "unknown";
  if (waiting > 0 && playing > 0) return "both";
  if (waiting > 0) return "waiting";
  if (playing > 0) return "playing";
  return "empty";
}

// 返事のセリフは、通常型1on1で実際に出る高得点帯のリアクション（各口調の1つ目）を使う。
export function heroReplyLine(personaId, score = HERO_SCORE) {
  const voiceSet = ROLEPLAY_VOICE_SETS.find((set) => set.id === personaId);
  const template = voiceSet?.reactions?.high?.[0];
  return template ? template.replaceAll("{score}", String(score)) : "";
}

export function heroPersonaLabel(personaId) {
  return ROLEPLAY_VOICE_SETS.find((set) => set.id === personaId)?.label || "";
}

function replyTextNode(reply) {
  const number = reply.querySelector(".ha-score-number");
  let node = number?.nextSibling || null;
  while (node && node.nodeType !== Node.TEXT_NODE) node = node.nextSibling;
  if (!node && number) {
    node = document.createTextNode("");
    number.after(node);
  }
  return node;
}

function applyPersona(stage, personaId) {
  const label = heroPersonaLabel(personaId);
  const line = heroReplyLine(personaId);
  const reply = stage.querySelector("[data-hero-reply]");
  if (!label || !line || !reply) return;
  reply.classList.forEach((name) => {
    if (name.startsWith("chat-persona-")) reply.classList.remove(name);
  });
  reply.classList.add(`chat-persona-${personaId}`);
  const text = replyTextNode(reply);
  if (text) text.textContent = line;
  const me = stage.querySelector("[data-hero-me]");
  if (me) me.textContent = `あなた（${label}）`;
  const mark = stage.querySelector("[data-hero-mark]");
  if (mark) mark.className = `chat-persona-mark is-${personaId}`;
  stage.querySelectorAll("[data-hero-persona]").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.heroPersona === personaId));
  });
  if (!prefersReducedMotion()) {
    reply.classList.remove("is-bump");
    void reply.offsetWidth;
    reply.classList.add("is-bump");
  }
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function countUpScore(thread) {
  const number = thread.querySelector(".ha-score-number");
  const text = number?.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return;
  text.textContent = "0";
  const startAt = performance.now() + INTRO_COUNT_DELAY_MS;
  const step = (now) => {
    if (!text.isConnected) return;
    const progress = Math.min(1, Math.max(0, (now - startAt) / INTRO_COUNT_DURATION_MS));
    text.textContent = String(Math.round(HERO_SCORE * (1 - (1 - progress) ** 3)));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // 描画が止められて requestAnimationFrame が進まない時も、最後は必ず90点で止める。
  window.setTimeout(() => {
    if (text.isConnected) text.textContent = String(HERO_SCORE);
  }, INTRO_COUNT_DELAY_MS + INTRO_COUNT_DURATION_MS + 100);
}

// 演出はページを開いてから1回だけ。トップへ戻って描き直した時は完成形のまま見せる。
let introPlayed = false;

function prepareIntro(thread) {
  if (introPlayed || prefersReducedMotion()) return;
  const play = () => {
    if (introPlayed || !thread.isConnected) return;
    introPlayed = true;
    thread.classList.remove("is-intro-ready");
    thread.classList.add("is-intro");
    countUpScore(thread);
  };
  if (typeof IntersectionObserver !== "function") {
    play();
    return;
  }
  thread.classList.add("is-intro-ready");
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    play();
  }, { threshold: 0.35 });
  observer.observe(thread);
}

export function applyHeroLive(root = document) {
  const live = root.querySelector?.("[data-hero-live]");
  const getLobbyStats = window.HariaiOnline?.getLobbyStats;
  // 人数をまだ読めない時は、描いた時の表示をそのまま残す。
  if (!live || typeof getLobbyStats !== "function") return;
  live.dataset.heroLive = heroLiveState(getLobbyStats()?.solo);
}

export function bindLandingHero(root = document) {
  const stage = root.querySelector?.("[data-landing-hero]");
  if (!stage || stage.dataset.heroBound === "1") return;
  stage.dataset.heroBound = "1";
  stage.addEventListener("click", (event) => {
    const chip = event.target.closest?.("[data-hero-persona]");
    if (chip) applyPersona(stage, chip.dataset.heroPersona);
  });
  const thread = stage.querySelector(".vl-hero-thread");
  if (thread) prepareIntro(thread);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("hariai-landing-rendered", () => bindLandingHero());
  window.addEventListener("hariai-lobby-stats-updated", () => applyHeroLive());
  // app.js が先にトップを描いていた場合に備えて、読み込んだ時点でも結び付ける。
  bindLandingHero();
  applyHeroLive();
}
