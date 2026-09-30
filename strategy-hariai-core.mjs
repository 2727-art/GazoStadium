// 戦略型1on1「貼り合い本式」（プロトコル v3）の対戦コア。
// ルームの moves をスロット順に再生して、手番・理性・権利・看破・決着を決定的に計算する。
// DOM、Firebase、WebRTC、乱数、時刻には依存しない。両クライアントが同じ入力から同じ結果を得ることが前提。

export const HARIAI_PROTOCOL_VERSION = 3;
export const HARIAI_REASON_MAX = 100;
export const HARIAI_HAND_SIZE = 10;
export const HARIAI_MAX_SLOTS = 30;
export const HARIAI_SCORE_MIN = 0;
export const HARIAI_SCORE_MAX = 100;
export const HARIAI_CAPTION_MAX = 80;
export const HARIAI_REPLY_MAX = 40;
export const HARIAI_FLAVOR_MAX = 40;
export const HARIAI_ANSWER_MAX = 60;
export const HARIAI_CLUE_MAX = 80;
export const HARIAI_BAND_QUESTION = 80;
export const HARIAI_BAND_INSTRUCTION = 85;
export const HARIAI_BAND_COMBO = 90;
export const HARIAI_DAMAGE_FLOOR = 70;
export const HARIAI_COMBO_STEP = 5;
export const HARIAI_COMBO_CAP = 15;
export const HARIAI_BREAK_MIN_POSTS = 2;
export const HARIAI_BREAK_HIT_DAMAGE = 25;
export const HARIAI_BREAK_MISS_DAMAGE = 20;
export const HARIAI_FINISH_DAMAGE = 10;
export const HARIAI_FINISH_MAX = 3;
export const HARIAI_HEART_COUNT = 3;
export const HARIAI_REASON_MIN_LENGTH = 4;
export const HARIAI_CANDIDATE_COUNT = 3;

const SALT_PATTERN = /^[a-f0-9]{32}$/;
const COMMIT_PATTERN = /^[a-f0-9]{64}$/;

export const HARIAI_PERSONA_TYPES = Object.freeze([
  Object.freeze({
    id: "tsuyotsuyo",
    label: "つよつよ",
    note: "上から目線で勝ち気。強がりが似合う",
    lines: Object.freeze({
      low: Object.freeze(["{score}点。…まだ全然平気なんだけど？♡", "ふーん、{score}点。{first}を落とすには足りないかな♡"]),
      mid: Object.freeze(["{score}点…べ、別に効いてないし♡", "…{score}点。ちょっとだけ、ね？"]),
      high: Object.freeze(["っ…{score}点。ずるい…♡", "{score}点…今の、ちょっとやばかった…♡"]),
      surrender: "…参りました。今日は{first}の負け…♡",
      declare: "{call}の勝ち、です…♡ 次は負けないんだから",
      confess: "…ばれちゃった♡ でもまだ負けてないし",
      breakCall: "{call}の弱点、{candidate}でしょ？♡",
    }),
  }),
  Object.freeze({
    id: "yowayowa",
    label: "よわよわ",
    note: "押しに弱くて、すぐ照れる",
    lines: Object.freeze({
      low: Object.freeze(["{score}点…が、がんばって耐えたもん♡", "ま、まだ{score}点だよ…？♡"]),
      mid: Object.freeze(["{score}点…ちょっと、きいちゃった…♡", "ぅ…{score}点。ずるいよぉ♡"]),
      high: Object.freeze(["{score}点…もうむり…♡", "ひぅ…{score}点…♡ だめなとこばっかり…"]),
      surrender: "…まいりました♡ {first}の負けです…",
      declare: "{call}の勝ちです…♡ よわよわでごめんね",
      confess: "ばれちゃった…♡ はずかしい…",
      breakCall: "え、えっと…{call}の弱点、{candidate}…だよね？♡",
    }),
  }),
  Object.freeze({
    id: "koakuma",
    label: "小悪魔",
    note: "からかい上手で、余裕のふり",
    lines: Object.freeze({
      low: Object.freeze(["{score}点♡ その程度でどきどきすると思った？", "{score}点かな〜♡ もっと本気出して？"]),
      mid: Object.freeze(["{score}点♡ …今のはちょっと、悪くないかも", "ふふ、{score}点♡ ずるい手使うじゃん"]),
      high: Object.freeze(["{score}点…♡ …やだ、今のはほんとに効いた", "{score}点♡ …もう、覚えてなさいよ"]),
      surrender: "…参りました♡ 今日だけは{first}の負けにしてあげる",
      declare: "{call}の勝ち♡ …悔しいけど認めてあげる",
      confess: "ばれちゃった♡ …ナイショにしててね？",
      breakCall: "ねぇ♡ {call}の弱点、{candidate}なんでしょ？",
    }),
  }),
  Object.freeze({
    id: "oneesan",
    label: "お姉さん",
    note: "余裕たっぷりで、甘やかし上手",
    lines: Object.freeze({
      low: Object.freeze(["{score}点ね♡ まだまだ余裕よ", "ふふ、{score}点♡ かわいい攻め方ね"]),
      mid: Object.freeze(["{score}点…♡ 少しだけ、どきっとしたわ", "あら、{score}点♡ やるじゃない"]),
      high: Object.freeze(["{score}点…♡ …お姉さんを本気にさせるなんて", "{score}点♡ …もう、ずるい子"]),
      surrender: "…参りました♡ {first}の負けよ",
      declare: "{call}の勝ちよ♡ よくできました",
      confess: "ばれちゃった♡ …隠してたのに",
      breakCall: "{call}の弱点、{candidate}でしょう？♡ お見通しよ",
    }),
  }),
  Object.freeze({
    id: "amaenbo",
    label: "甘えんぼ",
    note: "ハート多めで、甘えたがり",
    lines: Object.freeze({
      low: Object.freeze(["{score}点〜♡ もっとちょうだい？", "{score}点だよ♡ まだ足りないの〜"]),
      mid: Object.freeze(["{score}点♡ …ちょっとうれしくなっちゃった", "{score}点〜♡ それ好きかも…"]),
      high: Object.freeze(["{score}点♡♡ もう{call}のことしか見えない…", "{score}点…♡ だいすき…"]),
      surrender: "まいりました♡ {first}の負けでいいよ〜",
      declare: "{call}の勝ち〜♡ ぎゅってして？",
      confess: "ばれちゃった♡ えへへ…",
      breakCall: "{call}の弱点、{candidate}でしょ〜？♡",
    }),
  }),
  Object.freeze({
    id: "seiso",
    label: "清楚",
    note: "丁寧な言葉づかいで、崩れる瞬間が見せ場",
    lines: Object.freeze({
      low: Object.freeze(["{score}点です。まだ大丈夫ですよ♡", "{score}点でした。{first}はまだ平気です♡"]),
      mid: Object.freeze(["{score}点です…少しだけ、心が揺れました♡", "…{score}点。いけない気持ちになりそうです♡"]),
      high: Object.freeze(["{score}点です…♡ いけません、こんな…", "{score}点…♡ もう、取り繕えません…"]),
      surrender: "…参りました♡ {first}の負けです",
      declare: "{call}の勝ちです♡ …完敗いたしました",
      confess: "…ばれてしまいました♡",
      breakCall: "{call}の弱点は、{candidate}ではありませんか？♡",
    }),
  }),
]);

