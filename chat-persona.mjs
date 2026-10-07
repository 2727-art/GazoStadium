// 女の子なりきりのチャット：口調ごとの吹き出し、言い方の演出、吹き出しへのリアクション、入力中の表示、名場面カード。
// ほかのモジュールに依存しない。DOMとCanvasを使う関数はブラウザだけで呼ぶ。

export const CHAT_PERSONA_VERSION = 1;

// 口調の6種は finish-roleplay.mjs の ROLEPLAY_VOICE_SETS と同じid。
export const CHAT_PERSONAS = Object.freeze([
  Object.freeze({ id: "tsuyotsuyo", label: "つよつよ", mark: "crown", markColor: "#f2c867", typing: "{name}が、言い返す言葉を選んでいます" }),
  Object.freeze({ id: "yowayowa", label: "よわよわ", mark: "tear", markColor: "#9fd8ff", typing: "{name}が、もじもじしながら打っています" }),
  Object.freeze({ id: "koakuma", label: "小悪魔", mark: "horns", markColor: "#ff4fa0", typing: "{name}が、くすくす笑いながら打っています♡" }),
  Object.freeze({ id: "oneesan", label: "お姉さん", mark: "lips", markColor: "#ff3f86", typing: "{name}が、ゆっくり言葉を選んでいます♡" }),
  Object.freeze({ id: "amaenbo", label: "甘えんぼ", mark: "ribbon", markColor: "#ffb3d9", typing: "{name}が、甘えた声で打っています♡" }),
  Object.freeze({ id: "seiso", label: "清楚", mark: "flower", markColor: "#d9c7ff", typing: "{name}が、丁寧に言葉を選んでいます" }),
]);

// 1行ごとの言い方。空文字は「ふつう」。
export const CHAT_EFFECTS = Object.freeze([
  Object.freeze({ id: "", label: "ふつう" }),
  Object.freeze({ id: "whisper", label: "ささやき" }),
  Object.freeze({ id: "emphasis", label: "強調" }),
  Object.freeze({ id: "tremble", label: "震え" }),
  Object.freeze({ id: "hearts", label: "ハート" }),
]);

// 相手の吹き出しに付けるリアクション。P2Pで送り、Firebaseには保存しない。
export const CHAT_REACTIONS = Object.freeze([
  Object.freeze({ id: "kiss", label: "口紅", icon: "lips", color: "#ff3f86" }),
  Object.freeze({ id: "crown", label: "王冠", icon: "crown", color: "#f2c867" }),
  Object.freeze({ id: "heart", label: "ハート", icon: "heart", color: "#ff7aa8" }),
  Object.freeze({ id: "tear", label: "なみだ", icon: "tear", color: "#8fd3ff" }),
  Object.freeze({ id: "bolt", label: "ぞくっ", icon: "bolt", color: "#ffd34d" }),
]);

// 24×24の塗りパス。CSSのマスク（chat-persona.css）とCanvasの描画で同じ形を使う。
export const CHAT_ICON_PATHS = Object.freeze({
  crown: "M3 18h18l-1.6-10-4.4 3.6L12 5 9 11.6 4.6 8z",
  tear: "M12 2.5c3.4 5 6.5 8.3 6.5 12a6.5 6.5 0 0 1-13 0c0-3.7 3.1-7 6.5-12z",
  horns: "M5 20c-1.5-4.5-1-10 3-15-.2 4 .8 7 3 9-2.3 1.5-4.4 3.6-6 6zM19 20c1.5-4.5 1-10-3-15 .2 4-.8 7-3 9 2.3 1.5 4.4 3.6 6 6z",
  lips: "M2 11.5C4.6 7.8 7.6 6.6 10 8.4c1.2-.9 2.8-.9 4 0 2.4-1.8 5.4-.6 8 3.1-2.6 3.8-6.2 6-10 6s-7.4-2.2-10-6zm4.2.2c2 1 3.9 1.4 5.8 1.4s3.8-.4 5.8-1.4c-2-.6-3.9-.8-5.8-.6-1.9-.2-3.8 0-5.8.6z",
  ribbon: "M12 10.2C9.4 6.4 4.2 4.6 3.1 7.4 2 10.2 5.6 13.4 10.4 12.2L7.6 19l3-1.2L12 21l1.4-3.2 3 1.2-2.8-6.8c4.8 1.2 8.4-2 7.3-4.8-1.1-2.8-6.3-1-8.9 2.8z",
  flower: "M8.6 6.2a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0M14.1 10.2a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0M12 16.6a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0M5.2 16.6a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0M3.1 10.2a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0",
  heart: "M12 21C9 18.3 2 14.2 2 8.6 2 5.5 4.4 3 7.4 3c1.8 0 3.5.9 4.6 2.3C13.1 3.9 14.8 3 16.6 3 19.6 3 22 5.5 22 8.6 22 14.2 15 18.3 12 21z",
  bolt: "M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.6z",
});

