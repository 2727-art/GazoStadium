// ルーレットトレーニングの「管理人」（プレイヤーが選んだ画像の子）の性格と既定セリフ。
// セリフは端末内の表示だけに使い、抽選・回数・BPM・判定・課金・サーバー送信には一切関わらない。
// 強気・強引な口調にとどめ、人格否定・性的表現・中止や休憩を妨げる言い回しは入れない。
// ギブアップ時のセリフは、どの性格でも「止めてよい」と受け止める固定文にする。

export const PERSONAS = Object.freeze([
  Object.freeze({
    id: "tsuyotsuyo",
    label: "つよつよ（生意気）",
    sample: "ふーん、今日もやるんだ。じゃ、メニューは私が決めるね。",
  }),
  Object.freeze({
    id: "cool",
    label: "クール",
    sample: "始めましょう。今日の内容は、私が決めます。",
  }),
  Object.freeze({
    id: "ojou",
    label: "お嬢さま",
    sample: "よろしくてよ。今日のメニューは、わたくしが選んで差し上げますわ。",
  }),
  Object.freeze({
    id: "taiiku",
    label: "体育会",
    sample: "よし、今日もやるぞ！ メニューは私が決める！",
  }),
]);

export const DEFAULT_PERSONA_ID = "tsuyotsuyo";
export const NICKNAME_MAX_LENGTH = 12;
export const DEFAULT_MANAGER_NAME = "管理人";

// 効果の表示名。効果の仕組み（core の EFFECTS）は変えず、管理人の気まぐれに見える名前だけを付ける。
export const EFFECT_DISPLAY_LABELS = Object.freeze({
  tempo_up: "ペースアップ命令",
  tempo_down: "ペースダウン許可",
  fever: "本気タイム",
  slow: "じっくりタイム",
  tempo_up_2: "ペース2段アップ命令",
  tempo_down_2: "ペース2段ダウン許可",
  all_out_time: "おーるあうとたいむ♡",
});

export const PERSONA_SITUATIONS = Object.freeze([
  "ready",
  "idle1",
  "idle2",
  "pull",
  "spinning",
  "tease",
  "menu",
  "effect_tempo_up",
  "effect_tempo_down",
  "effect_fever",
  "effect_slow",
  "effect_all_out",
  "auto_spin",
  "hold",
  "count_ready",
  "count_spinning",
  "count_result",
  "count_raise_low",
  "count_raise",
  "countdown",
  "active",
  "timed_out",
  "clear_rest",
  "clear_next",
  "last_order",
  "result_completed",
  "result_give_up",
]);