export const HARIAI_FIRST_PERSONS = Object.freeze([
  Object.freeze({ id: "watashi", label: "わたし" }),
  Object.freeze({ id: "atashi", label: "あたし" }),
  Object.freeze({ id: "uchi", label: "うち" }),
  Object.freeze({ id: "watakushi", label: "わたくし" }),
]);

export const HARIAI_CALL_STYLES = Object.freeze([
  Object.freeze({ id: "chan", label: "〇〇ちゃん", template: "{name}ちゃん" }),
  Object.freeze({ id: "san", label: "〇〇さん", template: "{name}さん" }),
  Object.freeze({ id: "oneesan", label: "おねえさん", template: "おねえさん" }),
  Object.freeze({ id: "anata", label: "あなた", template: "あなた" }),
]);

export const HARIAI_HONORIFICS = Object.freeze([
  Object.freeze({ id: "oneesama", label: "おねえさま", template: "おねえさま" }),
  Object.freeze({ id: "sama", label: "〇〇さま", template: "{name}さま" }),
  Object.freeze({ id: "senpai", label: "せんぱい", template: "せんぱい" }),
  Object.freeze({ id: "goshujin", label: "ご主人さま", template: "ご主人さま" }),
]);

export const HARIAI_QUESTIONS = Object.freeze([
  Object.freeze({ id: "spot", label: "どこが刺さった？", prompt: "今の、どこが刺さったの？", answer: "text" }),
  Object.freeze({ id: "which", label: "どっちが弱い？", prompt: "「{a}」と「{b}」、ほんとはどっちが弱いの？", answer: "choice" }),
  Object.freeze({ id: "next", label: "次は何がやばい？", prompt: "次は何を貼られたらやばい？", answer: "text" }),
  Object.freeze({ id: "honest", label: "ほんとは何点？", prompt: "さっきの点数、ほんとは何点？", answer: "number" }),
]);