export const SHARE_CARD_MAX_MESSAGES = 10;
export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HASHTAGS = "#貼り合い #貼り合いスタジアム";
export const TYPING_SEND_INTERVAL_MS = 2500;
export const TYPING_VISIBLE_MS = 5000;

const PERSONA_IDS = new Set(CHAT_PERSONAS.map((persona) => persona.id));
const EFFECT_IDS = new Set(CHAT_EFFECTS.map((effect) => effect.id).filter(Boolean));
const REACTION_IDS = new Set(CHAT_REACTIONS.map((reaction) => reaction.id));

export function normalizeChatPersonaId(value) {
  const id = String(value ?? "");
  return PERSONA_IDS.has(id) ? id : "";
}

export function getChatPersona(value) {
  const id = normalizeChatPersonaId(value);
  return CHAT_PERSONAS.find((persona) => persona.id === id) || null;
}

export function normalizeChatEffect(value) {
  const id = String(value ?? "");
  return EFFECT_IDS.has(id) ? id : "";
}

export function normalizeChatReactionId(value) {
  const id = String(value ?? "");
  return REACTION_IDS.has(id) ? id : "";
}

export function getChatReaction(value) {
  const id = normalizeChatReactionId(value);
  return CHAT_REACTIONS.find((reaction) => reaction.id === id) || null;
}

function shortName(name) {
  const text = Array.from(String(name ?? "").replace(/[\r\n\t]+/g, " ").trim()).slice(0, 16).join("");
  return text || "相手";
}

export function personaTypingText(personaId, name) {
  const persona = getChatPersona(personaId);
  const template = persona?.typing || "{name}が入力しています";
  return template.replace("{name}", shortName(name));
}

// 購入した枠・背景がある時はそちらを優先し、ない時だけ口調の吹き出しを使う。
export function chatPersonaBubbleClass(personaId, cosmeticClasses = "") {
  if (String(cosmeticClasses || "").trim()) return "";
  const persona = getChatPersona(personaId);
  return persona ? `chat-cosmetic-bubble chat-persona-bubble chat-persona-${persona.id}` : "";
}

export function chatEffectClass(effect) {
  const id = normalizeChatEffect(effect);
  return id ? `chat-fx chat-fx-${id}` : "";
}

export function escapeChatHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

// 「震え」は1文字ずつ揺らすので文字ごとに包む。ほかは文字列のまま。
export function renderChatEffectText(text, effect) {
  const id = normalizeChatEffect(effect);
  if (id !== "tremble") return escapeChatHtml(text);
  return Array.from(String(text ?? "")).map((character, index) => (
    character.trim()
      ? `<span class="chat-fx-char" style="--i:${index % 7}">${escapeChatHtml(character)}</span>`
      : escapeChatHtml(character)
  )).join("");
}

export function renderChatPersonaMark(personaId) {
  const persona = getChatPersona(personaId);
  if (!persona) return "";
  return `<span class="chat-persona-mark is-${persona.id}" role="img" aria-label="${escapeChatHtml(persona.label)}" title="${escapeChatHtml(persona.label)}"></span>`;
}

export function renderChatReactionSticker(reactionId, { fresh = false } = {}) {
  const reaction = getChatReaction(reactionId);
  if (!reaction) return "";
  return `<span class="chat-reaction-sticker is-${reaction.id}${fresh ? " is-fresh" : ""}" role="img" aria-label="リアクション：${escapeChatHtml(reaction.label)}"></span>`;
}

export function renderChatReactionPicker(messageId, currentId = "") {
  const current = normalizeChatReactionId(currentId);
  const buttons = CHAT_REACTIONS.map((reaction) => `<button type="button" class="chat-react-option is-${reaction.id}" data-chat-react-pick="${reaction.id}" aria-pressed="${current === reaction.id}" aria-label="${escapeChatHtml(reaction.label)}" title="${escapeChatHtml(reaction.label)}"></button>`).join("");
  const remove = current ? '<button type="button" class="chat-react-remove" data-chat-react-pick="">外す</button>' : "";
  return `<div class="chat-react-picker" data-chat-react-picker="${escapeChatHtml(messageId)}" role="group" aria-label="リアクションを選ぶ">${buttons}${remove}</div>`;
}