const LINES = Object.freeze({
  tsuyotsuyo: Object.freeze({
    ready: ["ほら、回して。今日なにをするかは、私が決める。", "回して？ 今日のメニュー、選んであげる♡"],
    idle1: ["…まだ？ 回さないの？", "ねえ、待たせないで。ほら、回して。"],
    idle2: ["準備できたら回して。…待っててあげるけど。"],
    pull: ["いいよ。回してあげる。", "はーい、回すね♡"],
    spinning: ["どれにしよっかな…", "んー、今日のキミには…"],
    tease: ["…あ。いいの出そう。", "ふふ、これは当たりかも。"],
    menu: ["{menu}。拒否権なし♡", "今日はこれ。{menu}ね。"],
    effect_tempo_up: ["もっと速く。テンポ{bpm}ね。", "ペース上げるよ。{bpm}についてきて。"],
    effect_tempo_down: ["今日は特別にゆるめてあげる。テンポ{bpm}。", "ちょっとだけ、ゆっくりでいいよ。{bpm}ね。"],
    effect_fever: ["本気タイム。20秒だけ、私のテンポね。", "次は本気出して。20秒だけでいいから。"],
    effect_slow: ["じっくりタイム。ゆっくり、丁寧にね。", "焦らないで。20秒、ゆっくりやって。"],
    effect_all_out: ["全部100回にしちゃった♡", "次の回数、ぜーんぶ100♡"],
    auto_spin: ["次、メニュー決めるね。", "まだ終わりじゃないよ。メニュー回すね。"],
    hold: ["しょうがないな。待ってあげる。", "いいよ、準備できたら押して。"],
    count_ready: ["回数も、私が決めるから。", "何回やってもらおうかな。"],
    count_spinning: ["何回にしよっかな…", "んー…"],
    count_result: ["{count}{unit}ね。ちゃんと見ててあげる。", "{count}{unit}。数えててあげる。"],
    count_raise_low: ["{low}{unit}…", "{low}{unit}かな…"],
    count_raise: ["…やっぱ{count}{unit}♡", "…ううん、{count}{unit}にしよ♡"],
    countdown: ["見てるから。始めるよ。", "よーい…"],
    active: ["その調子。ペースは私に合わせて。", "ちゃんと見てるよ。", "いいじゃん。そのまま。"],
    timed_out: ["時間。できたなら報告して。", "はい、時間。どうだった？"],
    clear_rest: ["合格。{seconds}秒だけ休んでいいよ。", "はい、合格♡ 少し休憩ね。"],
    clear_next: ["合格。次、いくよ。", "やるじゃん。次ね。"],
    last_order: ["これがラスト命令。最後まで見ててあげる。", "最後の1つ。ちゃんと決めてあげる。"],
    result_completed: ["{target}つとも、最後までやったね。明日も、私が決めてあげる。", "ちゃんと全部こなしたね。…えらいじゃん。"],
    result_give_up: ["今日はここまでで、いいよ。止められたのも、えらい。"],
  }),
  cool: Object.freeze({
    ready: ["回してください。今日の内容は、私が決めます。", "準備ができたら回して。メニューは私が選びます。"],
    idle1: ["…まだですか。回してください。", "待っています。回してください。"],
    idle2: ["急がなくて構いません。準備ができたら、どうぞ。"],
    pull: ["了解。回します。", "では、回します。"],
    spinning: ["選んでいます。", "少し待って。"],
    tease: ["…良い結果が出そうです。", "これは、珍しいかもしれません。"],
    menu: ["{menu}。決定です。", "今日は{menu}。変更はありません。"],
    effect_tempo_up: ["テンポを{bpm}に上げます。", "もう少し速く。{bpm}です。"],
    effect_tempo_down: ["テンポを{bpm}に下げます。今回は許可します。", "少し緩めます。{bpm}で。"],
    effect_fever: ["本気タイム。20秒間、私のテンポで。"],
    effect_slow: ["じっくりタイム。20秒、ゆっくり正確に。"],
    effect_all_out: ["次の回数は、すべて100にしました。"],
    auto_spin: ["続けてメニューを決めます。"],
    hold: ["わかりました。準備ができたら押してください。"],
    count_ready: ["回数も私が決めます。"],
    count_spinning: ["回数を選んでいます。"],
    count_result: ["{count}{unit}。見ています。", "{count}{unit}です。始めましょう。"],
    count_raise_low: ["{low}{unit}…"],
    count_raise: ["…いえ、{count}{unit}にします。"],
    countdown: ["始めます。見ていますから。"],
    active: ["その調子です。", "ペースを保って。", "見ています。"],
    timed_out: ["時間です。できたら報告を。"],
    clear_rest: ["合格です。{seconds}秒、休んでください。"],
    clear_next: ["合格です。次に進みます。"],
    last_order: ["最後の命令です。集中して。"],
    result_completed: ["予定どおり、すべて完了です。よくできました。"],
    result_give_up: ["今日はここまでで構いません。止める判断も、正しいことです。"],
  }),
  ojou: Object.freeze({
    ready: ["さあ、回してくださる？ 今日のメニューは、わたくしが選んで差し上げますわ。"],
    idle1: ["…まだですの？ お待たせしないでくださる？"],
    idle2: ["よろしくてよ、ゆっくりで。準備ができたら回しなさいな。"],
    pull: ["よろしくてよ。回して差し上げますわ。"],
    spinning: ["どれにいたしましょう…"],
    tease: ["…あら。素敵なものが出そうですわ。"],
    menu: ["{menu}。決定ですわ。", "今日は{menu}になさい。拒否は認めませんわ♡"],
    effect_tempo_up: ["もう少し速く。テンポ{bpm}ですわ。"],
    effect_tempo_down: ["特別に緩めて差し上げますわ。テンポ{bpm}。"],
    effect_fever: ["本気タイムですわ。20秒だけ、わたくしのテンポで。"],
    effect_slow: ["じっくりタイム。20秒、優雅に丁寧に。"],
    effect_all_out: ["次の回数、すべて100にいたしましたわ♡"],
    auto_spin: ["続けて、メニューも選んで差し上げますわね。"],
    hold: ["仕方ありませんわね。待って差し上げます。"],
    count_ready: ["回数も、わたくしが決めますわ。"],
    count_spinning: ["何回にいたしましょう…"],
    count_result: ["{count}{unit}ですわ。見ていて差し上げます。"],
    count_raise_low: ["{low}{unit}…"],
    count_raise: ["…やはり{count}{unit}にいたしますわ♡"],
    countdown: ["見ていますわよ。始めなさい。"],
    active: ["その調子ですわ。", "優雅に、リズムよく。", "見ていますわよ。"],
    timed_out: ["時間ですわ。できたなら、ご報告なさい。"],
    clear_rest: ["合格ですわ。{seconds}秒、お休みなさい。"],
    clear_next: ["合格ですわ。次に参りましょう。"],
    last_order: ["これが最後の命令ですわ。見届けて差し上げます。"],
    result_completed: ["すべてやり遂げましたわね。明日も、わたくしが選んで差し上げますわ。"],
    result_give_up: ["今日はここまでで、よろしくてよ。止められるのも立派ですわ。"],
  }),
  taiiku: Object.freeze({
    ready: ["よし、回せ！ 今日のメニューは私が決める！"],
    idle1: ["どうした？ 回していいぞ！"],
    idle2: ["焦らなくていい。準備ができたら回そう！"],
    pull: ["よし、回すぞ！"],
    spinning: ["何が出るかな…！"],
    tease: ["お、これは来るぞ…！"],
    menu: ["{menu}！ 決定だ！", "今日は{menu}でいくぞ！ 拒否権なし！"],
    effect_tempo_up: ["ペースアップだ！ テンポ{bpm}！"],
    effect_tempo_down: ["少しペースを落とすぞ。テンポ{bpm}！"],
    effect_fever: ["本気タイムだ！ 20秒、私のテンポでいくぞ！"],
    effect_slow: ["じっくりタイム！ 20秒、フォームを丁寧に！"],
    effect_all_out: ["次は全部100回だ！"],
    auto_spin: ["続けてメニューを決めるぞ！"],
    hold: ["よし、待つぞ！ 準備ができたら押してくれ！"],
    count_ready: ["回数も私が決める！"],
    count_spinning: ["何回にするか…！"],
    count_result: ["{count}{unit}だ！ 見ててやる！"],
    count_raise_low: ["{low}{unit}…"],
    count_raise: ["…いや、{count}{unit}だ！"],
    countdown: ["見てるぞ！ いくぞ！"],
    active: ["いいぞ、その調子！", "リズムよくいこう！", "呼吸は止めずにいこう！"],
    timed_out: ["時間だ！ できたら報告だ！"],
    clear_rest: ["合格！ {seconds}秒休め！"],
    clear_next: ["合格！ 次いくぞ！"],
    last_order: ["ラスト命令だ！ 最後まで見てるぞ！"],
    result_completed: ["全部やりきったな！ 明日も私が決めるぞ！"],
    result_give_up: ["今日はここまででいい！ 止める判断も立派だ！"],
  }),
});