export const HARIAI_INSTRUCTIONS = Object.freeze([
  Object.freeze({ id: "call", label: "呼び方を変えさせる", prompt: "これからは「{honorific}」って呼んで♡", answer: "ack" }),
  Object.freeze({ id: "heart", label: "語尾に♡を付けさせる", prompt: "次の3回、語尾に♡を付けて？", answer: "ack" }),
  Object.freeze({ id: "reason", label: "点数の理由を言わせる", prompt: "次の点数、ちゃんと理由も言ってね♡", answer: "ack" }),
  Object.freeze({ id: "deny", label: "候補をひとつ否定させる", prompt: "違う候補をひとつ、自分で否定して？♡", answer: "deny" }),
  Object.freeze({ id: "confess", label: "「ばれちゃった♡」と言わせる", prompt: "「ばれちゃった♡」って言って？", answer: "ack" }),
]);

export const HARIAI_PENALTIES = Object.freeze([
  Object.freeze({ id: "declare", label: "敗北宣言", note: "負けた側のペルソナで勝ちを認める", always: true }),
  Object.freeze({ id: "call", label: "呼び方", note: "負けた側から勝った側への呼び方を固定する", always: false }),
  Object.freeze({ id: "tribute", label: "お貢ぎ", note: "品評会で、勝った側の本命に向けた画像1枚＋言葉を送る", always: false }),
]);

const PERSONA_IDS = new Set(HARIAI_PERSONA_TYPES.map((item) => item.id));
const FIRST_PERSON_IDS = new Set(HARIAI_FIRST_PERSONS.map((item) => item.id));
const CALL_STYLE_IDS = new Set(HARIAI_CALL_STYLES.map((item) => item.id));
const HONORIFIC_IDS = new Set(HARIAI_HONORIFICS.map((item) => item.id));
const QUESTION_IDS = new Set(HARIAI_QUESTIONS.map((item) => item.id));
const INSTRUCTION_IDS = new Set(HARIAI_INSTRUCTIONS.map((item) => item.id));

export function hariaiPersonaType(id) {
  return HARIAI_PERSONA_TYPES.find((item) => item.id === id) || null;
}

export function normalizeHariaiPersona(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    type: PERSONA_IDS.has(source.type) ? source.type : "",
    firstPerson: FIRST_PERSON_IDS.has(source.firstPerson) ? source.firstPerson : "watashi",
    callStyle: CALL_STYLE_IDS.has(source.callStyle) ? source.callStyle : "chan",
  };
}

export function hariaiPersonaIsComplete(value) {
  return PERSONA_IDS.has(value?.type) && FIRST_PERSON_IDS.has(value?.firstPerson) && CALL_STYLE_IDS.has(value?.callStyle);
}

export function hariaiFirstPersonLabel(id) {
  return HARIAI_FIRST_PERSONS.find((item) => item.id === id)?.label || "わたし";
}

function fillName(template, name) {
  return String(template || "").replaceAll("{name}", String(name || ""));
}

export function hariaiCallName(callStyle, opponentName) {
  const style = HARIAI_CALL_STYLES.find((item) => item.id === callStyle) || HARIAI_CALL_STYLES[0];
  return fillName(style.template, opponentName);
}

export function hariaiHonorificName(honorificId, opponentName) {
  const honorific = HARIAI_HONORIFICS.find((item) => item.id === honorificId);
  return honorific ? fillName(honorific.template, opponentName) : "";
}

// 定型文の差し込み。値は呼び出し側でエスケープする。
export function fillHariaiLine(template, values = {}) {
  return String(template || "").replace(/\{(first|call|score|candidate|a|b|honorific|name)\}/g, (_, key) => String(values[key] ?? ""));
}

export function hariaiScoreTone(score) {
  const value = Number(score);
  if (value >= HARIAI_BAND_COMBO) return "high";
  if (value >= HARIAI_BAND_QUESTION) return "mid";
  return "low";
}

export function hariaiReplySuggestions(personaTypeId, score, values = {}) {
  const type = hariaiPersonaType(personaTypeId) || HARIAI_PERSONA_TYPES[0];
  const tone = hariaiScoreTone(score);
  return type.lines[tone].map((line) => fillHariaiLine(line, { ...values, score }));
}

export function hariaiPersonaLine(personaTypeId, key, values = {}) {
  const type = hariaiPersonaType(personaTypeId) || HARIAI_PERSONA_TYPES[0];
  return fillHariaiLine(type.lines[key], values);
}

export function ensureHariaiHeart(text) {
  const value = String(text || "");
  if (!value || /♡$/.test(value)) return value;
  return `${value}♡`;
}

export function normalizeHariaiText(value, maxLength) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

export function hariaiBand(score) {
  const value = Number(score);
  if (!Number.isInteger(value)) return "invalid";
  if (value >= HARIAI_BAND_COMBO) return "combo";
  if (value >= HARIAI_BAND_INSTRUCTION) return "instruction";
  if (value >= HARIAI_BAND_QUESTION) return "question";
  return "none";
}

