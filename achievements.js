(() => {
  "use strict";

  const MAX_SHOWCASE = 3;
  const definitions = [];
  const addSeries = ({
    scope,
    category,
    family,
    familyLabel,
    icon,
    thresholds,
    names,
    description,
    hint = `${familyLabel}を続けると解除`,
    autoPublic = true,
  }) => {
    thresholds.forEach((target, index) => definitions.push(Object.freeze({
      id: `${family}_${target}`,
      scope,
      category,
      family,
      familyLabel,
      icon,
      level: index + 1,
      target,
      name: names[index],
      description: description(target),
      hint,
      autoPublic,
    })));
  };

  addSeries({
    scope: "battle",
    category: "battle_record",
    family: "battle_total",
    familyLabel: "通算対戦",
    icon: "▣",
    thresholds: [1, 10, 30, 100, 300, 1000, 3000],
    names: ["開幕の一枚", "いつもの観客席", "貼り合い常連", "画像フォルダの住人", "帰る場所はここ", "千本貼り", "スタジアムの一部"],
    description: (target) => `検証済みオンライン対戦を通算${target}試合完走した`,
  });

  [
    ["solo", "通常型1on1", "◆", ["通常型の一歩", "スタンダード見習い", "通常型の常連", "五十戦の貼り手", "通常型百景", "スタンダードの主", "千試合の定番"]],
    ["strategy", "戦略型1on1", "◇", ["弱点捜査開始", "読み合い見習い", "読み合いの常連", "五十の読み筋", "読み合い百景", "戦略型の主", "千回の読み合い"]],
    ["team", "2on2", "∞", ["相棒募集中", "連携見習い", "チームの常連", "五十の共闘", "連携百景", "2on2の主", "千回の共闘"]],
    ["royale", "バトルロワイヤル", "♛", ["四人寄れば", "混戦見習い", "混戦の常連", "五十の乱戦", "乱戦百景", "BRの主", "千回の混戦"]],
  ].forEach(([mode, label, icon, names]) => addSeries({
    scope: "battle",
    category: "battle_modes",
    family: `battle_${mode}`,
    familyLabel: label,
    icon,
    thresholds: [1, 5, 20, 50, 100, 300, 1000],
    names,
    description: (target) => `${label}を${target}試合完走した`,
  }));

  definitions.push(Object.freeze({
    id: "battle_variety_2",
    scope: "battle",
    category: "battle_variety",
    family: "battle_variety",
    familyLabel: "モード回遊",
    icon: "✦",
    level: 1,
    target: 2,
    name: "二つの入口",
    description: "2種類のオンライン対戦モードを完走した",
    hint: "いつもと違う入口へ行くと解除",
    autoPublic: true,
  }));
  const varietyStart = definitions.length;
  addSeries({
    scope: "battle",
    category: "battle_variety",
    family: "battle_variety",
    familyLabel: "モード回遊",
    icon: "✦",
    thresholds: [1, 5, 20, 50, 100],
    names: ["四つの入口", "全方位型・初級", "全方位型・中級", "全方位型・上級", "スタジアムの旅人"],
    description: (target) => `4種類のオンライン対戦モードをそれぞれ${target}試合完走した`,
    hint: "いつもと違う入口へ行くと解除",
  });
  definitions.splice(varietyStart, 5, ...definitions.slice(varietyStart, varietyStart + 5).map((definition, index) => Object.freeze({
    ...definition,
    id: `battle_variety_all_${definition.target}`,
    level: index + 2,
  })));

  addSeries({
    scope: "battle",
    category: "battle_loss",
    family: "battle_losses",
    familyLabel: "通算敗北",
    icon: "☂",
    thresholds: [1, 10, 30, 100, 300, 1000],
    names: ["黒星デビュー", "負けても貼る", "敗北を知る者", "百敗将軍", "負けの向こう側", "千敗の景色"],
    description: (target) => `オンライン対戦で通算${target}敗を記録した`,
    autoPublic: false,
  });
  addSeries({
    scope: "battle",
    category: "battle_loss",
    family: "battle_loss_streak",
    familyLabel: "連敗",
    icon: "≋",
    thresholds: [3, 5, 8, 12],
    names: ["三連敗、通常運転", "沼もまたスタジアム", "出口はどこ", "それでも貼る"],
    description: (target) => `${target}連敗しても対戦を続けた`,
    autoPublic: false,
  });
  addSeries({
    scope: "battle",
    category: "battle_days",
    family: "battle_days",
    familyLabel: "対戦日数",
    icon: "◷",
    thresholds: [3, 7, 14, 30, 60, 100],
    names: ["三日通い", "七日分の一枚", "二週間の顔", "月の常連", "二か月の住人", "百日の貼り手"],
    description: (target) => `異なる${target}日でオンライン対戦を完走した`,
  });

  addSeries({
    scope: "market",
    category: "market_roles",
    family: "market_seller",
    familyLabel: "売り手成約",
    icon: "◆",
    thresholds: [1, 3, 10, 30, 100, 300],
    names: ["成約第一号", "駆け出しセラー", "推しの営業担当", "市場の顔役", "百戦錬磨の売り手", "価値をつくる人"],
    description: (target) => `ランキング集計対象の売買を売り手として${target}件成立させた`,
  });
  addSeries({
    scope: "market",
    category: "market_roles",
    family: "market_buyer",
    familyLabel: "買い手購入",
    icon: "◈",
    thresholds: [1, 3, 10, 30, 100, 300],
    names: ["はじめての推し買い", "目利き見習い", "推し値コレクター", "市場の目利き", "百の価値を見た者", "推し値の証人"],
    description: (target) => `ランキング集計対象の売買を買い手として${target}件成立させた`,
  });
  addSeries({
    scope: "market",
    category: "market_balance",
    family: "market_both",
    familyLabel: "両役割",
    icon: "⇄",
    thresholds: [1, 3, 10, 30, 100],
    names: ["市場の両面", "売って買って", "VALUE TRADER", "市場を回す人", "推し値市場の住人"],
    description: (target) => `売却と購入をそれぞれ${target}件成立させた`,
  });
  addSeries({
    scope: "market",
    category: "market_community",
    family: "market_days",
    familyLabel: "市場利用日数",
    icon: "▦",
    thresholds: [2, 7, 30, 100],
    names: ["また来た", "七日市場", "月の常連商人", "商いは続く"],
    description: (target) => `異なる${target}日でランキング集計対象の売買を成立させた`,
  });
  addSeries({
    scope: "market",
    category: "market_community",
    family: "market_partners",
    familyLabel: "取引相手",
    icon: "◎",
    thresholds: [3, 10, 30, 100],
    names: ["顔見知り", "市場に知り合いが増えた", "取引網", "スタジアム商会"],
    description: (target) => `${target}人の異なる相手とランキング集計対象の売買を成立させた`,
  });
  [
    ["market_first_turn", "即決", "第1営業ターンで売買が成立した", "✧"],
    ["market_extended", "もう1ターンの価値", "追加検討を経て売買が成立した", "＋"],
    ["market_third_turn", "三度目の正直", "第3営業ターンで売買が成立した", "Ⅲ"],
    ["market_both_roles_day", "一日二役", "同じ日に売り手と買い手の両方で成立取引を行った", "☀"],
    ["market_role_switch", "立場を替えて", "前回とは反対の役割で成立取引を行った", "↻"],
  ].forEach(([id, name, description, icon]) => definitions.push(Object.freeze({
    id,
    scope: "market",
    category: "market_discovery",
    family: id,
    familyLabel: "市場の発見",
    icon,
    level: 1,
    target: 1,
    name,
    description,
    hint: "市場で少し変わった取引をすると解除",
    autoPublic: true,
  })));

  const catalog = Object.freeze(definitions);
  const byId = new Map(catalog.map((definition) => [definition.id, definition]));
  const categoryInfo = Object.freeze([
    { id: "battle_record", label: "通算対戦", copy: "勝敗に関係なく、正式な対戦を完走した記録" },
    { id: "battle_modes", label: "モード別", copy: "4種類のオンライン対戦で遊んだ記録" },
    { id: "battle_variety", label: "モード回遊", copy: "複数の入口を訪れたオールラウンダーの記録" },
    { id: "battle_loss", label: "敗北も記録", copy: "勝てない日も貼り続けた記録" },
    { id: "battle_days", label: "継続", copy: "異なる日にスタジアムへ戻ってきた記録" },
    { id: "market_roles", label: "市場の役割", copy: "売り手・買い手として成立させた取引の記録" },
    { id: "market_balance", label: "市場を回す", copy: "両方の役割を体験した記録" },
    { id: "market_community", label: "市場の交流", copy: "日数と異なる取引相手の記録" },
    { id: "market_discovery", label: "市場の発見", copy: "商談の中で見つかる一度限りの隠し実績" },
  ]);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeIds(value, maximum = catalog.length) {
    const candidates = typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value
        : Object.entries(value && typeof value === "object" ? value : {})
          .filter(([, enabled]) => enabled === true)
          .map(([id]) => id);
    return [...new Set(candidates.map(String).filter((id) => byId.has(id)))].slice(0, maximum);
  }

  function canonicalShowcase(value, unlocked) {
    const result = [];
    normalizeIds(value, MAX_SHOWCASE).filter((id) => unlocked[id]).forEach((id) => {
      const definition = byId.get(id);
      const highest = catalog
        .filter((candidate) => candidate.family === definition.family && unlocked[candidate.id])
        .sort((first, second) => second.level - first.level)[0] || definition;
      if (!result.includes(highest.id)) result.push(highest.id);
    });
    return result;
  }

  function normalizeProfile(value) {
    const unlocked = {};
    Object.entries(value?.unlocked || {}).forEach(([id, timestamp]) => {
      if (byId.has(id) && Number(timestamp) > 0) unlocked[id] = Number(timestamp);
    });
    return {
      unlocked,
      pendingUnlocks: normalizeIds(value?.pendingUnlocks),
      customShowcase: canonicalShowcase(value?.customShowcase, unlocked),
      showcase: normalizeIds(value?.showcase, MAX_SHOWCASE).filter((id) => unlocked[id]),
      unlockedCount: Math.max(Object.keys(unlocked).length, Number(value?.unlockedCount || 0)),
      totalCount: catalog.length,
      stats: value?.stats && typeof value.stats === "object" ? value.stats : {},
    };
  }

  function renderBadges(value, { compact = true, empty = "" } = {}) {
    const ids = normalizeIds(value, MAX_SHOWCASE);
    if (!ids.length) return empty;
    return `<span class="achievement-badges ${compact ? "is-compact" : ""}" aria-label="実績ショーケース">${ids.map((id) => {
      const achievement = byId.get(id);
      return `<span class="achievement-badge achievement-scope-${achievement.scope}" title="${escapeHtml(`${achievement.name} / ${achievement.description}`)}"><i aria-hidden="true">${escapeHtml(achievement.icon)}</i><span>${escapeHtml(achievement.name)}</span><small>Lv.${achievement.level}</small></span>`;
    }).join("")}</span>`;
  }

  function highestUnlockedByFamily(profile) {
    const highest = new Map();
    catalog.forEach((definition) => {
      if (!profile.unlocked[definition.id]) return;
      const current = highest.get(definition.family);
      if (!current || definition.level > current.level) highest.set(definition.family, definition);
    });
    return highest;
  }

  function renderCollection(value) {
    const profile = normalizeProfile(value);
    const highest = highestUnlockedByFamily(profile);
    const showcased = new Set(profile.showcase);
    const sections = categoryInfo.map((category) => {
      const families = [...new Set(catalog.filter((definition) => definition.category === category.id).map((definition) => definition.family))];
      const cards = families.map((family) => {
        const familyDefinitions = catalog.filter((definition) => definition.family === family).sort((a, b) => a.level - b.level);
        const current = highest.get(family);
        const next = current
          ? familyDefinitions.find((definition) => definition.level > current.level)
          : familyDefinitions[0];
        const selected = current && showcased.has(current.id);
        const unlockedClass = current ? "is-unlocked" : "is-locked";
        return `<article class="achievement-family-card ${unlockedClass} ${selected ? "is-showcased" : ""}">
          <div class="achievement-family-icon" aria-hidden="true">${current ? escapeHtml(current.icon) : "?"}</div>
          <div class="achievement-family-copy">
            <span>${escapeHtml(current?.familyLabel || next?.familyLabel || "隠し実績")}</span>
            <h3>${current ? escapeHtml(current.name) : "？？？"}</h3>
            <p>${current ? escapeHtml(current.description) : escapeHtml(next?.hint || "遊び続けると解除")}</p>
            <small>${current ? `Lv.${current.level} / ${familyDefinitions.at(-1).level}` : `未解除 / 最大Lv.${familyDefinitions.at(-1).level}`}${next && current ? "・次の条件は非公開" : ""}</small>
          </div>
          ${current ? `<button class="achievement-showcase-toggle ${selected ? "is-selected" : ""}" type="button" data-achievement-showcase="${escapeHtml(current.id)}" aria-pressed="${selected}">${selected ? "展示中" : "展示する"}</button>` : ""}
        </article>`;
      }).join("");
      return `<section class="achievement-category" aria-labelledby="achievementCategory-${escapeHtml(category.id)}">
        <div class="achievement-category-head"><div><span>ACHIEVEMENT SERIES</span><h2 id="achievementCategory-${escapeHtml(category.id)}">${escapeHtml(category.label)}</h2></div><p>${escapeHtml(category.copy)}</p></div>
        <div class="achievement-family-grid">${cards}</div>
      </section>`;
    }).join("");
    return `<div class="achievement-summary">
        <div><span>UNLOCKED</span><strong>${profile.unlockedCount}<small> / ${profile.totalCount}</small></strong></div>
        <div><span>SHOWCASE</span>${renderBadges(profile.showcase, { compact: false, empty: "<em>自動選択される実績はまだありません</em>" })}</div>
      </div>
      <div class="achievement-showcase-guide"><p>ランキングへ表示する実績は最大${MAX_SHOWCASE}件です。敗北実績は自動公開されません。</p>
        <button class="button button-ghost button-small" type="button" data-achievement-showcase-auto ${profile.customShowcase.length ? "" : "disabled"}>自動選択に戻す</button></div>
      ${sections}`;
  }

  let unlockQueue = [];
  let unlockTimer = null;
  const sessionSeen = new Set();

  function showNextUnlock() {
    unlockTimer = null;
    const ids = unlockQueue.splice(0, unlockQueue.length);
    if (!ids.length) return;
    const first = byId.get(ids[0]);
    if (!first) return;
    let layer = document.querySelector("#achievementUnlockLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "achievementUnlockLayer";
      layer.className = "achievement-unlock-layer";
      layer.setAttribute("aria-live", "polite");
      document.body.append(layer);
    }
    layer.innerHTML = `<article class="achievement-unlock-card">
      <span class="achievement-unlock-kicker">ACHIEVEMENT UNLOCKED</span>
      <div><i aria-hidden="true">${escapeHtml(first.icon)}</i><span><strong>${escapeHtml(first.name)}</strong><small>${escapeHtml(first.description)}</small></span></div>
      ${ids.length > 1 ? `<p>ほか${ids.length - 1}件の実績も解除しました</p>` : ""}
    </article>`;
    layer.classList.add("is-visible");
    window.setTimeout(() => layer.classList.remove("is-visible"), 4200);
  }

  function notify(value) {
    const ids = normalizeIds(value).filter((id) => {
      if (sessionSeen.has(id)) return false;
      sessionSeen.add(id);
      return true;
    });
    if (!ids.length) return;
    unlockQueue.push(...ids);
    if (unlockTimer) return;
    unlockTimer = window.setTimeout(showNextUnlock, 500);
  }

  window.addEventListener("hariai-achievements-unlocked", (event) => notify(event.detail?.ids || []));
  window.HariaiAchievements = Object.freeze({
    catalog,
    byId,
    normalizeIds,
    normalizeProfile,
    notify,
    renderBadges,
    renderCollection,
  });
})();
