export const MAX_EQUIPPED_STAMPS = 6;
export const STAMP_COOLDOWN_MS = 2_000;

const asset = (id) => new URL(`./assets/stamps/${id}.webp`, import.meta.url).href;

export const FREE_STAMPS = Object.freeze([
  { id: "stamp_like", type: "stamp", name: "いいね！", label: "いいね！", description: "気軽に送れる定番スタンプ", asset: asset("stamp_like"), free: true },
  { id: "stamp_cute", type: "stamp", name: "かわいい！", label: "かわいい！", description: "かわいさが刺さったときの定番スタンプ", asset: asset("stamp_cute"), free: true },
  { id: "stamp_surprise", type: "stamp", name: "びっくり！", label: "びっくり！", description: "意外な一枚への定番スタンプ", asset: asset("stamp_surprise"), free: true },
  { id: "stamp_thanks", type: "stamp", name: "ありがとう", label: "ありがとう", description: "対戦相手へ感謝を伝える定番スタンプ", asset: asset("stamp_thanks"), free: true },
]);

export const STAMP_PRODUCTS = Object.freeze([
  { id: "stamp_god_photo", type: "stamp", category: "praise", name: "神写真", label: "神写真！", description: "王冠級の一枚を全力で称賛", price: 180, asset: asset("stamp_god_photo") },
  { id: "stamp_genius", type: "stamp", category: "praise", name: "センス天才", label: "センス天才！", description: "発想や組み合わせの妙を称賛", price: 220, asset: asset("stamp_genius") },
  { id: "stamp_best_shot", type: "stamp", category: "praise", name: "最高の一枚", label: "最高の一枚！", description: "ベストショットへ贈るカメラスタンプ", price: 240, asset: asset("stamp_best_shot") },
  { id: "stamp_more", type: "stamp", category: "praise", name: "もっと見たい", label: "もっと見たい！", description: "次の画像への期待を伝える", price: 260, asset: asset("stamp_more") },
  { id: "stamp_hit", type: "stamp", category: "battle", name: "刺さった", label: "刺さった！", description: "好みのど真ん中を認める", price: 200, asset: asset("stamp_hit") },
  { id: "stamp_defeated", type: "stamp", category: "battle", name: "完敗です", label: "完敗です", description: "気持ちよく負けを認める白旗", price: 220, asset: asset("stamp_defeated") },
  { id: "stamp_pursuit", type: "stamp", category: "battle", name: "追撃きた", label: "追撃きた！", description: "怒涛の追撃に反応する", price: 260, asset: asset("stamp_pursuit") },
  { id: "stamp_not_over", type: "stamp", category: "battle", name: "まだ終わらない", label: "まだ終わらない！", description: "逆転をあきらめない気持ちを表現", price: 280, asset: asset("stamp_not_over") },
  { id: "stamp_thinking", type: "stamp", category: "strategy", name: "推理中", label: "推理中…", description: "弱点を考えていることを示す", price: 220, asset: asset("stamp_thinking") },
  { id: "stamp_read", type: "stamp", category: "strategy", name: "読まれた", label: "読まれた！", description: "駆け引きを見抜かれた瞬間に", price: 240, asset: asset("stamp_read") },
  { id: "stamp_bluff", type: "stamp", category: "strategy", name: "ナイスブラフ", label: "ナイスブラフ！", description: "うまい偽情報をたたえる", price: 280, asset: asset("stamp_bluff") },
  { id: "stamp_weakness", type: "stamp", category: "strategy", name: "弱点発見", label: "弱点発見！", description: "本当の弱点を射抜いたときに", price: 300, asset: asset("stamp_weakness") },
  { id: "stamp_partner", type: "stamp", category: "team", name: "相方ナイス", label: "相方ナイス！", description: "2on2の相方を称賛する", price: 180, asset: asset("stamp_partner") },
  { id: "stamp_success", type: "stamp", category: "team", name: "作戦成功", label: "作戦成功！", description: "チームの狙いが決まったときに", price: 220, asset: asset("stamp_success") },
  { id: "stamp_leave_it", type: "stamp", category: "team", name: "任せた", label: "任せた！", description: "相方へ意志を託す敬礼スタンプ", price: 240, asset: asset("stamp_leave_it") },
  { id: "stamp_combo", type: "stamp", category: "team", name: "コンボ成立", label: "コンボ成立！", description: "TEAM LINKの成功を祝う", price: 280, asset: asset("stamp_combo") },
  { id: "stamp_survived", type: "stamp", category: "royale", name: "生き残った", label: "生き残った！", description: "脱落を回避した安堵を表現", price: 220, asset: asset("stamp_survived") },
  { id: "stamp_close_call", type: "stamp", category: "royale", name: "危なかった", label: "危なかった！", description: "紙一重の投票結果に", price: 260, asset: asset("stamp_close_call") },
  { id: "stamp_champion", type: "stamp", category: "royale", name: "優勝", label: "優勝！", description: "最後まで勝ち残った王者スタンプ", price: 300, asset: asset("stamp_champion") },
  { id: "stamp_last_card", type: "stamp", category: "royale", name: "最後の一枚", label: "最後の一枚！", description: "勝負を決める最終カードに", price: 350, asset: asset("stamp_last_card") },
]);