export function hariaiRightOptions(score) {
  const band = hariaiBand(score);
  return {
    question: band === "question" || band === "combo",
    instruction: band === "instruction" || band === "combo",
    combo: band === "combo",
  };
}

export function hariaiPostDamage(score, comboIndex = 1) {
  const base = Math.max(0, Number(score) - HARIAI_DAMAGE_FLOOR);
  if (base <= 0) return 0;
  const bonus = Math.min(HARIAI_COMBO_CAP, HARIAI_COMBO_STEP * Math.max(0, Number(comboIndex) - 1));
  return base + bonus;
}

export function hariaiCandidateCommitMaterial(roomId, uid, index, bit, salt) {
  return `${roomId}:${uid}:${index}:${bit ? 1 : 0}:${salt}`;
}

// 先攻は RATE が低い側。同じなら roomId のハッシュ先頭バイトの偶奇（偶数ならホスト）。
export function hariaiFirstAttacker({ hostUid, guestUid, hostRating, guestRating, roomHashFirstByte }) {
  const host = Number(hostRating);
  const guest = Number(guestRating);
  if (Number.isFinite(host) && Number.isFinite(guest) && host !== guest) return host < guest ? hostUid : guestUid;
  return Number(roomHashFirstByte) % 2 === 0 ? hostUid : guestUid;
}

function isMember(uid, hostUid, guestUid) {
  return uid === hostUid || uid === guestUid;
}

function validText(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max && !/[\r\n]/.test(value);
}

function validCandidate(value) {
  return Number.isInteger(value) && value >= 0 && value < HARIAI_CANDIDATE_COUNT;
}

function createPlayerRuntime(uid) {
  return {
    uid,
    reason: HARIAI_REASON_MAX,
    handUsed: 0,
    posts: 0,
    breakUsed: false,
    breakPassed: false,
    breakResult: "",
    damageDealt: 0,
    maxCombo: 0,
    revealedBluffs: [],
    weaknessRevealed: null,
    honorific: "",
    heartsRemaining: 0,
    reasonRequired: false,
    denyReceived: false,
    receivedScores: [],
  };
}

function handOf(player, handSize) {
  return Math.max(0, handSize - player.handUsed);
}

function breakAvailable(player) {
  return !player.breakUsed && !player.breakPassed && player.posts >= HARIAI_BREAK_MIN_POSTS;
}

function canAct(player, handSize) {
  return handOf(player, handSize) > 0 || breakAvailable(player);
}

function consumeHeart(player) {
  if (player.heartsRemaining <= 0) return false;
  player.heartsRemaining -= 1;
  return true;
}

function applyDamage(target, amount) {
  const before = target.reason;
  target.reason = Math.max(0, target.reason - Math.max(0, amount));
  return { dealt: before - target.reason, overkill: Math.max(0, amount - before) };
}

function orderedSlots(moves) {
  const source = moves && typeof moves === "object" ? moves : {};
  const numbers = [];
  for (const key of Object.keys(source)) {
    // Realtime Database は 1 始まりの整数キーを配列で返すことがあり、0 番が空になる。
    if (source[key] == null) continue;
    if (!/^[1-9][0-9]?$/.test(key)) return { error: `不正なスロット番号です: ${key}` };
    const slot = Number(key);
    if (slot > HARIAI_MAX_SLOTS) return { error: `スロット番号が上限を超えています: ${key}` };
    numbers.push(slot);
  }
  numbers.sort((a, b) => a - b);
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index + 1) return { error: "スロットに欠番があります。" };
  }
  return { numbers };
}

function actionKinds(entry) {
  return ["post", "break", "pass", "surrender"].filter((kind) => entry?.[kind] != null);
}