export function renderChatEffectPicker(currentEffect = "", { disabled = false } = {}) {
  const current = normalizeChatEffect(currentEffect);
  return `<div class="chat-effect-picker" role="group" aria-label="言い方">${CHAT_EFFECTS.map((effect) => (
    `<button type="button" class="chat-effect-chip${effect.id ? ` is-${effect.id}` : ""}" data-chat-effect="${effect.id}" aria-pressed="${current === effect.id}"${disabled ? " disabled" : ""}>${escapeChatHtml(effect.label)}</button>`
  )).join("")}</div>`;
}

/*
  名場面カードに載せる内容を決める。
  ・載せるのは選ばれた発言だけ（最大10件）。画像・UID・部屋の情報は含めない。
  ・相手が許可していない時は、相手の名前を「相手」にし、発言はぼかした帯に置き換える（文字数も出さない）。
*/
export function buildShareCardModel({
  messages = [],
  selectedIds = [],
  localUid = "",
  players = [],
  consentGranted = false,
  hideOwnName = false,
  includeResult = true,
  result = null,
  modeLabel = "通常型1on1",
  reactions = new Map(),
  maxMessages = SHARE_CARD_MAX_MESSAGES,
} = {}) {
  const selected = new Set(selectedIds);
  const playerIndexByUid = new Map(players.map((player, index) => [player?.uid, index]));
  const items = messages
    .filter((message) => message && selected.has(message.id))
    .slice(0, maxMessages)
    .map((message) => {
      const local = message.authorUid === localUid;
      const masked = !local && !consentGranted;
      const playerIndex = playerIndexByUid.has(message.authorUid) ? playerIndexByUid.get(message.authorUid) : (local ? 0 : 1);
      const stampId = String(message.stampId || "");
      return {
        id: String(message.id || ""),
        side: playerIndex === 1 ? "right" : "left",
        local,
        masked,
        name: masked ? "相手" : local && hideOwnName ? "わたし" : shortName(message.name),
        kind: stampId ? "stamp" : "text",
        text: masked ? "" : String(message.text || "").slice(0, 80),
        stampId: masked ? "" : stampId,
        personaId: normalizeChatPersonaId(message.voiceSetId),
        effect: masked ? "" : normalizeChatEffect(message.effect),
        frameId: String(message.chatFrameId || ""),
        backgroundId: String(message.chatBackgroundId || ""),
        reactionId: normalizeChatReactionId(reactions.get?.(message.id) || ""),
        round: Number(message.round) || 0,
      };
    });
  const resultLine = includeResult && result
    ? [String(result.result || ""), ...(Array.isArray(result.details) ? result.details : [])].filter(Boolean).join("  ·  ")
    : "";
  return {
    title: `${modeLabel}の名場面`,
    resultLine,
    items,
    hasMaskedLines: items.some((item) => item.masked),
  };
}

