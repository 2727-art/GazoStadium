(function () {
  "use strict";

  const MAIN_COUNT = 5;
  const RESERVE_COUNT = 5;
  const MAX_HP = 30;
  const MAX_ROUNDS = 5;
  const EXTRA_REQUESTS = 2;
  const PURSUIT_PERMITS = 1;
  const MAX_PURSUIT_LINE_LENGTH = 40;
  const CUSTOM_PURSUIT_VALUE = "__custom__";
  const PURSUIT_LINES = [
    "その反応、見逃さない。もう一枚いく！",
    "好みは読めた。ここからが本命だ！",
    "刺さったね？ 追撃開始！",
    "まだ終わらない。次の一枚をどうぞ！",
  ];

  const app = document.querySelector("#app");
  const destroyDialog = document.querySelector("#destroyDialog");
  let active = false;
  let state = createState();

  const shared = () => window.HariaiApp?.shared;
  const escapeHtml = (value) => shared()?.escapeHtml(value) ?? String(value);
  const showToast = (message) => shared()?.showToast(message);
  const setBusy = (busy, message) => shared()?.setBusy(busy, message);

  function createPlayer(index) {
    return {
      name: `PLAYER ${index + 1}`,
      clues: ["", "", ""],
      bluffIndex: null,
      pursuitLine: PURSUIT_LINES[index % PURSUIT_LINES.length],
      main: [],
      reserve: [],
      hp: MAX_HP,
      extraRequests: EXTRA_REQUESTS,
      pursuitPermits: PURSUIT_PERMITS,
      totalPower: 0,
      receivedScores: [],
    };
  }

  function createState() {
    return {
      screen: "profile",
      players: [createPlayer(0), createPlayer(1)],
      profilePlayer: 0,
      buildPlayer: 0,
      round: 1,
      history: [],
      current: null,
      scoreQueue: [],
      actionSelectQueue: [],
      actionScoreQueue: [],
      handoffAction: null,
    };
  }

  function createRound() {
    return {
      round: state.round,
      baseCards: [null, null],
      ratings: [null, null],
      reactions: ["normal", "normal"],
      actions: [null, null],
      actionRatings: [null, null],
      powers: [0, 0],
      damage: [0, 0],
    };
  }

  function start() {
    if (active) return;
    if (window.HariaiOnline?.isActive?.() || window.HariaiTeam?.isActive?.() || window.HariaiRoyale?.isActive?.()) {
      showToast("進行中のオンライン画面を終了してから開いてください。");
      return;
    }
    active = true;
    state = createState();
    setStrategyChrome("PROFILE 1 / 2");
    renderProfile(0);
  }

  function isActive() {
    return active;
  }

  function requestHome() {
    if (!active) return;
    const title = destroyDialog?.querySelector("h2");
    const body = destroyDialog?.querySelector("p");
    const confirm = destroyDialog?.querySelector("#confirmDestroy");
    if (title) title.textContent = "戦略型1on1対戦を終了しますか？";
    if (body) body.textContent = "選択した画像、自己紹介、戦略型1on1対戦の進行状況を端末メモリから破棄します。";
    if (confirm) confirm.textContent = "戦略型1on1対戦を終了";
    destroyDialog?.showModal();
  }

  function destroyRoom() {
    if (!active) return;
    cleanupImages();
    active = false;
    state = createState();
    window.HariaiApp?.returnHome?.();
  }

  function cleanupImages() {
    state.players.forEach((player) => {
      [...player.main, ...player.reserve].forEach((item) => URL.revokeObjectURL(item.url));
    });
  }

  function setStrategyChrome(label) {
    const status = document.querySelector(".status-dot");
    const privacy = document.querySelector(".privacy-badge");
    const footerItems = document.querySelectorAll(".site-footer span");
    if (status) status.innerHTML = `<i></i> ${escapeHtml(label)}`;
    if (privacy) privacy.textContent = "端末内プロトタイプ";
    if (footerItems[0]) footerItems[0].textContent = "STRATEGY 1ON1 / OFFLINE PASS & PLAY";
    if (footerItems[1]) footerItems[1].textContent = "画像と自己紹介はブラウザメモリ内だけで使用します";
  }

  function focusScreen() {
    app.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderProfile(playerIndex) {
    state.screen = "profile";
    state.profilePlayer = playerIndex;
    setStrategyChrome(`PROFILE ${playerIndex + 1} / 2`);
    const player = state.players[playerIndex];
    const usesCustomPursuitLine = !PURSUIT_LINES.includes(player.pursuitLine);
    app.innerHTML = `<section class="screen strategy-screen">
      <div class="section-head">
        <div><span class="eyebrow">STRATEGY 1ON1 / PROFILE</span><h1>秘密のプロフィール登録</h1>
          <p>3つの好みを書き、そのうち1つだけをブラフにします。相手には名前もブラフの答えも見えません。</p></div>
        <span class="strategy-step">${playerIndex + 1} / 2</span>
      </div>
      <div class="strategy-profile-layout">
        <aside class="setup-guide">
          <h2>読み合いのルール</h2>
          <ol class="guide-list">
            <li><b>1</b><span>空欄をなくすため、3つの手掛かりはすべて必須です。</span></li>
            <li><b>2</b><span>ブラフは1つだけ。残り2つは本当の好みを書きます。</span></li>
            <li><b>3</b><span>追撃セリフは定型文または1行40文字までの自由記述で事前登録します。</span></li>
          </ol>
          <p class="privacy-note">次のプレイヤーへ渡す前に確認画面を挟みます。戻る操作で相手の入力内容を見ないでください。</p>
        </aside>
        <form class="setup-panel strategy-form" id="strategyProfileForm">
          <label class="field-label">プレイヤーネーム（対戦開始まで非公開）
            <input class="text-input" id="strategyName" maxlength="16" autocomplete="off" value="${escapeHtml(player.name)}" required />
          </label>
          <fieldset class="strategy-clue-fieldset">
            <legend>好きなものの手掛かり（1つだけブラフを選択）</legend>
            ${player.clues.map((clue, index) => `<label class="strategy-clue-row">
              <input type="radio" name="bluff" value="${index}" ${player.bluffIndex === index ? "checked" : ""} required />
              <span class="bluff-selector">弱点</span>
              <input class="text-input strategy-clue-input" data-clue-index="${index}" maxlength="80" autocomplete="off" placeholder="例：雨の日の街並みに弱い" value="${escapeHtml(clue)}" required />
            </label>`).join("")}
          </fieldset>
          <div class="pursuit-line-settings">
            <label class="field-label">追撃時のセリフ
              <select class="text-input" id="strategyPursuitLine">
                ${PURSUIT_LINES.map((line) => `<option value="${escapeHtml(line)}" ${line === player.pursuitLine ? "selected" : ""}>${escapeHtml(line)}</option>`).join("")}
                <option value="${CUSTOM_PURSUIT_VALUE}" ${usesCustomPursuitLine ? "selected" : ""}>自由記述</option>
              </select>
            </label>
            <div class="pursuit-custom-field" id="strategyCustomPursuitField" ${usesCustomPursuitLine ? "" : "hidden"}>
              <label class="field-label">自由記述（1行・最大${MAX_PURSUIT_LINE_LENGTH}文字）
                <input class="text-input" id="strategyCustomPursuitLine" maxlength="${MAX_PURSUIT_LINE_LENGTH}" autocomplete="off" placeholder="追撃時に表示するセリフ" value="${usesCustomPursuitLine ? escapeHtml(player.pursuitLine) : ""}" />
              </label>
              <span class="pursuit-character-count"><b id="strategyPursuitCharacterCount">${usesCustomPursuitLine ? player.pursuitLine.length : 0}</b> / ${MAX_PURSUIT_LINE_LENGTH}</span>
            </div>
            <p class="pursuit-line-note">自由記述が空白の場合は最初の定型セリフを使用します。入力内容はHTMLとして実行されません。</p>
          </div>
          <div class="screen-actions setup-actions">
            <button class="button button-primary" type="submit">プロフィールを封印</button>
          </div>
        </form>
      </div>
    </section>`;
    document.querySelector("#strategyProfileForm")?.addEventListener("submit", saveProfile);
    bindStrategyPursuitFields();
    focusScreen();
  }

  function bindStrategyPursuitFields() {
    const select = document.querySelector("#strategyPursuitLine");
    const field = document.querySelector("#strategyCustomPursuitField");
    const input = document.querySelector("#strategyCustomPursuitLine");
    const counter = document.querySelector("#strategyPursuitCharacterCount");
    const syncCustomVisibility = () => {
      if (field) field.hidden = select?.value !== CUSTOM_PURSUIT_VALUE;
    };
    select?.addEventListener("change", () => {
      syncCustomVisibility();
      if (select.value === CUSTOM_PURSUIT_VALUE) input?.focus();
    });
    input?.addEventListener("input", () => {
      input.value = sanitizePursuitLineDraft(input.value);
      if (counter) counter.textContent = String(input.value.length);
    });
    syncCustomVisibility();
  }

  function saveProfile(event) {
    event.preventDefault();
    const playerIndex = state.profilePlayer;
    const player = state.players[playerIndex];
    const name = document.querySelector("#strategyName")?.value.trim() || "";
    const clues = [...document.querySelectorAll(".strategy-clue-input")].map((input) => input.value.trim());
    const bluff = document.querySelector('input[name="bluff"]:checked');
    if (!name || clues.some((clue) => !clue) || !bluff) {
      showToast("名前、3つの手掛かり、ブラフ1つをすべて入力してください。");
      return;
    }
    player.name = name;
    player.clues = clues;
    player.bluffIndex = Number(bluff.value);
    const pursuitChoice = document.querySelector("#strategyPursuitLine")?.value || PURSUIT_LINES[0];
    const customPursuitLine = document.querySelector("#strategyCustomPursuitLine")?.value || "";
    player.pursuitLine = pursuitChoice === CUSTOM_PURSUIT_VALUE
      ? normalizePursuitLine(customPursuitLine)
      : normalizePursuitLine(pursuitChoice);
    window.HariaiAudio?.playButton?.("confirm");
    if (playerIndex === 0) {
      renderHandoff(1, "PLAYER 2へ交代", "PLAYER 1のプロフィールを封印しました。画面を見せずに端末を渡してください。", () => renderProfile(1));
    } else {
      renderHandoff(0, "匿名紹介を確認", "PLAYER 1は、相手の自己紹介から好みを推理してデッキを組みます。", () => renderAnonymousIntro(0));
    }
  }

  function renderHandoff(playerIndex, title, body, action) {
    state.screen = "handoff";
    state.handoffAction = action;
    setStrategyChrome(`HANDOFF / PLAYER ${playerIndex + 1}`);
    app.innerHTML = `<section class="screen handoff-wrap strategy-handoff">
      <article class="handoff-card">
        <div class="handoff-icon" aria-hidden="true">⇄</div>
        <span class="eyebrow">PASS THE DEVICE</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(body)}</p>
        <button class="button button-primary" id="strategyHandoffReady">PLAYER ${playerIndex + 1}が受け取った</button>
      </article>
    </section>`;
    document.querySelector("#strategyHandoffReady")?.addEventListener("click", () => {
      const next = state.handoffAction;
      state.handoffAction = null;
      next?.();
    });
    focusScreen();
  }

  function renderAnonymousIntro(playerIndex) {
    state.screen = "intro";
    state.buildPlayer = playerIndex;
    const opponent = state.players[1 - playerIndex];
    setStrategyChrome(`SCOUTING / PLAYER ${playerIndex + 1}`);
    app.innerHTML = `<section class="screen strategy-screen strategy-intro-screen">
      <div class="strategy-anonymous-head">
        <span class="strategy-anonymous-icon" aria-hidden="true">?</span>
        <div><span class="eyebrow">ANONYMOUS OPPONENT</span><h1>対戦相手の自己紹介</h1>
          <p>3つのうち1つはブラフです。名前はデッキ確定後に公開されます。</p></div>
      </div>
      <div class="strategy-clue-cards">
        ${opponent.clues.map((clue, index) => `<article><small>手掛かり ${String(index + 1).padStart(2, "0")}</small><p>${escapeHtml(clue)}</p></article>`).join("")}
      </div>
      <div class="strategy-intro-actions">
        <button class="button button-danger" id="strategyWithdraw">この勝負から撤退</button>
        <button class="button button-primary" id="strategyAccept">推理してデッキを組む</button>
      </div>
      <p class="strategy-rule-note">試作版では撤退するとノーコンテストで終了します。オンライン化する場合は回数制限・再マッチ防止を想定しています。</p>
    </section>`;
    document.querySelector("#strategyWithdraw")?.addEventListener("click", renderWithdrawn);
    document.querySelector("#strategyAccept")?.addEventListener("click", () => renderDeckBuilder(playerIndex));
    focusScreen();
  }

  function renderWithdrawn() {
    state.screen = "withdrawn";
    setStrategyChrome("NO CONTEST");
    app.innerHTML = `<section class="screen handoff-wrap strategy-handoff">
      <article class="handoff-card strategy-withdraw-card">
        <div class="handoff-icon" aria-hidden="true">×</div>
        <span class="eyebrow">NO CONTEST</span><h1>勝負を撤退しました</h1>
        <p>相手のプレイヤーネームは公開されません。戦略型1on1対戦の結果や通常型の戦績にも影響しません。</p>
        <button class="button button-primary" id="strategyWithdrawHome">タイトルへ戻る</button>
      </article>
    </section>`;
    document.querySelector("#strategyWithdrawHome")?.addEventListener("click", destroyRoom);
    focusScreen();
  }

  function renderDeckBuilder(playerIndex) {
    state.screen = "deck";
    state.buildPlayer = playerIndex;
    const player = state.players[playerIndex];
    const opponent = state.players[1 - playerIndex];
    setStrategyChrome(`DECK BUILD / PLAYER ${playerIndex + 1}`);
    app.innerHTML = `<section class="screen strategy-screen">
      <div class="section-head">
        <div><span class="eyebrow">COUNTER DECK BUILD</span><h1>相手に刺さる10枚を選ぶ</h1>
          <p>メインは必ず5枚。リザーブは最大5枚で、追加要求への再提示と追撃に使います。</p></div>
        <span class="strategy-step">PLAYER ${playerIndex + 1}</span>
      </div>
      <div class="strategy-build-layout">
        <aside class="strategy-scout-note">
          <span>SCOUTING MEMO</span>
          <h2>匿名の対戦相手</h2>
          ${opponent.clues.map((clue, index) => `<p><b>${index + 1}</b>${escapeHtml(clue)}</p>`).join("")}
          <small>このうち1つはブラフです。</small>
        </aside>
        <div class="strategy-deck-panel">
          ${renderDeckZone(playerIndex, "main")}
          ${renderDeckZone(playerIndex, "reserve")}
          <div class="screen-actions setup-actions">
            <button class="button button-primary" id="strategyLockDeck" ${player.main.length === MAIN_COUNT ? "" : "disabled"}>デッキを封印する</button>
          </div>
        </div>
      </div>
    </section>`;
    bindDeckEvents(playerIndex);
    focusScreen();
  }

  function renderDeckZone(playerIndex, zone) {
    const player = state.players[playerIndex];
    const isMain = zone === "main";
    const items = player[zone];
    const limit = isMain ? MAIN_COUNT : RESERVE_COUNT;
    const zoneLabel = isMain ? "MAIN DECK / 必須" : "RESERVE / 任意";
    const help = isMain ? "各ラウンドで1枚ずつ使用" : "再提示または追撃で消費";
    return `<section class="strategy-deck-zone ${zone}">
      <div class="deck-toolbar">
        <div><span class="eyebrow">${zoneLabel}</span><p>${help}</p></div>
        <div class="deck-counter"><strong>${items.length}</strong> / ${limit}</div>
        <div class="upload-actions">
          <label class="button button-ghost button-small file-button">画像を追加
            <input type="file" accept="image/*" multiple data-strategy-upload="${zone}" />
          </label>
          <button class="button button-ghost button-small" data-strategy-sample="${zone}" ${items.length >= limit ? "disabled" : ""}>サンプルで補充</button>
        </div>
      </div>
      <div class="strategy-deck-grid">
        ${Array.from({ length: limit }, (_, index) => {
          const item = items[index];
          return item ? `<article class="deck-slot">
            <img src="${item.url}" alt="${isMain ? "メイン" : "リザーブ"}画像 ${index + 1}" />
            <div class="deck-label"><span>${isMain ? "MAIN" : "RESERVE"} ${String(index + 1).padStart(2, "0")}</span><button class="remove-card" type="button" data-strategy-remove="${zone}:${item.id}" aria-label="画像を外す">×</button></div>
          </article>` : `<div class="deck-slot empty"><span>+</span></div>`;
        }).join("")}
      </div>
    </section>`;
  }

  function bindDeckEvents(playerIndex) {
    document.querySelectorAll("[data-strategy-upload]").forEach((input) => {
      input.addEventListener("change", (event) => addDeckFiles(playerIndex, input.dataset.strategyUpload, [...event.target.files]));
    });
    document.querySelectorAll("[data-strategy-sample]").forEach((button) => {
      button.addEventListener("click", () => fillDeckSamples(playerIndex, button.dataset.strategySample));
    });
    document.querySelectorAll("[data-strategy-remove]").forEach((button) => {
      button.addEventListener("click", () => removeDeckItem(playerIndex, button.dataset.strategyRemove));
    });
    document.querySelector("#strategyLockDeck")?.addEventListener("click", () => lockDeck(playerIndex));
  }

  async function addDeckFiles(playerIndex, zone, files) {
    const player = state.players[playerIndex];
    const limit = zone === "main" ? MAIN_COUNT : RESERVE_COUNT;
    const room = Math.max(0, limit - player[zone].length);
    if (!room) return;
    setBusy(true, "デッキ画像を準備しています…");
    try {
      const accepted = files.slice(0, room);
      for (const file of accepted) {
        const position = zone === "main" ? player.main.length : MAIN_COUNT + player.reserve.length;
        const item = await shared().processImageFile(file, position, { maxSide: 1280, quality: 0.84 });
        player[zone].push(item);
      }
      if (files.length > room) showToast(`${limit}枚を超えた画像は追加していません。`);
    } catch (error) {
      showToast(error.message || "画像を追加できませんでした。");
    } finally {
      setBusy(false);
      renderDeckBuilder(playerIndex);
    }
  }

  async function fillDeckSamples(playerIndex, zone) {
    const player = state.players[playerIndex];
    const limit = zone === "main" ? MAIN_COUNT : RESERVE_COUNT;
    const missing = limit - player[zone].length;
    if (missing <= 0) return;
    setBusy(true, "サンプル画像を生成しています…");
    try {
      const offset = zone === "main" ? player.main.length : MAIN_COUNT + player.reserve.length;
      const items = await shared().createSampleItems(playerIndex, missing, offset);
      player[zone].push(...items);
    } catch (error) {
      showToast(error.message || "サンプル画像を生成できませんでした。");
    } finally {
      setBusy(false);
      renderDeckBuilder(playerIndex);
    }
  }

  function removeDeckItem(playerIndex, token) {
    const [zone, id] = token.split(":");
    const items = state.players[playerIndex][zone];
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;
    const [removed] = items.splice(index, 1);
    URL.revokeObjectURL(removed.url);
    renderDeckBuilder(playerIndex);
  }

  function lockDeck(playerIndex) {
    if (state.players[playerIndex].main.length !== MAIN_COUNT) {
      showToast("メインデッキを5枚そろえてください。");
      return;
    }
    window.HariaiAudio?.playButton?.("confirm");
    if (playerIndex === 0) {
      renderHandoff(1, "PLAYER 2へ交代", "PLAYER 1のデッキを封印しました。PLAYER 2は匿名紹介を確認します。", () => renderAnonymousIntro(1));
    } else {
      renderHandoff(0, "対戦準備完了", "両者のデッキが封印されました。ここからプレイヤーネームを公開します。", renderIdentityReveal);
    }
  }

  function renderIdentityReveal() {
    state.screen = "identity";
    setStrategyChrome("IDENTITY REVEAL");
    app.innerHTML = `<section class="screen strategy-screen strategy-identity-screen">
      <div class="strategy-versus-title"><span class="eyebrow">IDENTITY REVEAL</span><h1>対戦相手、判明</h1><p>ブラフの答えは試合終了まで秘密です。</p></div>
      <div class="strategy-identity-grid">
        ${state.players.map((player, index) => `<article class="strategy-identity-card player-${index + 1}">
          <small>PLAYER ${index + 1}</small><h2>${escapeHtml(player.name)}</h2>
          <div><span>MAIN</span><strong>${player.main.length}</strong></div><div><span>RESERVE</span><strong>${player.reserve.length}</strong></div>
        </article>`).join("")}
        <div class="strategy-vs-mark">VS</div>
      </div>
      <button class="button button-primary strategy-center-button" id="strategyBattleStart">画像貼り合い開始</button>
    </section>`;
    document.querySelector("#strategyBattleStart")?.addEventListener("click", beginRound);
    focusScreen();
  }

  function beginRound() {
    state.current = createRound();
    renderHandoff(0, `ROUND ${state.round} / 画像選択`, `${state.players[0].name}は、未使用のメイン画像を1枚選びます。`, () => renderBaseSelect(0));
  }

  function unusedMain(playerIndex) {
    return state.players[playerIndex].main.filter((item) => !item.used);
  }

  function unusedReserve(playerIndex) {
    return state.players[playerIndex].reserve.filter((item) => !item.used);
  }

  function renderBaseSelect(playerIndex) {
    state.screen = "base-select";
    setStrategyChrome(`ROUND ${state.round} / SECRET PICK`);
    const player = state.players[playerIndex];
    const items = unusedMain(playerIndex);
    app.innerHTML = `<section class="screen strategy-screen">
      ${renderBattleHud()}
      <div class="section-head strategy-compact-head"><div><span class="eyebrow">SECRET MAIN PICK</span><h1>${escapeHtml(player.name)}の画像選択</h1><p>相手の自己紹介を思い出し、今ラウンドに出す1枚を選んでロックします。</p></div></div>
      <div class="strategy-pick-grid">
        ${items.map((item) => `<button class="select-card strategy-pick-card" type="button" data-base-card="${item.id}"><img src="${item.url}" alt="選択候補" /><span>この画像を選ぶ</span></button>`).join("")}
      </div>
    </section>`;
    document.querySelectorAll("[data-base-card]").forEach((button) => {
      button.addEventListener("click", () => lockBaseCard(playerIndex, button.dataset.baseCard));
    });
    focusScreen();
  }

  function lockBaseCard(playerIndex, cardId) {
    const item = state.players[playerIndex].main.find((card) => card.id === cardId && !card.used);
    if (!item) return;
    item.used = true;
    state.current.baseCards[playerIndex] = item;
    window.HariaiAudio?.playButton?.("confirm");
    if (playerIndex === 0) {
      renderHandoff(1, `ROUND ${state.round} / 画像選択`, `${state.players[1].name}は、未使用のメイン画像を1枚選びます。`, () => renderBaseSelect(1));
    } else {
      renderBaseReveal();
    }
  }

  function renderBaseReveal() {
    state.screen = "base-reveal";
    setStrategyChrome(`ROUND ${state.round} / REVEAL`);
    app.innerHTML = `<section class="screen strategy-screen">
      ${renderBattleHud()}
      <div class="strategy-versus-title"><span class="eyebrow">SIMULTANEOUS REVEAL</span><h1>メイン画像公開</h1><p>このあと、相手の画像を1人ずつ秘密採点します。</p></div>
      <div class="strategy-reveal-grid">
        ${state.current.baseCards.map((item, index) => renderBattleImage(item, state.players[index].name, `PLAYER ${index + 1}`)).join("")}
      </div>
      <button class="button button-primary strategy-center-button" id="strategyBeginRating">秘密採点へ</button>
    </section>`;
    document.querySelector("#strategyBeginRating")?.addEventListener("click", () => {
      state.scoreQueue = [0, 1];
      renderNextBaseRating();
    });
    focusScreen();
  }

  function renderNextBaseRating() {
    const rater = state.scoreQueue.shift();
    if (rater === undefined) {
      prepareActions();
      return;
    }
    renderHandoff(rater, `ROUND ${state.round} / 秘密採点`, `${state.players[rater].name}が相手の画像を本音で採点します。`, () => renderBaseRating(rater));
  }

  function renderBaseRating(rater) {
    state.screen = "base-rating";
    const owner = 1 - rater;
    const player = state.players[rater];
    const canRequest = player.extraRequests > 0 && unusedReserve(owner).length > 0;
    const canPermit = player.pursuitPermits > 0 && unusedReserve(owner).length > 0;
    setStrategyChrome(`ROUND ${state.round} / SECRET SCORE`);
    app.innerHTML = `<section class="screen strategy-screen">
      ${renderBattleHud()}
      <div class="strategy-rating-layout">
        ${renderBattleImage(state.current.baseCards[owner], "相手の画像", "OWNER HIDDEN")}
        <div class="score-panel strategy-score-panel">
          <span class="eyebrow">HONEST SCORE</span><h2>本音の点数を選ぶ</h2>
          <p>点数はラウンドの画像パワーになります。採点確定まで相手には表示されません。</p>
          <div class="score-buttons">${renderScoreButtons()}</div>
          <fieldset class="strategy-reaction-fieldset">
            <legend>戦闘リアクション（点数とは別に選択）</legend>
            <label><input type="radio" name="reaction" value="normal" checked /><span><b>通常</b><small>追加効果なし</small></span></label>
            <label class="reaction-low"><input type="radio" name="reaction" value="request" ${canRequest ? "" : "disabled"} /><span><b>もう1枚見せろ</b><small>残り${player.extraRequests}回 / 1〜3点の時だけ有効</small></span></label>
            <label class="reaction-high"><input type="radio" name="reaction" value="pursuit" ${canPermit ? "" : "disabled"} /><span><b>追撃を許可</b><small>残り${player.pursuitPermits}回 / 9〜10点の時だけ有効</small></span></label>
          </fieldset>
          <button class="button button-primary score-lock" id="strategyLockRating" disabled>採点を封印</button>
        </div>
      </div>
    </section>`;
    bindScoreButtons();
    document.querySelector("#strategyLockRating")?.addEventListener("click", () => lockBaseRating(rater));
    focusScreen();
  }

  function renderScoreButtons() {
    return Array.from({ length: 10 }, (_, index) => {
      const score = index + 1;
      return `<button class="score-button ${score >= 9 ? "critical-zone" : ""}" type="button" data-strategy-score="${score}">${score}</button>`;
    }).join("");
  }

  function bindScoreButtons() {
    document.querySelectorAll("[data-strategy-score]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-strategy-score]").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
        document.querySelector("#strategyLockRating, #strategyLockActionRating")?.removeAttribute("disabled");
      });
    });
  }

  function selectedScore() {
    return Number(document.querySelector("[data-strategy-score].selected")?.dataset.strategyScore || 0);
  }

  function lockBaseRating(rater) {
    const score = selectedScore();
    if (!score) return;
    const requestedReaction = document.querySelector('input[name="reaction"]:checked')?.value || "normal";
    let reaction = requestedReaction;
    if (reaction === "request" && score > 3) {
      reaction = "normal";
      showToast("追加要求は1〜3点の時だけ成立します。今回は通常採点として封印しました。");
    }
    if (reaction === "pursuit" && score < 9) {
      reaction = "normal";
      showToast("追撃許可は9〜10点の時だけ成立します。今回は通常採点として封印しました。");
    }
    state.current.ratings[rater] = score;
    state.current.reactions[rater] = reaction;
    window.HariaiAudio?.playButton?.("confirm");
    renderNextBaseRating();
  }

  function prepareActions() {
    state.actionSelectQueue = [];
    [0, 1].forEach((owner) => {
      const rater = 1 - owner;
      const reaction = state.current.reactions[rater];
      if (reaction === "request") {
        state.players[rater].extraRequests -= 1;
        state.current.actions[owner] = { type: "request", card: null };
        state.actionSelectQueue.push(owner);
      } else if (reaction === "pursuit") {
        state.players[rater].pursuitPermits -= 1;
        state.current.actions[owner] = { type: "pursuit", card: null };
        state.actionSelectQueue.push(owner);
      }
    });
    if (!state.actionSelectQueue.length) {
      resolveRound();
      return;
    }
    renderNextActionSelect();
  }

  function renderNextActionSelect() {
    const owner = state.actionSelectQueue.shift();
    if (owner === undefined) {
      renderActionReveal();
      return;
    }
    const action = state.current.actions[owner];
    const isPursuit = action.type === "pursuit";
    renderHandoff(owner, isPursuit ? "追撃チャンス" : "追加提示を要求された", isPursuit
      ? `${state.players[owner].name}は、リザーブから追撃画像を1枚選べます。`
      : `${state.players[owner].name}は、リザーブからもう1枚を提示してください。`, () => renderActionSelect(owner));
  }

  function renderActionSelect(owner) {
    state.screen = "action-select";
    const action = state.current.actions[owner];
    const isPursuit = action.type === "pursuit";
    const items = unusedReserve(owner);
    setStrategyChrome(`ROUND ${state.round} / ${isPursuit ? "PURSUIT" : "RETRY"}`);
    app.innerHTML = `<section class="screen strategy-screen">
      ${renderBattleHud()}
      <div class="section-head strategy-compact-head"><div><span class="eyebrow">${isPursuit ? "PURSUIT CHANCE" : "ONE MORE IMAGE"}</span>
        <h1>${isPursuit ? "追撃するリザーブを選ぶ" : "追加提示するリザーブを選ぶ"}</h1>
        <p>${isPursuit ? "追撃画像の評価は半分をボーナス加算します。" : "追加画像が高評価なら、メイン画像の点数を更新できます。"}</p></div></div>
      <div class="strategy-pick-grid">
        ${items.map((item) => `<button class="select-card strategy-pick-card" type="button" data-action-card="${item.id}"><img src="${item.url}" alt="リザーブ候補" /><span>${isPursuit ? "この画像で追撃" : "この画像を追加提示"}</span></button>`).join("")}
      </div>
      ${isPursuit ? '<button class="button button-ghost strategy-center-button" id="strategySkipPursuit">今回は追撃しない</button>' : ""}
    </section>`;
    document.querySelectorAll("[data-action-card]").forEach((button) => {
      button.addEventListener("click", () => lockActionCard(owner, button.dataset.actionCard));
    });
    document.querySelector("#strategySkipPursuit")?.addEventListener("click", () => {
      state.current.actions[owner].skipped = true;
      renderNextActionSelect();
    });
    focusScreen();
  }

  function lockActionCard(owner, cardId) {
    const item = state.players[owner].reserve.find((card) => card.id === cardId && !card.used);
    if (!item) return;
    item.used = true;
    state.current.actions[owner].card = item;
    window.HariaiAudio?.playButton?.("confirm");
    renderNextActionSelect();
  }

  function renderActionReveal() {
    const selectedOwners = [0, 1].filter((owner) => state.current.actions[owner]?.card);
    if (!selectedOwners.length) {
      resolveRound();
      return;
    }
    state.screen = "action-reveal";
    setStrategyChrome(`ROUND ${state.round} / ACTION REVEAL`);
    app.innerHTML = `<section class="screen strategy-screen">
      ${renderBattleHud()}
      <div class="strategy-versus-title"><span class="eyebrow">RESERVE OPEN</span><h1>リザーブ画像公開</h1></div>
      <div class="strategy-reveal-grid ${selectedOwners.length === 1 ? "single" : ""}">
        ${selectedOwners.map((owner) => {
          const action = state.current.actions[owner];
          const quote = action.type === "pursuit" ? `<blockquote>${escapeHtml(state.players[owner].pursuitLine)}</blockquote>` : "";
          return `<div class="strategy-action-reveal">${renderBattleImage(action.card, state.players[owner].name, action.type === "pursuit" ? "PURSUIT" : "ONE MORE")}${quote}</div>`;
        }).join("")}
      </div>
      <button class="button button-primary strategy-center-button" id="strategyRateActions">追加画像を秘密採点</button>
    </section>`;
    document.querySelector("#strategyRateActions")?.addEventListener("click", () => {
      state.actionScoreQueue = selectedOwners.map((owner) => 1 - owner);
      renderNextActionRating();
    });
    focusScreen();
  }

  function renderNextActionRating() {
    const rater = state.actionScoreQueue.shift();
    if (rater === undefined) {
      resolveRound();
      return;
    }
    const owner = 1 - rater;
    renderHandoff(rater, `ROUND ${state.round} / 追加画像採点`, `${state.players[rater].name}が追加画像を秘密採点します。連鎖効果は発生しません。`, () => renderActionRating(rater, owner));
  }

  function renderActionRating(rater, owner) {
    state.screen = "action-rating";
    const action = state.current.actions[owner];
    setStrategyChrome(`ROUND ${state.round} / RESERVE SCORE`);
    app.innerHTML = `<section class="screen strategy-screen">
      ${renderBattleHud()}
      <div class="strategy-rating-layout">
        ${renderBattleImage(action.card, "相手の追加画像", action.type === "pursuit" ? "PURSUIT" : "ONE MORE")}
        <div class="score-panel strategy-score-panel">
          <span class="eyebrow">RESERVE SCORE</span><h2>追加画像を採点</h2><p>追加画像から、さらに追加要求や追撃は発生しません。</p>
          <div class="score-buttons">${renderScoreButtons()}</div>
          <button class="button button-primary score-lock" id="strategyLockActionRating" disabled>採点を封印</button>
        </div>
      </div>
    </section>`;
    bindScoreButtons();
    document.querySelector("#strategyLockActionRating")?.addEventListener("click", () => {
      const score = selectedScore();
      if (!score) return;
      state.current.actionRatings[rater] = score;
      window.HariaiAudio?.playButton?.("confirm");
      renderNextActionRating();
    });
    focusScreen();
  }

  function resolveRound() {
    [0, 1].forEach((owner) => {
      const rater = 1 - owner;
      const base = state.current.ratings[rater];
      const action = state.current.actions[owner];
      const reserveScore = action?.card ? state.current.actionRatings[rater] : null;
      let power = base;
      if (action?.type === "request" && reserveScore) power = Math.max(base, reserveScore);
      if (action?.type === "pursuit" && reserveScore) power = base + Math.ceil(reserveScore / 2);
      state.current.powers[owner] = power;
      state.players[owner].totalPower += power;
      state.players[owner].receivedScores.push(base);
      if (reserveScore) state.players[owner].receivedScores.push(reserveScore);
    });
    const [leftPower, rightPower] = state.current.powers;
    if (leftPower > rightPower) {
      state.current.damage[1] = leftPower;
      state.players[1].hp = Math.max(0, state.players[1].hp - leftPower);
    } else if (rightPower > leftPower) {
      state.current.damage[0] = rightPower;
      state.players[0].hp = Math.max(0, state.players[0].hp - rightPower);
    }
    state.history.push(state.current);
    window.HariaiAudio?.playResult?.(Math.max(leftPower, rightPower));
    renderRoundResult();
  }

  function renderRoundResult() {
    state.screen = "round-result";
    setStrategyChrome(`ROUND ${state.round} / RESULT`);
    const current = state.current;
    const winner = current.powers[0] === current.powers[1] ? -1 : current.powers[0] > current.powers[1] ? 0 : 1;
    app.innerHTML = `<section class="screen strategy-screen">
      ${renderBattleHud()}
      <div class="result-card strategy-round-result">
        <span class="eyebrow">ROUND ${state.round} RESULT</span>
        <h1>${winner < 0 ? "DRAW / ノーダメージ" : `${escapeHtml(state.players[winner].name)}の攻撃`}</h1>
        <div class="strategy-power-versus">
          ${state.players.map((player, index) => `<article class="${winner === index ? "winner" : ""}"><small>${escapeHtml(player.name)}</small><strong>${current.powers[index]}</strong><span>IMAGE POWER</span>${current.damage[1 - index] ? `<b>${current.damage[1 - index]} DAMAGE</b>` : ""}</article>`).join('<div class="strategy-vs-small">VS</div>')}
        </div>
        <div class="strategy-round-breakdown">
          ${state.players.map((player, owner) => {
            const rater = 1 - owner;
            const action = current.actions[owner];
            const actionScore = current.actionRatings[rater];
            const detail = action?.card ? `${action.type === "pursuit" ? "追撃" : "再提示"} ${actionScore}点` : "追加効果なし";
            return `<p><b>${escapeHtml(player.name)}</b><span>メイン ${current.ratings[rater]}点 / ${detail}</span></p>`;
          }).join("")}
        </div>
        <button class="button button-primary strategy-center-button" id="strategyNextRound">${isGameOver() ? "最終結果を見る" : `ROUND ${state.round + 1}へ`}</button>
      </div>
    </section>`;
    document.querySelector("#strategyNextRound")?.addEventListener("click", () => {
      if (isGameOver()) renderGameOver();
      else {
        state.round += 1;
        beginRound();
      }
    });
    focusScreen();
  }

  function isGameOver() {
    return state.round >= MAX_ROUNDS || state.players.some((player) => player.hp <= 0);
  }

  function renderGameOver() {
    state.screen = "game-over";
    setStrategyChrome("BATTLE COMPLETE");
    const [first, second] = state.players;
    let winner = -1;
    if (first.hp !== second.hp) winner = first.hp > second.hp ? 0 : 1;
    else if (first.totalPower !== second.totalPower) winner = first.totalPower > second.totalPower ? 0 : 1;
    app.innerHTML = `<section class="screen strategy-screen">
      <div class="gameover-card strategy-gameover">
        <span class="eyebrow">STRATEGY 1ON1 COMPLETE</span>
        <h1>${winner < 0 ? "DRAW" : `${escapeHtml(state.players[winner].name)} WIN`}</h1>
        <p>匿名紹介の読み、メイン5枚、リザーブの使いどころを振り返りましょう。</p>
        <div class="strategy-final-grid">
          ${state.players.map((player, index) => `<article class="${winner === index ? "winner" : ""}"><small>PLAYER ${index + 1}</small><h2>${escapeHtml(player.name)}</h2>
            <div><span>残りHP</span><strong>${player.hp}</strong></div><div><span>累計パワー</span><strong>${player.totalPower}</strong></div>
            <div><span>平均評価</span><strong>${average(player.receivedScores)}</strong></div>
          </article>`).join("")}
        </div>
        <section class="strategy-bluff-reveal"><span class="eyebrow">弱点公開</span><h2>自己紹介の答え合わせ</h2>
          ${state.players.map((player) => `<article><h3>${escapeHtml(player.name)}</h3>${player.clues.map((clue, index) => `<p class="${index === player.bluffIndex ? "is-bluff" : "is-truth"}"><b>${index === player.bluffIndex ? "弱点" : "TRUE"}</b>${escapeHtml(clue)}</p>`).join("")}</article>`).join("")}
        </section>
        <section class="strategy-history"><span class="eyebrow">BATTLE LOG</span>${state.history.map((round) => `<p><b>R${round.round}</b><span>${escapeHtml(first.name)} ${round.powers[0]} - ${round.powers[1]} ${escapeHtml(second.name)}</span></p>`).join("")}</section>
        <div class="screen-actions strategy-final-actions"><button class="button button-ghost" id="strategyRestart">同じ端末でもう一度</button><button class="button button-primary" id="strategyFinish">タイトルへ戻る</button></div>
      </div>
    </section>`;
    document.querySelector("#strategyFinish")?.addEventListener("click", destroyRoom);
    document.querySelector("#strategyRestart")?.addEventListener("click", () => {
      cleanupImages();
      state = createState();
      renderProfile(0);
    });
    focusScreen();
  }

  function average(values) {
    if (!values.length) return "0.0";
    return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
  }

  function sanitizePursuitLineDraft(value) {
    return String(value || "").replace(/[\r\n]+/g, " ").slice(0, MAX_PURSUIT_LINE_LENGTH);
  }

  function normalizePursuitLine(value) {
    const normalized = sanitizePursuitLineDraft(value).replace(/\s+/g, " ").trim();
    return normalized || PURSUIT_LINES[0];
  }

  function renderBattleHud() {
    return `<div class="round-topbar strategy-hud">
      ${renderHudPlayer(0)}
      <div class="round-badge"><small>ROUND</small><strong>${state.round} / ${MAX_ROUNDS}</strong></div>
      ${renderHudPlayer(1)}
    </div>`;
  }

  function renderHudPlayer(index) {
    const player = state.players[index];
    const hpPercent = Math.max(0, Math.min(100, (player.hp / MAX_HP) * 100));
    return `<div class="hud-player"><div class="hud-name-row"><span class="hud-name">${escapeHtml(player.name)}</span></div><div class="hp-bar"><div class="hp-fill" style="--hp:${hpPercent}%"></div></div>
      <span class="hp-value">HP ${player.hp} / ${MAX_HP} ・ ASK ${player.extraRequests} ・ PERMIT ${player.pursuitPermits}</span></div>`;
  }

  function renderBattleImage(item, name, label) {
    return `<article class="strategy-battle-image"><div><span>${escapeHtml(label)}</span><b>${escapeHtml(name)}</b></div><img src="${item.url}" alt="${escapeHtml(name)}の対戦画像" /></article>`;
  }

  window.addEventListener("beforeunload", () => {
    if (active) cleanupImages();
  });

  window.HariaiStrategy = { start, isActive, requestHome, destroyRoom };
  window.dispatchEvent(new CustomEvent("hariai-strategy-ready"));
})();