// ルームの moves を再生する。
// players: { [uid]: { weaknessCommits? } }（候補数だけ使う）
// 戻り値の pending は「次に誰が何をする段階か」、outcome は決着（未決着なら null）。
export function replayHariai({ hostUid, guestUid, firstUid, moves, handSize = HARIAI_HAND_SIZE }) {
  const result = {
    ok: true,
    error: "",
    players: { [hostUid]: createPlayerRuntime(hostUid), [guestUid]: createPlayerRuntime(guestUid) },
    slots: [],
    pending: null,
    outcome: null,
    comboStreak: { uid: "", count: 0 },
  };
  const fail = (message) => {
    result.ok = false;
    result.error = message;
    result.pending = null;
    return result;
  };
  if (!hostUid || !guestUid || hostUid === guestUid || !isMember(firstUid, hostUid, guestUid)) {
    return fail("対戦者の情報が不正です。");
  }
  const other = (uid) => (uid === hostUid ? guestUid : hostUid);
  const player = (uid) => result.players[uid];
  // どの段階で返しても、両者の残り手札を揃えて返す。
  const settle = () => {
    for (const uid of [hostUid, guestUid]) result.players[uid].hand = handOf(result.players[uid], handSize);
    return result;
  };
  const order = orderedSlots(moves);
  if (order.error) return fail(order.error);

  let actor = firstUid;
  const decideExhausted = () => {
    const host = player(hostUid);
    const guest = player(guestUid);
    let winnerUid = null;
    if (host.reason !== guest.reason) winnerUid = host.reason > guest.reason ? hostUid : guestUid;
    else if (host.damageDealt !== guest.damageDealt) winnerUid = host.damageDealt > guest.damageDealt ? hostUid : guestUid;
    result.outcome = winnerUid
      ? { reason: "exhausted", winnerUid, loserUid: other(winnerUid), draw: false }
      : { reason: "exhausted", winnerUid: null, loserUid: null, draw: true };
  };
  const nextActor = (preferred) => {
    if (canAct(player(preferred), handSize)) return preferred;
    if (canAct(player(other(preferred)), handSize)) return other(preferred);
    return null;
  };
  const ko = (loserUid) => {
    result.outcome = { reason: "ko", winnerUid: other(loserUid), loserUid, draw: false };
  };
  const surrender = (loserUid) => {
    result.outcome = { reason: "surrender", winnerUid: other(loserUid), loserUid, draw: false };
  };

  for (const slotNumber of order.numbers) {
    if (result.outcome) break;
    const entry = moves[slotNumber] || moves[String(slotNumber)] || {};
    const kinds = actionKinds(entry);
    if (kinds.length !== 1) return fail(`スロット${slotNumber}の行動が確定していません。`);
    const kind = kinds[0];
    const action = entry[kind];
    if (action?.by !== actor) return fail(`スロット${slotNumber}は手番ではないプレイヤーの行動です。`);
    const self = player(actor);
    const opponentUid = other(actor);
    const opponent = player(opponentUid);
    const slot = { slot: slotNumber, kind, by: actor, receiver: opponentUid, resolved: false };
    result.slots.push(slot);

    if (kind === "surrender") {
      slot.resolved = true;
      result.comboStreak = { uid: "", count: 0 };
      surrender(actor);
      break;
    }

    if (kind === "pass") {
      if (handOf(self, handSize) > 0 || !breakAvailable(self)) return fail(`スロット${slotNumber}の見送りは条件を満たしていません。`);
      self.breakPassed = true;
      slot.resolved = true;
      result.comboStreak = { uid: "", count: 0 };
      const next = nextActor(opponentUid);
      if (!next) { decideExhausted(); break; }
      actor = next;
      continue;
    }

    if (kind === "break") {
      if (!breakAvailable(self)) return fail(`スロット${slotNumber}の看破は条件を満たしていません。`);
      if (!validCandidate(action.guess)) return fail(`スロット${slotNumber}の看破候補が不正です。`);
      if (opponent.revealedBluffs.includes(action.guess)) return fail(`スロット${slotNumber}はブラフと判明済みの候補を看破しています。`);
      self.breakUsed = true;
      result.comboStreak = { uid: "", count: 0 };
      slot.guess = action.guess;
      const reveal = entry.breakReveal;
      if (!reveal) {
        result.pending = { slot: slotNumber, stage: "breakReveal", actor: opponentUid, attacker: actor };
        return settle();
      }
      if (reveal.by !== opponentUid || reveal.index !== action.guess || ![0, 1].includes(reveal.bit) || !SALT_PATTERN.test(String(reveal.salt || ""))) {
        return fail(`スロット${slotNumber}の看破照合データが不正です。`);
      }
      slot.reveal = { index: reveal.index, bit: reveal.bit, salt: reveal.salt };
      if (reveal.bit === 0) {
        slot.breakResult = "miss";
        self.breakResult = "miss";
        opponent.revealedBluffs.push(action.guess);
        const damage = applyDamage(self, HARIAI_BREAK_MISS_DAMAGE);
        slot.selfDamage = damage.dealt;
        slot.resolved = true;
        if (self.reason <= 0) { ko(actor); break; }
        const next = nextActor(opponentUid);
        if (!next) { decideExhausted(); break; }
        actor = next;
        continue;
      }
      slot.breakResult = "hit";
      self.breakResult = "hit";
      opponent.weaknessRevealed = action.guess;
      const hit = applyDamage(opponent, HARIAI_BREAK_HIT_DAMAGE);
      self.damageDealt += hit.dealt;
      slot.damage = hit.dealt;
      slot.overkill = hit.overkill;
      const bluffs = result.slots.filter((item) => item.kind === "post" && item.by === actor && item.target === action.guess
        && Number.isInteger(item.score) && item.score < HARIAI_BAND_QUESTION).map((item) => item.slot);
      slot.bluffSlots = bluffs;
      slot.finishMax = Math.min(HARIAI_FINISH_MAX, 1 + bluffs.length, handOf(self, handSize));
      if (opponent.reason <= 0) {
        slot.resolved = true;
        ko(opponentUid);
        break;
      }
      const finish = entry.finish;
      if (!finish) {
        result.pending = { slot: slotNumber, stage: "finish", actor, receiver: opponentUid, finishMax: slot.finishMax };
        return settle();
      }
      const captions = finish.captions && typeof finish.captions === "object" ? finish.captions : {};
      if (finish.by !== actor || !Number.isInteger(finish.count) || finish.count < 0 || finish.count > slot.finishMax) {
        return fail(`スロット${slotNumber}の仕留め枚数が不正です。`);
      }
      const captionList = [];
      for (let index = 0; index < finish.count; index += 1) {
        const caption = captions[index] ?? captions[String(index)];
        if (!validText(caption, 1, HARIAI_CAPTION_MAX)) return fail(`スロット${slotNumber}の仕留めの言葉が不正です。`);
        captionList.push({ text: caption, heart: consumeHeart(self) });
      }
      self.handUsed += finish.count;
      slot.finishCount = finish.count;
      slot.finishCaptions = captionList;
      const received = entry.finishReceived && typeof entry.finishReceived === "object" ? entry.finishReceived : {};
      const receivedCount = Array.from({ length: finish.count }, (_, index) => received[index] === true || received[String(index)] === true)
        .filter(Boolean).length;
      if (receivedCount < finish.count) {
        result.pending = { slot: slotNumber, stage: "finishReceive", actor: opponentUid, attacker: actor, finishCount: finish.count, receivedCount };
        return settle();
      }
      const chain = applyDamage(opponent, HARIAI_FINISH_DAMAGE * finish.count);
      self.damageDealt += chain.dealt;
      slot.finishDamage = chain.dealt;
      slot.finishOverkill = chain.overkill;
      slot.resolved = true;
      if (opponent.reason <= 0) { ko(opponentUid); break; }
      const next = nextActor(opponentUid);
      if (!next) { decideExhausted(); break; }
      actor = next;
      continue;
    }

    // kind === "post"
    if (handOf(self, handSize) <= 0) return fail(`スロット${slotNumber}は手札がないのに貼られています。`);
    if (!validCandidate(action.target)) return fail(`スロット${slotNumber}の狙いが不正です。`);
    if (!validText(action.caption, 1, HARIAI_CAPTION_MAX)) return fail(`スロット${slotNumber}の言葉が不正です。`);
    self.handUsed += 1;
    self.posts += 1;
    const combo = result.comboStreak.uid === actor ? result.comboStreak.count + 1 : 1;
    result.comboStreak = { uid: actor, count: combo };
    self.maxCombo = Math.max(self.maxCombo, combo);
    Object.assign(slot, { target: action.target, caption: action.caption, captionHeart: consumeHeart(self), combo });
    const received = entry.received && typeof entry.received === "object" ? entry.received : {};
    if (received[opponentUid] !== true) {
      result.pending = { slot: slotNumber, stage: "receive", actor: opponentUid, attacker: actor };
      return settle();
    }
    const score = entry.score;
    if (!score) {
      result.pending = { slot: slotNumber, stage: "score", actor: opponentUid, attacker: actor, reasonRequired: opponent.reasonRequired };
      return settle();
    }
    if (score.by !== opponentUid || !Number.isInteger(score.value) || score.value < HARIAI_SCORE_MIN || score.value > HARIAI_SCORE_MAX) {
      return fail(`スロット${slotNumber}の点数が不正です。`);
    }
    const reply = score.reply == null ? "" : score.reply;
    if (reply !== "" && !validText(reply, 1, HARIAI_REPLY_MAX)) return fail(`スロット${slotNumber}のひとことが不正です。`);
    slot.score = score.value;
    slot.reply = reply;
    slot.replyHeart = reply ? consumeHeart(opponent) : false;
    slot.reasonRequired = opponent.reasonRequired;
    opponent.reasonRequired = false;
    opponent.receivedScores.push(score.value);
    slot.band = hariaiBand(score.value);
    const damage = applyDamage(opponent, hariaiPostDamage(score.value, combo));
    self.damageDealt += damage.dealt;
    slot.damage = damage.dealt;
    slot.overkill = damage.overkill;
    if (score.surrender === true) {
      slot.scoreSurrender = true;
      slot.resolved = true;
      surrender(opponentUid);
      break;
    }
    if (opponent.reason <= 0) {
      slot.resolved = true;
      ko(opponentUid);
      break;
    }
    const options = hariaiRightOptions(score.value);
    const right = entry.right;
    if (!options.question && !options.instruction) {
      if (right || entry.answer) return fail(`スロット${slotNumber}は権利のない点数です。`);
    } else {
      if (!right) {
        result.pending = { slot: slotNumber, stage: "right", actor, receiver: opponentUid, options, band: slot.band };
        return settle();
      }
      if (right.by !== actor) return fail(`スロット${slotNumber}の権利を使ったのが攻め手ではありません。`);
      if (right.kind === "none") {
        if (entry.answer) return fail(`スロット${slotNumber}は見送った権利に答えがあります。`);
        slot.right = { kind: "none" };
      } else if (right.kind === "question") {
        if (!options.question || !QUESTION_IDS.has(right.id)) return fail(`スロット${slotNumber}の質問が不正です。`);
        const flavor = right.flavor == null ? "" : right.flavor;
        if (flavor !== "" && !validText(flavor, 1, HARIAI_FLAVOR_MAX)) return fail(`スロット${slotNumber}の質問のひとことが不正です。`);
        slot.right = { kind: "question", id: right.id, flavor };
        if (right.id === "which") {
          if (!validCandidate(right.a) || !validCandidate(right.b) || right.a === right.b) return fail(`スロット${slotNumber}の質問候補が不正です。`);
          slot.right.a = right.a;
          slot.right.b = right.b;
        }
        const answer = entry.answer;
        if (!answer) {
          result.pending = { slot: slotNumber, stage: "answer", actor: opponentUid, attacker: actor, right: slot.right };
          return settle();
        }
        if (answer.by !== opponentUid) return fail(`スロット${slotNumber}の答えが受け手のものではありません。`);
        if (right.id === "spot" || right.id === "next") {
          if (!validText(answer.text, 1, HARIAI_ANSWER_MAX)) return fail(`スロット${slotNumber}の答えが不正です。`);
          slot.answer = { text: answer.text, heart: consumeHeart(opponent) };
        } else if (right.id === "which") {
          if (answer.choice !== right.a && answer.choice !== right.b) return fail(`スロット${slotNumber}の答えが選択肢にありません。`);
          slot.answer = { choice: answer.choice };
        } else {
          if (!Number.isInteger(answer.value) || answer.value < HARIAI_SCORE_MIN || answer.value > HARIAI_SCORE_MAX) return fail(`スロット${slotNumber}の答えが不正です。`);
          slot.answer = { value: answer.value };
        }
      } else if (right.kind === "instruction") {
        if (!options.instruction || !INSTRUCTION_IDS.has(right.id)) return fail(`スロット${slotNumber}の指示が不正です。`);
        const flavor = right.flavor == null ? "" : right.flavor;
        if (flavor !== "" && !validText(flavor, 1, HARIAI_FLAVOR_MAX)) return fail(`スロット${slotNumber}の指示のひとことが不正です。`);
        if (right.id === "call" && !HONORIFIC_IDS.has(right.param)) return fail(`スロット${slotNumber}の呼び方が不正です。`);
        if (right.id === "deny" && !hariaiDenyAvailable(opponent)) return fail(`スロット${slotNumber}は候補の否定を使えない状況です。`);
        slot.right = { kind: "instruction", id: right.id, flavor, param: right.id === "call" ? right.param : "" };
        const answer = entry.answer;
        if (!answer) {
          result.pending = { slot: slotNumber, stage: "answer", actor: opponentUid, attacker: actor, right: slot.right };
          return settle();
        }
        if (answer.by !== opponentUid) return fail(`スロット${slotNumber}の答えが受け手のものではありません。`);
        if (right.id === "deny") {
          if (!validCandidate(answer.candidate) || opponent.revealedBluffs.includes(answer.candidate) || !SALT_PATTERN.test(String(answer.salt || ""))) {
            return fail(`スロット${slotNumber}の候補否定が不正です。`);
          }
          opponent.revealedBluffs.push(answer.candidate);
          opponent.denyReceived = true;
          slot.answer = { candidate: answer.candidate, salt: answer.salt };
        } else {
          if (answer.ack !== true) return fail(`スロット${slotNumber}の指示への応答が不正です。`);
          slot.answer = { ack: true };
          if (right.id === "call") opponent.honorific = right.param;
          if (right.id === "heart") opponent.heartsRemaining = HARIAI_HEART_COUNT;
          if (right.id === "reason") opponent.reasonRequired = true;
        }
      } else {
        return fail(`スロット${slotNumber}の権利の種類が不正です。`);
      }
    }
    slot.resolved = true;
    const next = nextActor(options.combo ? actor : opponentUid);
    if (!next) { decideExhausted(); break; }
    // 連投が続くのは、90点以上で同じ攻め手が手番を維持した時だけ。
    if (!(options.combo && next === actor)) result.comboStreak = { uid: "", count: 0 };
    actor = next;
  }

  if (!result.outcome && result.ok && !result.pending) {
    const self = player(actor);
    result.pending = {
      slot: result.slots.length + 1,
      stage: "act",
      actor,
      canPost: handOf(self, handSize) > 0,
      canBreak: breakAvailable(self),
      canPass: handOf(self, handSize) <= 0 && breakAvailable(self),
      combo: result.comboStreak.uid === actor ? result.comboStreak.count : 0,
    };
    if (result.pending.slot > HARIAI_MAX_SLOTS) {
      result.pending = null;
      decideExhausted();
    }
  }
  return settle();
}