// 日本語は文字単位、英数字は単語をなるべく切らずに折り返す。
export function wrapChatText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    const tokens = paragraph.match(/[A-Za-z0-9'’.,!?\-]+\s*|\s+|./gu) || [""];
    let line = "";
    for (const token of tokens) {
      const candidate = line + token;
      if (!line || measure(candidate) <= maxWidth) {
        line = candidate;
        if (measure(line) > maxWidth) {
          // 1語が長すぎる時は文字単位で割る
          let piece = "";
          for (const character of Array.from(line)) {
            if (piece && measure(piece + character) > maxWidth) {
              lines.push(piece);
              piece = character;
            } else {
              piece += character;
            }
          }
          line = piece;
        }
      } else {
        lines.push(line.trimEnd());
        line = token.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}

// 発言ごとの縦の大きさを決める（Canvasなしで確かめられるよう、文字幅の測り方は外から渡す）。
export function layoutShareCard(model, measure, {
  width = SHARE_CARD_WIDTH,
  padding = 64,
  headerHeight = 220,
  footerHeight = 150,
  nameHeight = 44,
  gap = 34,
  bubblePaddingX = 30,
  bubblePaddingY = 22,
  lineHeight = 52,
  stampHeight = 220,
  maxBubbleRatio = 0.78,
} = {}) {
  const maxBubbleWidth = Math.round((width - padding * 2) * maxBubbleRatio);
  const textWidth = maxBubbleWidth - bubblePaddingX * 2;
  let y = padding + headerHeight;
  const items = model.items.map((item) => {
    const scale = item.effect === "whisper" ? 0.86 : item.effect === "emphasis" ? 1.2 : 1;
    let lines = [];
    let contentWidth;
    let contentHeight;
    if (item.masked) {
      contentWidth = Math.round(textWidth * 0.72);
      contentHeight = Math.round(lineHeight * 1.6);
    } else if (item.kind === "stamp") {
      contentWidth = stampHeight;
      contentHeight = stampHeight + lineHeight;
    } else {
      lines = wrapChatText(item.text, textWidth / scale, measure);
      contentWidth = Math.min(textWidth, Math.ceil(Math.max(...lines.map((line) => measure(line))) * scale));
      contentHeight = Math.round(lines.length * lineHeight * scale);
    }
    const bubbleWidth = Math.max(120, contentWidth + bubblePaddingX * 2);
    const bubbleHeight = contentHeight + bubblePaddingY * 2;
    const x = item.side === "right" ? width - padding - bubbleWidth : padding;
    const top = y;
    y += nameHeight + bubbleHeight + gap;
    return { ...item, lines, scale, x, nameY: top, bubbleY: top + nameHeight, bubbleWidth, bubbleHeight };
  });
  return { width, height: y - gap + footerHeight + padding, padding, items, lineHeight, bubblePaddingX, bubblePaddingY, stampHeight };
}

/* ---------- ここから下はブラウザ専用 ---------- */

function parseColors(value) {
  return String(value || "").match(/rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g) || [];
}

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of String(value || "")) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseGlow(shadow) {
  let best = null;
  for (const part of splitTopLevel(shadow)) {
    if (/inset/.test(part)) continue;
    const color = parseColors(part)[0];
    const numbers = part.replace(/rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g, "").match(/-?[\d.]+px|-?[\d.]+/g) || [];
    const blur = Number.parseFloat(numbers[2] || "0") || 0;
    if (color && (!best || blur > best.blur)) best = { color, blur };
  }
  return best;
}

function parseRadius(value) {
  const first = String(value || "").split("/")[0].trim().split(/\s+/);
  const read = (token) => (token && token.endsWith("%") ? 22 : Number.parseFloat(token) || 0);
  const tl = read(first[0]);
  const tr = first[1] ? read(first[1]) : tl;
  const br = first[2] ? read(first[2]) : tl;
  const bl = first[3] ? read(first[3]) : tr;
  return [tl, tr, br, bl].map((radius) => Math.min(48, radius * 2));
}

// 画面と同じCSSの変数を読み、Canvasでの吹き出しの色・線・光を決める。
function resolveBubbleStyle(className, fallback) {
  if (!className) return fallback;
  const probe = document.createElement("p");
  probe.className = className;
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const read = (name) => style.getPropertyValue(name).trim();
  const after = getComputedStyle(probe, "::after").content;
  const resolved = {
    surface: parseColors(read("--chat-surface")),
    text: read("--chat-text") || fallback.text,
    border: read("--chat-border") || fallback.border,
    borderWidth: Number.parseFloat(read("--chat-border-width")) || 1,
    borderStyle: read("--chat-border-style") || "solid",
    glow: parseGlow(read("--chat-shadow")),
    radius: parseRadius(read("--chat-radius") || "13px"),
    charm: after && after !== "none" && after !== "normal" ? after.replace(/^["']|["']$/g, "") : "",
    charmColor: read("--chat-charm-color") || "#ffffff",
  };
  probe.remove();
  if (!resolved.surface.length) resolved.surface = fallback.surface;
  return resolved;
}

function roundedRectPath(context, x, y, width, height, [tl, tr, br, bl]) {
  context.beginPath();
  context.moveTo(x + tl, y);
  context.lineTo(x + width - tr, y);
  context.quadraticCurveTo(x + width, y, x + width, y + tr);
  context.lineTo(x + width, y + height - br);
  context.quadraticCurveTo(x + width, y + height, x + width - br, y + height);
  context.lineTo(x + bl, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - bl);
  context.lineTo(x, y + tl);
  context.quadraticCurveTo(x, y, x + tl, y);
  context.closePath();
}

function drawIcon(context, iconName, x, y, size, color) {
  const path = CHAT_ICON_PATHS[iconName];
  if (!path || typeof Path2D === "undefined") return;
  context.save();
  context.translate(x, y);
  context.scale(size / 24, size / 24);
  context.fillStyle = color;
  context.fill(new Path2D(path), "evenodd");
  context.restore();
}

function loadImage(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

const PLAIN_LEFT = { surface: ["rgba(138, 26, 69, 0.55)", "rgba(92, 15, 46, 0.55)"], text: "#f8eef2", border: "rgba(255, 74, 95, 0.35)", borderWidth: 1, borderStyle: "solid", glow: null, radius: [8, 24, 24, 24], charm: "", charmColor: "#fff" };
const PLAIN_RIGHT = { surface: ["rgba(44, 27, 47, 0.95)", "rgba(31, 20, 35, 0.95)"], text: "#f8eef2", border: "rgba(77, 232, 223, 0.3)", borderWidth: 1, borderStyle: "solid", glow: null, radius: [24, 8, 24, 24], charm: "", charmColor: "#fff" };

export async function drawShareCard(canvas, model, {
  cosmeticClasses = () => "",
  getStamp = () => null,
  localFrameLabel = "",
} = {}) {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  const bodyFont = getComputedStyle(document.body).fontFamily || "sans-serif";
  const displayFont = document.fonts?.check?.('32px "Dela Gothic One"') ? '"Dela Gothic One", ' + bodyFont : bodyFont;
  const context = canvas.getContext("2d");
  const baseSize = 34;
  context.font = `500 ${baseSize}px ${bodyFont}`;
  const layout = layoutShareCard(model, (text) => context.measureText(text).width);
  canvas.width = layout.width;
  canvas.height = layout.height;

  // 背景：夜の部屋とローズの光
  const ground = context.createLinearGradient(0, 0, 0, layout.height);
  ground.addColorStop(0, "#160b18");
  ground.addColorStop(1, "#0b0710");
  context.fillStyle = ground;
  context.fillRect(0, 0, layout.width, layout.height);
  const glow = context.createRadialGradient(layout.width / 2, 0, 0, layout.width / 2, 0, layout.width * 0.9);
  glow.addColorStop(0, "rgba(255, 63, 134, 0.28)");
  glow.addColorStop(1, "rgba(255, 63, 134, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, layout.width, layout.height);

  // 見出し
  context.textBaseline = "alphabetic";
  context.fillStyle = "#ff8ab6";
  context.font = `700 28px ${bodyFont}`;
  context.fillText("HARIAI STADIUM", layout.padding, layout.padding + 30);
  context.fillStyle = "#f8eef2";
  context.font = `400 56px ${displayFont}`;
  context.fillText(model.title, layout.padding, layout.padding + 104);
  if (model.resultLine) {
    context.fillStyle = "#e6c17a";
    context.font = `700 30px ${bodyFont}`;
    context.fillText(model.resultLine, layout.padding, layout.padding + 160);
  }
  context.fillStyle = "rgba(248, 238, 242, 0.12)";
  context.fillRect(layout.padding, layout.padding + 190, layout.width - layout.padding * 2, 2);

  const stampImages = new Map();
  await Promise.all(layout.items.filter((item) => item.kind === "stamp" && item.stampId).map(async (item) => {
    const stamp = getStamp(item.stampId);
    if (stamp?.asset) stampImages.set(item.stampId, { stamp, image: await loadImage(stamp.asset) });
  }));

  for (const item of layout.items) {
    const cosmetic = cosmeticClasses(item.frameId, item.backgroundId);
    const personaClass = chatPersonaBubbleClass(item.personaId, cosmetic);
    const fallback = item.side === "right" ? PLAIN_RIGHT : PLAIN_LEFT;
    const style = resolveBubbleStyle(cosmetic || personaClass, fallback);
    const persona = getChatPersona(item.personaId);

    // 名前の行
    const nameX = item.side === "right" ? item.x + item.bubbleWidth : item.x;
    context.font = `700 26px ${bodyFont}`;
    const label = `${item.name}${item.round ? ` / R${item.round}` : ""}`;
    const labelWidth = context.measureText(label).width;
    const markSize = persona ? 28 : 0;
    const totalWidth = labelWidth + (markSize ? markSize + 8 : 0);
    const startX = item.side === "right" ? nameX - totalWidth : nameX;
    if (persona) drawIcon(context, persona.mark, startX, item.nameY + 2, markSize, persona.markColor);
    context.fillStyle = "rgba(248, 238, 242, 0.62)";
    context.fillText(label, startX + (markSize ? markSize + 8 : 0), item.nameY + 26);

    // 吹き出し
    context.save();
    roundedRectPath(context, item.x, item.bubbleY, item.bubbleWidth, item.bubbleHeight, style.radius);
    const fill = context.createLinearGradient(item.x, item.bubbleY, item.x + item.bubbleWidth, item.bubbleY + item.bubbleHeight);
    const colors = style.surface.length ? style.surface : fallback.surface;
    colors.forEach((color, index) => fill.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), color));
    if (colors.length === 1) fill.addColorStop(1, colors[0]);
    if (style.glow && style.glow.blur > 0) {
      context.shadowColor = style.glow.color;
      context.shadowBlur = Math.min(48, style.glow.blur * 2);
    }
    context.fillStyle = fill;
    context.fill();
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.lineWidth = Math.max(1.5, style.borderWidth * 2);
    context.strokeStyle = style.border;
    if (style.borderStyle === "dashed") context.setLineDash([14, 8]);
    if (style.borderStyle === "dotted") context.setLineDash([3, 7]);
    context.stroke();
    context.setLineDash([]);
    if (style.borderStyle === "double") {
      roundedRectPath(context, item.x + 6, item.bubbleY + 6, item.bubbleWidth - 12, item.bubbleHeight - 12, style.radius.map((radius) => Math.max(0, radius - 6)));
      context.lineWidth = 1.5;
      context.stroke();
    }
    context.restore();

    // 中身
    const innerX = item.x + layout.bubblePaddingX;
    const innerY = item.bubbleY + layout.bubblePaddingY;
    if (item.masked) {
      context.save();
      context.globalAlpha = 0.5;
      context.fillStyle = style.text;
      const barHeight = 22;
      roundedRectPath(context, innerX, innerY + 6, (item.bubbleWidth - layout.bubblePaddingX * 2) * 0.92, barHeight, [11, 11, 11, 11]);
      context.fill();
      roundedRectPath(context, innerX, innerY + 6 + barHeight + 16, (item.bubbleWidth - layout.bubblePaddingX * 2) * 0.58, barHeight, [11, 11, 11, 11]);
      context.fill();
      context.restore();
    } else if (item.kind === "stamp") {
      const entry = stampImages.get(item.stampId);
      if (entry?.image) context.drawImage(entry.image, innerX, innerY, layout.stampHeight, layout.stampHeight);
      context.fillStyle = style.text;
      context.font = `700 28px ${bodyFont}`;
      context.fillText(entry?.stamp?.label || "スタンプ", innerX, innerY + layout.stampHeight + 38);
    } else {
      const size = Math.round(baseSize * item.scale);
      context.font = `${item.effect === "emphasis" ? 800 : 500} ${size}px ${bodyFont}`;
      context.fillStyle = style.text;
      context.globalAlpha = item.effect === "whisper" ? 0.8 : 1;
      if (item.effect === "emphasis") {
        context.shadowColor = style.border;
        context.shadowBlur = 14;
      }
      item.lines.forEach((line, lineIndex) => {
        const baseline = innerY + (lineIndex + 1) * layout.lineHeight * item.scale - 14 * item.scale;
        if (item.effect === "tremble") {
          let cursor = innerX;
          Array.from(line).forEach((character, index) => {
            const offsetX = ((index * 37) % 5) - 2;
            const offsetY = ((index * 53) % 7) - 3;
            context.fillText(character, cursor + offsetX, baseline + offsetY);
            cursor += context.measureText(character).width;
          });
        } else {
          context.fillText(line, innerX, baseline);
        }
      });
      context.globalAlpha = 1;
      context.shadowColor = "transparent";
      context.shadowBlur = 0;
    }

    if (item.effect === "hearts") {
      drawIcon(context, "heart", item.x - 14, item.bubbleY - 18, 30, "#ff7aa8");
      drawIcon(context, "heart", item.x + item.bubbleWidth - 18, item.bubbleY + item.bubbleHeight - 16, 24, "#ff3f86");
      drawIcon(context, "heart", item.x + item.bubbleWidth * 0.55, item.bubbleY - 22, 20, "#ffb3d9");
    }
    if (style.charm) {
      context.fillStyle = style.charmColor;
      context.font = `700 30px ${bodyFont}`;
      context.fillText(style.charm, item.x + item.bubbleWidth - 14, item.bubbleY + 8);
    }
    const reaction = getChatReaction(item.reactionId);
    if (reaction) {
      const badgeX = item.side === "right" ? item.x - 18 : item.x + item.bubbleWidth - 30;
      const badgeY = item.bubbleY + item.bubbleHeight - 30;
      context.save();
      context.beginPath();
      context.arc(badgeX + 24, badgeY + 24, 26, 0, Math.PI * 2);
      context.fillStyle = "#1f1423";
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = reaction.color;
      context.stroke();
      context.restore();
      drawIcon(context, reaction.icon, badgeX + 10, badgeY + 10, 28, reaction.color);
    }
  }

  // 下の帯：名前とハッシュタグ。URLは入れない。
  const footerTop = layout.height - layout.padding - 110;
  context.fillStyle = "rgba(248, 238, 242, 0.12)";
  context.fillRect(layout.padding, footerTop, layout.width - layout.padding * 2, 2);
  context.fillStyle = "#f8eef2";
  context.font = `400 40px ${displayFont}`;
  context.fillText("貼り合いスタジアム", layout.padding, footerTop + 66);
  context.fillStyle = "rgba(248, 238, 242, 0.55)";
  context.font = `600 24px ${bodyFont}`;
  const credit = [localFrameLabel ? `吹き出し：${localFrameLabel}` : "", model.hasMaskedLines ? "相手の発言はぼかしています" : ""].filter(Boolean).join("  ·  ");
  if (credit) context.fillText(credit, layout.padding, footerTop + 104);
  context.textAlign = "right";
  context.fillStyle = "#ff8ab6";
  context.font = `700 26px ${bodyFont}`;
  context.fillText(SHARE_CARD_HASHTAGS, layout.width - layout.padding, footerTop + 66);
  context.textAlign = "left";
  return layout;
}

/*
  名場面カードの画面。結果画面から開く。
  options:
    messages, localUid, players, result, modeLabel, reactions (Map),
    cosmeticClasses(frameId, backgroundId), getStamp(id), localFrameLabel,
    getConsent() → "none" | "pending" | "granted" | "denied" | "unavailable",
    requestConsent() → 相手へ許可のお願いを送る（送れない時は false）
  返り値の controller.refresh() で、許可の状態が変わった時に描き直す。
*/
export function openShareCardDialog(options) {
  const messages = (options.messages || []).filter((message) => message && (message.text || message.stampId));
  const textOnly = messages.filter((message) => !message.stampId);
  const defaultSelected = (textOnly.length ? textOnly : messages).slice(-8).map((message) => message.id);
  const view = { selected: new Set(defaultSelected), includeResult: true, hideOwnName: false, blob: null, renderToken: 0 };
  const dialog = document.createElement("dialog");
  dialog.className = "share-card-dialog";
  dialog.setAttribute("aria-labelledby", "shareCardTitle");
  const canShareFiles = Boolean(navigator.canShare && typeof File !== "undefined"
    && navigator.canShare({ files: [new File([new Blob(["x"], { type: "image/png" })], "probe.png", { type: "image/png" })] }));

  const consentText = () => {
    const status = options.getConsent?.() || "none";
    if (status === "granted") return { status, text: "相手が許可しました。相手の名前と発言もそのまま載せます。" };
    if (status === "pending") return { status, text: "相手の返事を待っています。返事が来るまで、相手の発言はぼかして載せます。" };
    if (status === "denied") return { status, text: "相手は今回は見送りました。相手の名前と発言はぼかして載せます。" };
    if (status === "unavailable") return { status, text: "相手との接続が切れているため、相手の名前と発言はぼかして載せます。" };
    return { status, text: "相手の名前と発言は、相手が許可した時だけそのまま載せます。今はぼかして載せます。" };
  };

  const renderList = () => messages.map((message) => {
    const local = message.authorUid === options.localUid;
    const checked = view.selected.has(message.id);
    const body = message.stampId ? `スタンプ：${options.getStamp?.(message.stampId)?.label || ""}` : message.text;
    return `<label class="share-card-pick${local ? " is-local" : " is-remote"}"><input type="checkbox" data-share-pick="${escapeChatHtml(message.id)}"${checked ? " checked" : ""} /><span><b>${escapeChatHtml(local ? message.name : `${message.name}（相手）`)} / R${Number(message.round) || 0}</b>${escapeChatHtml(body)}</span></label>`;
  }).join("");

  const shell = () => {
    const consent = consentText();
    const canRequest = consent.status === "none";
    dialog.innerHTML = `<div class="share-card-sheet">
      <header class="share-card-head"><div><span>MEMORABLE SCENE</span><h2 id="shareCardTitle">名場面カード</h2></div><button type="button" class="share-card-close" data-share-close aria-label="名場面カードを閉じる">×</button></header>
      <p class="share-card-lead">吹き出しを選ぶと、そのままの見た目で1枚の画像にします。対戦の画像は入りません。</p>
      <section class="share-card-consent is-${consent.status}" aria-live="polite"><p>${escapeChatHtml(consent.text)}</p>${canRequest ? '<button type="button" class="button button-ghost button-small" data-share-request>相手に掲載の許可をお願いする</button>' : ""}</section>
      <div class="share-card-body">
        <div class="share-card-list" role="group" aria-label="載せる発言（最大${SHARE_CARD_MAX_MESSAGES}件）"><p class="share-card-count" data-share-count></p>${renderList()}</div>
        <div class="share-card-preview">
          <div class="share-card-options">
            <label><input type="checkbox" data-share-option="includeResult"${view.includeResult ? " checked" : ""} />結果をのせる</label>
            <label><input type="checkbox" data-share-option="hideOwnName"${view.hideOwnName ? " checked" : ""} />自分の名前を隠す</label>
          </div>
          <canvas class="share-card-canvas" data-share-canvas aria-label="名場面カードのプレビュー"></canvas>
        </div>
      </div>
      <footer class="share-card-actions">
        ${canShareFiles ? '<button type="button" class="button button-primary" data-share-native>共有する</button>' : ""}
        <button type="button" class="button ${canShareFiles ? "button-ghost" : "button-primary"}" data-share-save>画像を保存</button>
      </footer>
      <p class="share-card-note">Xなどへ投稿する時は、内容に応じて「センシティブな内容」の設定をしてください。ポスト本文にURLは入りません。</p>
    </div>`;
  };

  const updateCount = () => {
    const count = dialog.querySelector("[data-share-count]");
    if (count) count.textContent = `載せる発言 ${view.selected.size} / ${SHARE_CARD_MAX_MESSAGES}`;
    dialog.querySelectorAll("[data-share-pick]").forEach((input) => {
      input.disabled = !input.checked && view.selected.size >= SHARE_CARD_MAX_MESSAGES;
    });
    const empty = view.selected.size === 0;
    dialog.querySelectorAll("[data-share-native], [data-share-save]").forEach((button) => { button.disabled = empty; });
  };

  const renderPreview = async () => {
    const token = ++view.renderToken;
    const canvas = dialog.querySelector("[data-share-canvas]");
    if (!canvas) return;
    view.blob = null;
    const model = buildShareCardModel({
      messages,
      selectedIds: messages.map((message) => message.id).filter((id) => view.selected.has(id)),
      localUid: options.localUid,
      players: options.players,
      consentGranted: (options.getConsent?.() || "none") === "granted",
      hideOwnName: view.hideOwnName,
      includeResult: view.includeResult,
      result: options.result,
      modeLabel: options.modeLabel,
      reactions: options.reactions,
    });
    await drawShareCard(canvas, model, {
      cosmeticClasses: options.cosmeticClasses,
      getStamp: options.getStamp,
      localFrameLabel: options.localFrameLabel,
    });
    if (token !== view.renderToken) return;
    // iPhoneの共有はボタンを押した直後に呼ぶ必要があるので、画像は先に作っておく。
    canvas.toBlob((blob) => { if (token === view.renderToken) view.blob = blob; }, "image/png");
  };

  const fileName = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `hariai-meibamen-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.png`;
  };

  const shareText = `貼り合いスタジアム｜${options.modeLabel || "通常型1on1"}の名場面\n${SHARE_CARD_HASHTAGS}`;

  dialog.addEventListener("change", (event) => {
    const pick = event.target.closest?.("[data-share-pick]");
    if (pick) {
      if (pick.checked) view.selected.add(pick.dataset.sharePick);
      else view.selected.delete(pick.dataset.sharePick);
      updateCount();
      renderPreview();
      return;
    }
    const option = event.target.closest?.("[data-share-option]");
    if (option) {
      view[option.dataset.shareOption] = option.checked;
      renderPreview();
    }
  });

  // 閉じる処理は close イベントを待たずに行う（環境によってはイベントが遅れるため）。
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    view.renderToken += 1;
    if (dialog.open) dialog.close();
    dialog.remove();
    options.onClose?.();
  };

  dialog.addEventListener("click", async (event) => {
    if (event.target === dialog || event.target.closest("[data-share-close]")) {
      finish();
      return;
    }
    if (event.target.closest("[data-share-request]")) {
      options.requestConsent?.();
      controller.refresh();
      return;
    }
    if (event.target.closest("[data-share-native]")) {
      if (!view.blob) return;
      const file = new File([view.blob], fileName(), { type: "image/png" });
      try {
        await navigator.share({ files: [file], text: shareText });
      } catch (error) {
        // 共有シートを閉じただけなら何もしない
      }
      return;
    }
    if (event.target.closest("[data-share-save]")) {
      if (!view.blob) return;
      const url = URL.createObjectURL(view.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName();
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  dialog.addEventListener("close", finish);

  const controller = {
    refresh() {
      if (!dialog.isConnected) return;
      const list = dialog.querySelector(".share-card-list");
      const scrollTop = list?.scrollTop || 0;
      shell();
      const nextList = dialog.querySelector(".share-card-list");
      if (nextList) nextList.scrollTop = scrollTop;
      updateCount();
      renderPreview();
    },
    close: finish,
    isOpen: () => !finished && dialog.isConnected,
  };

  shell();
  document.body.append(dialog);
  dialog.showModal();
  updateCount();
  renderPreview();
  return controller;
}