export const ALL_STAMPS = Object.freeze([...FREE_STAMPS, ...STAMP_PRODUCTS]);
const stampMap = new Map(ALL_STAMPS.map((stamp) => [stamp.id, stamp]));
const freeStampIds = new Set(FREE_STAMPS.map((stamp) => stamp.id));
const cooldowns = new Map();

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[character]));

export function getStamp(stampId) {
  return stampMap.get(String(stampId || "")) || null;
}

export function isFreeStamp(stampId) {
  return freeStampIds.has(String(stampId || ""));
}

export function normalizeEquippedStamps(source, inventory, hasSavedEquipment = true) {
  const owned = STAMP_PRODUCTS.filter((stamp) => inventory?.[stamp.id] === true);
  const selected = hasSavedEquipment
    ? owned.filter((stamp) => source?.equipped?.stamps?.[stamp.id] === true)
    : owned;
  return Object.fromEntries(selected.slice(0, MAX_EQUIPPED_STAMPS).map((stamp) => [stamp.id, true]));
}

export function getAvailableStamps(economy, { freeOnly = false } = {}) {
  if (freeOnly) return [...FREE_STAMPS];
  const paid = STAMP_PRODUCTS.filter((stamp) => economy?.inventory?.[stamp.id] === true && economy?.equipped?.stamps?.[stamp.id] === true);
  return [...FREE_STAMPS, ...paid];
}

export function canUseStamp(stampId, economy, { freeOnly = false } = {}) {
  if (isFreeStamp(stampId)) return true;
  if (freeOnly) return false;
  return economy?.inventory?.[stampId] === true && economy?.equipped?.stamps?.[stampId] === true && Boolean(getStamp(stampId));
}

export function acquireStampCooldown(channelKey, now = Date.now()) {
  const key = String(channelKey || "chat");
  const previous = Number(cooldowns.get(key) || 0);
  if (now - previous < STAMP_COOLDOWN_MS) return false;
  cooldowns.set(key, now);
  return true;
}

export function startStampButtonCooldown(selector, root = document) {
  const buttons = [...root.querySelectorAll(selector)];
  buttons.forEach((button) => { button.disabled = true; });
  window.setTimeout(() => buttons.forEach((button) => {
    if (button.isConnected) button.disabled = false;
  }), STAMP_COOLDOWN_MS);
}

export function renderStampBubble(stampId, classNames = "") {
  const stamp = getStamp(stampId);
  if (!stamp) return "";
  const classes = ["chat-stamp-bubble", classNames].filter(Boolean).join(" ");
  return `<div class="${escapeHtml(classes)}" role="img" aria-label="スタンプ：${escapeHtml(stamp.label)}"><img src="${escapeHtml(stamp.asset)}" alt="" draggable="false" /><span>${escapeHtml(stamp.label)}</span></div>`;
}

function renderStampButtons(stamps, attribute) {
  return stamps.map((stamp) => `<button class="stamp-button" type="button" ${attribute}="${escapeHtml(stamp.id)}" title="${escapeHtml(stamp.label)}"><img src="${escapeHtml(stamp.asset)}" alt="" draggable="false" /><span>${escapeHtml(stamp.label)}</span></button>`).join("");
}

export function renderChatTools({ id, textReactions, stamps, textAttribute, stampAttribute }) {
  const controlId = String(id || "chat-tools").replace(/[^a-zA-Z0-9_-]/g, "");
  return `<div class="chat-tool-picker" data-chat-tool-picker="${escapeHtml(controlId)}">
    <div class="chat-tool-tabs" role="tablist" aria-label="クイック送信の種類">
      <button class="chat-tool-tab is-active" type="button" role="tab" aria-selected="true" data-chat-tool-tab="words">ことば</button>
      <button class="chat-tool-tab" type="button" role="tab" aria-selected="false" data-chat-tool-tab="stamps">スタンプ</button>
    </div>
    <div class="chat-tool-panel" data-chat-tool-panel="words"><div class="quick-reactions">${textReactions.map((text) => `<button class="reaction-button" type="button" ${textAttribute}="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")}</div></div>
    <div class="chat-tool-panel" data-chat-tool-panel="stamps" hidden><div class="quick-stamps">${renderStampButtons(stamps, stampAttribute)}</div><small class="stamp-cooldown-note">スタンプは2秒に1回送信できます</small></div>
  </div>`;
}

export function bindChatToolTabs(root = document) {
  root.querySelectorAll("[data-chat-tool-picker]").forEach((picker) => {
    picker.querySelectorAll("[data-chat-tool-tab]").forEach((button) => button.addEventListener("click", () => {
      const target = button.dataset.chatToolTab;
      picker.querySelectorAll("[data-chat-tool-tab]").forEach((tab) => {
        const active = tab.dataset.chatToolTab === target;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      picker.querySelectorAll("[data-chat-tool-panel]").forEach((panel) => { panel.hidden = panel.dataset.chatToolPanel !== target; });
    }));
  });
}