export function hariaiDenyAvailable(target) {
  return !target.denyReceived && target.revealedBluffs.length === 0 && target.weaknessRevealed === null;
}

// 看破照合・候補否定・最終公開で検証すべき (uid, index, bit, salt) の一覧。
export function hariaiPartialReveals(replay) {
  const checks = [];
  for (const slot of replay?.slots || []) {
    if (slot.kind === "break" && slot.reveal) {
      checks.push({ uid: slot.receiver, index: slot.reveal.index, bit: slot.reveal.bit, salt: slot.reveal.salt, slot: slot.slot });
    }
    if (slot.kind === "post" && slot.right?.id === "deny" && slot.answer?.salt) {
      checks.push({ uid: slot.receiver, index: slot.answer.candidate, bit: 0, salt: slot.answer.salt, slot: slot.slot });
    }
  }
  return checks;
}

// 最終公開の形式チェック（ハッシュ照合は呼び出し側）。
export function normalizeHariaiFinalReveal(value) {
  if (!value || typeof value !== "object") return null;
  const weaknessIndex = value.weaknessIndex;
  const salts = value.salts && typeof value.salts === "object" ? value.salts : {};
  const list = Array.from({ length: HARIAI_CANDIDATE_COUNT }, (_, index) => salts[index] ?? salts[String(index)]);
  if (!validCandidate(weaknessIndex) || list.some((salt) => !SALT_PATTERN.test(String(salt || "")))) return null;
  return { weaknessIndex, salts: list };
}