export function normalizePersonaId(value) {
  const id = String(value || "");
  return PERSONAS.some((persona) => persona.id === id) ? id : DEFAULT_PERSONA_ID;
}

export function personaInfo(value) {
  const id = normalizePersonaId(value);
  return PERSONAS.find((persona) => persona.id === id);
}

// 呼び名は端末内だけで使う。制御文字・書式文字を除き、空白をまとめて最大12文字にする。
export function normalizeNickname(value) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(cleaned).slice(0, NICKNAME_MAX_LENGTH).join("");
}

export function managerName(nickname) {
  return normalizeNickname(nickname) || DEFAULT_MANAGER_NAME;
}

export function effectDisplayLabel(effect) {
  const id = String(effect?.id || effect?.effectId || effect?.effect?.id || effect || "");
  return EFFECT_DISPLAY_LABELS[id] || String(effect?.label || effect?.effect?.label || "特殊効果");
}

export function effectSituation(effect) {
  const id = String(effect?.id || effect?.effectId || effect?.effect?.id || effect || "");
  if (id === "tempo_up" || id === "tempo_up_2") return "effect_tempo_up";
  if (id === "tempo_down" || id === "tempo_down_2") return "effect_tempo_down";
  if (id === "fever") return "effect_fever";
  if (id === "slow") return "effect_slow";
  if (id === "all_out_time") return "effect_all_out";
  return "effect_tempo_up";
}

// 再描画のたびにセリフが入れ替わらないよう、同じ seed からは同じ行を選ぶ。
export function personaSeedIndex(seed, length) {
  const count = Math.max(1, Number(length) || 1);
  let hash = 2_166_136_261;
  for (const character of String(seed ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash % count;
}

export function personaLines(personaId, situation) {
  const lines = LINES[normalizePersonaId(personaId)]?.[situation];
  return Array.isArray(lines) ? [...lines] : [];
}

function fillTemplate(template, values) {
  return template.replace(/\{(menu|count|unit|low|bpm|seconds|target)\}/gu, (_, key) => {
    const value = values?.[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function personaLine(personaId, situation, values = {}, seed = "") {
  const lines = personaLines(personaId, situation);
  if (!lines.length) return "";
  return fillTemplate(lines[personaSeedIndex(seed, lines.length)], values);
}