export function hariaiCommitsAreWellFormed(commits) {
  const list = Array.from({ length: HARIAI_CANDIDATE_COUNT }, (_, index) => commits?.[index] ?? commits?.[String(index)]);
  return list.every((commit) => COMMIT_PATTERN.test(String(commit || "")));
}

// 決着後の振り返り用: 各プレイヤーが本命を狙われて80点未満で返した（強がった）スロット。
export function hariaiBluffFaces(replay, weaknessIndexByUid) {
  const faces = {};
  for (const uid of Object.keys(replay?.players || {})) faces[uid] = [];
  for (const slot of replay?.slots || []) {
    if (slot.kind !== "post" || !Number.isInteger(slot.score)) continue;
    const weakness = weaknessIndexByUid?.[slot.receiver];
    if (slot.target === weakness && slot.score < HARIAI_BAND_QUESTION) faces[slot.receiver]?.push(slot.slot);
  }
  return faces;
}

export function hariaiReadingMemo(replay, viewerUid) {
  const memo = Array.from({ length: HARIAI_CANDIDATE_COUNT }, (_, index) => ({ index, scores: [], answers: [], bluff: false, weakness: false }));
  const opponentUid = Object.keys(replay?.players || {}).find((uid) => uid !== viewerUid);
  const opponent = replay?.players?.[opponentUid];
  for (const slot of replay?.slots || []) {
    if (slot.kind === "post" && slot.by === viewerUid && Number.isInteger(slot.score)) memo[slot.target]?.scores.push({ slot: slot.slot, score: slot.score });
    if (slot.kind === "post" && slot.by === viewerUid && slot.right?.id === "which" && slot.answer && Number.isInteger(slot.answer.choice)) {
      memo[slot.answer.choice]?.answers.push({ slot: slot.slot, kind: "which" });
    }
  }
  for (const index of opponent?.revealedBluffs || []) if (memo[index]) memo[index].bluff = true;
  if (Number.isInteger(opponent?.weaknessRevealed) && memo[opponent.weaknessRevealed]) memo[opponent.weaknessRevealed].weakness = true;
  return memo.map((item) => ({
    ...item,
    average: item.scores.length ? Math.round(item.scores.reduce((sum, entry) => sum + entry.score, 0) / item.scores.length) : null,
  }));
}

export function hariaiPenaltyOptions(first, second) {
  return HARIAI_PENALTIES.filter((penalty) => penalty.always || (first?.[penalty.id] === true && second?.[penalty.id] === true)).map((penalty) => penalty.id);
}

export function normalizeHariaiPenaltyConsent(value) {
  return { call: value?.call === true, tribute: value?.tribute === true };
}
