(function () {
  "use strict";

  const MAX_HP = 30;
  const MAX_ROUNDS = 5;
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_IMAGE_SIDE = 1600;
  const STORAGE_KEY = "hariai-stadium-offline-stats-v1";

  const app = document.querySelector("#app");
  const toast = document.querySelector("#toast");
  const fxLayer = document.querySelector("#fxLayer");
  const destroyDialog = document.querySelector("#destroyDialog");
  let toastTimer = null;

  const demoThemes = [
    ["#142a25", "#66d18f", "#f4c96b"],
    ["#27203b", "#aa83ff", "#64e8d5"],
    ["#352119", "#ff8a5b", "#f5d48b"],
    ["#12273c", "#65c8ff", "#96efc0"],
    ["#2e1b2b", "#f27cab", "#e5e789"],
  ];

  let state = createInitialState();

  function createInitialState() {
    return {
      screen: "landing",
      setupIndex: 0,
      chooserIndex: 0,
      scorerIndex: 0,
      round: 1,
      roundPicks: [null, null],
      givenScores: [null, null],
      selectedScore: null,
      chatAuthor: 0,
      chatMessages: [],
      history: [],
      outcome: null,
      statsCommitted: false,
      players: [createPlayer(0), createPlayer(1)],
    };
  }

  function createPlayer(index) {
    return {
      name: `PLAYER ${index + 1}`,
      hp: MAX_HP,
      deck: [],
      totalReceived: 0,
      criticals: 0,
      perfects: 0,
      streak: 0,
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function setBusy(isBusy, message = "画像を準備しています…") {
    document.querySelector("#loadingOverlay")?.remove();
    if (!isBusy) return;
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="loading-overlay" id="loadingOverlay" role="status" aria-live="polite">
        <div class="loading-card"><div class="loader"></div><strong>${escapeHtml(message)}</strong></div>
      </div>`,
    );
  }

  function render() {
    if (!window.HariaiOnline?.isActive?.()) setOfflineChrome();
    const renderers = {
      landing: renderLanding,
      setup: renderSetup,
      handoffSetup: renderSetupHandoff,
      matchReady: renderMatchReady,
      select: renderRoundSelect,
      handoffSelect: renderSelectHandoff,
      revealReady: renderRevealReady,
      reveal: renderReveal,
      handoffScore: renderScoreHandoff,
      score: renderScore,
      result: renderRoundResult,
      gameover: renderGameOver,
    };
    app.innerHTML = (renderers[state.screen] || renderLanding)();
    bindScreenEvents();
    app.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderLanding() {
    return `<section class="screen hero">
      <div>
        <span class="eyebrow">ONLINE / OFFLINE 1ON1 IMAGE BATTLE</span>
        <h1>張り合え。<span>YOUR FAVORITE, YOUR POWER.</span></h1>
        <p class="hero-copy">
          自慢の画像を5枚用意し、知らない誰か、または隣にいる相手と魅力を採点し合う。
          HP30、最大5ラウンド。8点以上はクリティカルです。
        </p>
        <div class="hero-actions">
          <button class="button button-primary" id="onlineButton">オンライン対戦</button>
          <button class="button button-ghost" id="startButton">1台でオフライン対戦</button>
          <button class="button button-ghost" id="demoButton">オフラインデモ</button>
        </div>
        <p class="mode-note">オンライン版の画像は対戦中だけ相手へ直接送信され、Firebaseには保存されません。</p>
      </div>
      <div class="hero-card" aria-label="ゲーム画面のイメージ">
        <div class="mock-arena">
          <div class="mock-player">
            <span>PLAYER 01 / HP 30</span>
            <div class="mock-picture"></div>
            <div class="mock-score"><small>IMAGE SCORE</small><strong>8</strong></div>
          </div>
          <div class="mock-versus">VS</div>
          <div class="mock-player">
            <span>PLAYER 02 / HP 30</span>
            <div class="mock-picture"></div>
            <div class="mock-score"><small>IMAGE SCORE</small><strong>6</strong></div>
          </div>
        </div>
        <div class="rule-strip">
          <div><strong>5</strong>IMAGES</div>
          <div><strong>30</strong>MAX HP</div>
          <div><strong>8+</strong>CRITICAL</div>
        </div>
      </div>
    </section>`;
  }

  function renderSetup() {
    const player = state.players[state.setupIndex];
    const slots = Array.from({ length: MAX_ROUNDS }, (_, index) => {
      const item = player.deck[index];
      if (!item) return `<div class="deck-slot empty" aria-label="空きスロット ${index + 1}">${String(index + 1).padStart(2, "0")}</div>`;
      return `<div class="deck-slot">
        <img src="${item.url}" alt="選択画像 ${index + 1}" draggable="false" />
        <div class="deck-label"><span>ENTRY ${String(index + 1).padStart(2, "0")}</span>
          <button class="remove-card" data-remove-card="${item.id}" aria-label="画像${index + 1}を削除">×</button>
        </div>
      </div>`;
    }).join("");
    const ready = player.deck.length === MAX_ROUNDS && player.name.trim().length > 0;
    return `<section class="screen">
      <div class="section-head">
        <div><span class="eyebrow">DECK SETUP ${state.setupIndex + 1} / 2</span>
          <h1>${escapeHtml(player.name)}の準備</h1>
          <p>相手に見せたい画像を5枚選んでください。対戦中、各画像は1回だけ使用できます。</p>
        </div>
        <div class="screen-actions"><button class="button button-danger button-small" data-destroy-room>ルーム破棄</button></div>
      </div>
      <div class="setup-layout">
        <aside class="setup-guide">
          <h2>画像の取り扱い</h2>
          <ol class="guide-list">
            <li><b>1</b><span>画像は最大1600pxに縮小し、位置情報などの付随データを除去します。</span></li>
            <li><b>2</b><span>画像データはこのブラウザのメモリ内だけに保持します。</span></li>
            <li><b>3</b><span>対戦終了またはルーム破棄時に、画像への参照をすべて解放します。</span></li>
          </ol>
          <div class="privacy-note">このオフライン版はサーバー通信を一切行いません。</div>
        </aside>
        <div class="setup-panel">
          <label class="field-label">プレイヤー名
            <input class="text-input" id="playerName" maxlength="16" value="${escapeHtml(player.name)}" autocomplete="off" />
          </label>
          <div class="deck-toolbar">
            <div class="deck-counter"><strong>${player.deck.length}</strong> / 5 IMAGES</div>
            <div class="upload-actions">
              <label class="button button-cyan button-small file-button">画像を追加
                <input id="imageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple ${player.deck.length >= MAX_ROUNDS ? "disabled" : ""} />
              </label>
              <button class="button button-ghost button-small" id="fillDemoButton">デモ画像で埋める</button>
            </div>
          </div>
          <div class="deck-grid">${slots}</div>
          <div class="setup-actions">
            <button class="button button-primary" id="completeSetup" ${ready ? "" : "disabled"}>
              ${state.setupIndex === 0 ? "PLAYER 2へ渡す" : "5枚をロック"}
            </button>
          </div>
        </div>
      </div>
    </section>`;
  }

  function renderSetupHandoff() {
    return renderHandoff({
      icon: "↗",
      eyebrow: "PRIVATE SETUP",
      title: `${state.players[1].name}へ交代`,
      body: `${state.players[0].name}の画像はロックされました。画面を見られないように端末を渡してください。`,
      button: `${state.players[1].name}の準備を始める`,
      action: "start-player-two-setup",
    });
  }

  function renderMatchReady() {
    return renderHandoff({
      icon: "VS",
      eyebrow: "BATTLE READY",
      title: "5枚のデッキが完成",
      body: `${state.players[0].name}と${state.players[1].name}の画像は準備完了です。HP30、最大5ラウンドで対戦します。`,
      button: "ROUND 1を開始",
      action: "begin-match",
    });
  }

  function renderHandoff({ icon, eyebrow, title, body, button, action }) {
    return `<section class="screen handoff-wrap">
      <div class="handoff-card">
        <div class="handoff-icon" aria-hidden="true">${escapeHtml(icon)}</div>
        <span class="eyebrow">${escapeHtml(eyebrow)}</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(body)}</p>
        <button class="button button-primary" data-handoff-action="${escapeHtml(action)}">${escapeHtml(button)}</button>
        <div style="margin-top:16px"><button class="button button-danger button-small" data-destroy-room>ルーム破棄</button></div>
      </div>
    </section>`;
  }

  function renderHud() {
    const playerHud = (player, index) => `<div class="hud-player">
      <div class="hud-name-row"><span class="hud-name">${escapeHtml(player.name)}</span>
        ${player.streak > 0 ? `<span class="streak-badge">🔥 ${player.streak}連勝中</span>` : ""}
      </div>
      <div class="hp-bar" aria-label="${escapeHtml(player.name)} HP ${player.hp}/${MAX_HP}">
        <div class="hp-fill" style="--hp:${clamp((player.hp / MAX_HP) * 100, 0, 100)}%"></div>
      </div>
      <span class="hp-value">HP ${Math.max(0, player.hp)} / ${MAX_HP}</span>
    </div>`;
    return `<div class="round-topbar">
      ${playerHud(state.players[0], 0)}
      <div class="round-badge"><small>ROUND</small><strong>${state.round} / ${MAX_ROUNDS}</strong></div>
      ${playerHud(state.players[1], 1)}
    </div>`;
  }

  function renderRoundSelect() {
    const player = state.players[state.chooserIndex];
    const selectedId = state.roundPicks[state.chooserIndex];
    const cards = player.deck.map((item, index) => `<button class="select-card ${item.used ? "used" : ""} ${selectedId === item.id ? "selected" : ""}"
      data-select-card="${item.id}" ${item.used ? "disabled" : ""} aria-pressed="${selectedId === item.id}">
      <img src="${item.url}" alt="候補画像 ${index + 1}" draggable="false" />
      <span>${item.used ? "USED" : `ENTRY ${String(index + 1).padStart(2, "0")}`}</span>
    </button>`).join("");
    return `<section class="screen">
      ${renderHud()}
      <div class="section-head">
        <div><span class="eyebrow">SECRET PICK</span><h1>${escapeHtml(player.name)}の画像選択</h1>
          <p>このラウンドに出す画像を1枚選び、ロックしてください。</p></div>
        <div class="screen-actions"><button class="button button-danger button-small" data-destroy-room>ルーム破棄</button></div>
      </div>
      <div class="select-panel">
        <div class="select-grid">${cards}</div>
        <div class="selection-footer">
          <p>選択内容は相手の選択完了まで公開されません。</p>
          <button class="button button-primary" id="lockSelection" ${selectedId ? "" : "disabled"}>この画像でロック</button>
        </div>
      </div>
    </section>`;
  }

  function renderSelectHandoff() {
    return renderHandoff({
      icon: "↗",
      eyebrow: `ROUND ${state.round} / SECRET PICK`,
      title: `${state.players[1].name}へ交代`,
      body: `${state.players[0].name}の画像はロックされました。次のプレイヤーへ端末を渡してください。`,
      button: `${state.players[1].name}が画像を選ぶ`,
      action: "start-player-two-pick",
    });
  }

  function renderRevealReady() {
    return renderHandoff({
      icon: "✦",
      eyebrow: `ROUND ${state.round} / REVEAL`,
      title: "両者ロック完了",
      body: "ここからは2人で画面を見てください。画像を同時公開します。",
      button: "画像を公開する",
      action: "reveal-images",
    });
  }

  function getPickedItem(playerIndex) {
    return state.players[playerIndex].deck.find((item) => item.id === state.roundPicks[playerIndex]);
  }

  function renderReveal() {
    const first = getPickedItem(0);
    const second = getPickedItem(1);
    return `<section class="screen">
      ${renderHud()}
      <div class="section-head">
        <div><span class="eyebrow">IMAGE REVEAL</span><h1>画像、オープン。</h1>
          <p>相手の一枚を見て、気になったことを話してみましょう。</p></div>
        <div class="screen-actions"><button class="button button-danger button-small" data-destroy-room>ルーム破棄</button></div>
      </div>
      <div class="battle-layout">
        <div class="arena-panel">
          <div class="arena-grid">
            ${renderArenaCard(0, first)}<div class="arena-vs">VS</div>${renderArenaCard(1, second)}
          </div>
          <div class="arena-actions"><button class="button button-primary" id="beginScoring">採点へ進む</button></div>
        </div>
        ${renderChatPanel()}
      </div>
    </section>`;
  }

  function renderArenaCard(playerIndex, item) {
    return `<article class="arena-card ${playerIndex === 0 ? "player-one" : "player-two"}">
      <div class="arena-image"><img src="${item.url}" alt="${escapeHtml(state.players[playerIndex].name)}が出した画像" draggable="false" /></div>
      <div class="arena-meta"><strong>${escapeHtml(state.players[playerIndex].name)}</strong><span>ENTRY ${String(item.position + 1).padStart(2, "0")}</span></div>
    </article>`;
  }

  function renderChatPanel() {
    return `<aside class="chat-panel">
      <div class="chat-head"><strong>LOCAL CHAT</strong><span>対戦終了時に破棄</span></div>
      <div class="chat-authors">
        ${state.players.map((player, index) => `<button class="author-button ${state.chatAuthor === index ? "active" : ""}" data-chat-author="${index}">${escapeHtml(player.name)}</button>`).join("")}
      </div>
      <div class="chat-messages" id="chatMessages">${renderChatMessages()}</div>
      <div class="quick-reactions">
        ${["すごい！", "かわいい", "センスいい", "もっと見たい"].map((reaction) => `<button class="reaction-button" data-reaction="${reaction}">${reaction}</button>`).join("")}
      </div>
      <form class="chat-form" id="chatForm">
        <input class="chat-input" id="chatInput" maxlength="80" placeholder="ひとこと送る…" autocomplete="off" aria-label="チャットメッセージ" />
        <button class="button button-cyan button-small" type="submit">送信</button>
      </form>
    </aside>`;
  }

  function renderChatMessages() {
    if (state.chatMessages.length === 0) {
      return `<div class="chat-empty">画像について話してみましょう。<br />メッセージはこの端末内だけに表示されます。</div>`;
    }
    return state.chatMessages.map((message) => `<div class="chat-message ${message.author === 1 ? "player-two" : "player-one"}">
      <small>${escapeHtml(state.players[message.author].name)} / R${message.round}</small>
      <p>${escapeHtml(message.text)}</p>
    </div>`).join("");
  }

  function renderScoreHandoff() {
    const scorer = state.players[state.scorerIndex];
    const target = state.players[state.scorerIndex === 0 ? 1 : 0];
    return renderHandoff({
      icon: "10",
      eyebrow: `ROUND ${state.round} / PRIVATE SCORE`,
      title: `${scorer.name}が採点`,
      body: `${target.name}の画像を1～10点で採点します。もう一人は画面を見ないでください。`,
      button: `${scorer.name}が採点を始める`,
      action: "open-score",
    });
  }

  function renderScore() {
    const targetIndex = state.scorerIndex === 0 ? 1 : 0;
    const scorer = state.players[state.scorerIndex];
    const target = state.players[targetIndex];
    const item = getPickedItem(targetIndex);
    const buttons = Array.from({ length: 10 }, (_, index) => index + 1).map((score) => `<button
      class="score-button ${score >= 8 ? "critical-zone" : ""} ${state.selectedScore === score ? "selected" : ""}"
      data-score="${score}" aria-pressed="${state.selectedScore === score}">${score}</button>`).join("");
    return `<section class="screen">
      ${renderHud()}
      <div class="score-layout">
        <div class="score-image"><img src="${item.url}" alt="${escapeHtml(target.name)}の採点対象画像" draggable="false" /></div>
        <div class="score-panel">
          <span class="eyebrow">${escapeHtml(scorer.name)}'S SCORE</span>
          <h2>${escapeHtml(target.name)}の画像を採点</h2>
          <p>直感で1～10点を選んでください。8点以上でクリティカル演出が発生します。</p>
          <div class="score-buttons">${buttons}</div>
          <button class="button button-primary button-wide score-lock" id="lockScore" ${state.selectedScore ? "" : "disabled"}>この点数で確定</button>
        </div>
      </div>
    </section>`;
  }

  function renderRoundResult() {
    const result = state.history[state.history.length - 1];
    const labelFor = (score) => score === 10 ? "PERFECT!!" : score >= 8 ? "CRITICAL!" : score >= 6 ? "GREAT" : score >= 4 ? "GOOD" : "HIT";
    const damageText = result.winnerIndex === null
      ? "同点。両者ノーダメージです。"
      : `${state.players[result.loserIndex].name}に ${result.damage} DAMAGE。残りHP ${Math.max(0, state.players[result.loserIndex].hp)}。`;
    return `<section class="screen result-wrap">
      <div class="result-card">
        <span class="eyebrow">ROUND ${state.round} RESULT</span>
        <h1>${result.winnerIndex === null ? "DRAW ROUND" : `${escapeHtml(state.players[result.winnerIndex].name)} TAKES IT`}</h1>
        <div class="result-scores">
          ${resultPlayerHtml(0, result.scorePlayerOne, result.winnerIndex, labelFor(result.scorePlayerOne))}
          <div class="result-vs">VS</div>
          ${resultPlayerHtml(1, result.scorePlayerTwo, result.winnerIndex, labelFor(result.scorePlayerTwo))}
        </div>
        <div class="damage-callout">${escapeHtml(damageText)}</div>
        <div class="result-chat">${renderChatPanel()}</div>
        <div class="button-row" style="justify-content:center">
          <button class="button button-danger" data-destroy-room>ルーム破棄</button>
          <button class="button button-primary" id="continueRound">${isMatchOver() ? "試合結果を見る" : `ROUND ${state.round + 1}へ`}</button>
        </div>
      </div>
    </section>`;
  }

  function resultPlayerHtml(index, score, winnerIndex, label) {
    return `<div class="result-player ${winnerIndex === index ? "winner" : ""}">
      <strong>${escapeHtml(state.players[index].name)}</strong>
      <span>${score}</span>
      <small>${escapeHtml(label)}</small>
    </div>`;
  }

  function renderGameOver() {
    const outcome = state.outcome;
    const title = outcome.winnerIndex === null ? "引き分け" : `${escapeHtml(state.players[outcome.winnerIndex].name)} WIN`;
    const subtitle = outcome.reason === "hp" ? "HPが0になり、決着しました。" : outcome.reason === "draw" ? "すべての判定項目が同点でした。" : "5ラウンド終了。残りHPと獲得点で判定しました。";
    return `<section class="screen gameover-wrap">
      <div class="gameover-card">
        <div class="winner-emblem" aria-hidden="true">${outcome.winnerIndex === null ? "=" : "✦"}</div>
        <span class="eyebrow">MATCH COMPLETE</span>
        <h1>${title}</h1>
        <p>${escapeHtml(subtitle)}</p>
        <div class="final-stats">
          ${state.players.map((player, index) => `<div class="final-player ${outcome.winnerIndex === index ? "winner" : ""}">
            <h2>${escapeHtml(player.name)} ${player.streak > 0 ? `<span class="streak-badge">🔥 ${player.streak}連勝中</span>` : ""}</h2>
            <div class="stats-row">
              <div class="stat-box"><strong>${Math.max(0, player.hp)}</strong><span>残りHP</span></div>
              <div class="stat-box"><strong>${player.totalReceived}</strong><span>合計獲得点</span></div>
              <div class="stat-box"><strong>${player.criticals}</strong><span>CRITICAL</span></div>
            </div>
          </div>`).join("")}
        </div>
        <div class="gameover-actions">
          <button class="button button-primary" id="newMatch">新しい対戦を始める</button>
          <button class="button button-ghost" id="backHome">タイトルへ戻る</button>
        </div>
      </div>
    </section>`;
  }

  function bindScreenEvents() {
    document.querySelectorAll("img").forEach((image) => {
      image.addEventListener("contextmenu", (event) => event.preventDefault());
      image.addEventListener("dragstart", (event) => event.preventDefault());
    });
    document.querySelectorAll("[data-destroy-room]").forEach((button) => {
      button.addEventListener("click", () => destroyDialog.showModal());
    });

    if (state.screen === "landing") bindLandingEvents();
    if (state.screen === "setup") bindSetupEvents();
    if (["handoffSetup", "matchReady", "handoffSelect", "revealReady", "handoffScore"].includes(state.screen)) bindHandoffEvents();
    if (state.screen === "select") bindSelectEvents();
    if (state.screen === "reveal") bindRevealEvents();
    if (state.screen === "score") bindScoreEvents();
    if (state.screen === "result") bindResultEvents();
    if (state.screen === "gameover") bindGameOverEvents();
  }

  function bindLandingEvents() {
    document.querySelector("#onlineButton")?.addEventListener("click", () => {
      if (window.HariaiOnline?.start) {
        window.HariaiOnline.start();
        return;
      }
      showToast("オンライン機能を読み込んでいます…");
      window.addEventListener("hariai-online-ready", () => window.HariaiOnline?.start?.(), { once: true });
    });
    document.querySelector("#startButton")?.addEventListener("click", () => {
      state.screen = "setup";
      state.setupIndex = 0;
      render();
    });
    document.querySelector("#demoButton")?.addEventListener("click", startDemoMatch);
  }

  function bindSetupEvents() {
    const player = state.players[state.setupIndex];
    const nameInput = document.querySelector("#playerName");
    nameInput?.addEventListener("input", () => {
      player.name = nameInput.value.slice(0, 16);
      const completeButton = document.querySelector("#completeSetup");
      completeButton.disabled = player.deck.length !== MAX_ROUNDS || !player.name.trim();
    });
    document.querySelector("#imageInput")?.addEventListener("change", handleImageInput);
    document.querySelector("#fillDemoButton")?.addEventListener("click", fillCurrentDeckWithDemo);
    document.querySelectorAll("[data-remove-card]").forEach((button) => {
      button.addEventListener("click", () => removeDeckCard(player, button.dataset.removeCard));
    });
    document.querySelector("#completeSetup")?.addEventListener("click", completePlayerSetup);
  }

  function bindHandoffEvents() {
    document.querySelector("[data-handoff-action]")?.addEventListener("click", (event) => {
      const action = event.currentTarget.dataset.handoffAction;
      if (action === "start-player-two-setup") {
        state.setupIndex = 1;
        state.screen = "setup";
      } else if (action === "begin-match") {
        prepareMatch();
      } else if (action === "start-player-two-pick") {
        state.chooserIndex = 1;
        state.screen = "select";
      } else if (action === "reveal-images") {
        state.screen = "reveal";
      } else if (action === "open-score") {
        state.selectedScore = null;
        state.screen = "score";
      }
      render();
    });
  }

  function bindSelectEvents() {
    document.querySelectorAll("[data-select-card]").forEach((button) => {
      button.addEventListener("click", () => {
        state.roundPicks[state.chooserIndex] = button.dataset.selectCard;
        render();
      });
    });
    document.querySelector("#lockSelection")?.addEventListener("click", () => {
      if (!state.roundPicks[state.chooserIndex]) return;
      if (state.chooserIndex === 0) {
        state.screen = "handoffSelect";
      } else {
        state.screen = "revealReady";
      }
      render();
    });
  }

  function bindRevealEvents() {
    bindChatEvents();
    document.querySelector("#beginScoring")?.addEventListener("click", () => {
      state.scorerIndex = 0;
      state.screen = "handoffScore";
      render();
    });
  }

  function bindScoreEvents() {
    document.querySelectorAll("[data-score]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedScore = Number(button.dataset.score);
        render();
      });
    });
    document.querySelector("#lockScore")?.addEventListener("click", lockScore);
  }

  function bindResultEvents() {
    bindChatEvents();
    document.querySelector("#continueRound")?.addEventListener("click", () => {
      if (isMatchOver()) {
        finishMatch();
      } else {
        state.round += 1;
        state.roundPicks = [null, null];
        state.givenScores = [null, null];
        state.selectedScore = null;
        state.chooserIndex = 0;
        state.screen = "select";
        render();
      }
    });
  }

  function bindGameOverEvents() {
    document.querySelector("#newMatch")?.addEventListener("click", resetToSetup);
    document.querySelector("#backHome")?.addEventListener("click", resetToLanding);
  }

  function bindChatEvents() {
    document.querySelectorAll("[data-chat-author]").forEach((button) => {
      button.addEventListener("click", () => {
        state.chatAuthor = Number(button.dataset.chatAuthor);
        document.querySelectorAll("[data-chat-author]").forEach((candidate) => {
          candidate.classList.toggle("active", candidate === button);
        });
      });
    });
    document.querySelectorAll("[data-reaction]").forEach((button) => {
      button.addEventListener("click", () => addChatMessage(button.dataset.reaction));
    });
    document.querySelector("#chatForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.querySelector("#chatInput");
      addChatMessage(input.value);
      input.value = "";
      input.focus();
    });
    scrollChatToBottom();
  }

  function addChatMessage(value) {
    const text = String(value || "").trim().slice(0, 80);
    if (!text) return;
    state.chatMessages.push({ author: state.chatAuthor, text, round: state.round });
    const list = document.querySelector("#chatMessages");
    if (list) {
      list.innerHTML = renderChatMessages();
      scrollChatToBottom();
    }
  }

  function scrollChatToBottom() {
    const list = document.querySelector("#chatMessages");
    if (list) list.scrollTop = list.scrollHeight;
  }

  async function handleImageInput(event) {
    const player = state.players[state.setupIndex];
    const files = Array.from(event.target.files || []);
    const remaining = MAX_ROUNDS - player.deck.length;
    if (remaining <= 0 || files.length === 0) return;
    setBusy(true, "画像を安全な形式に変換しています…");
    const accepted = files.slice(0, remaining);
    let added = 0;
    const errors = [];
    for (const file of accepted) {
      try {
        const item = await processImageFile(file, player.deck.length);
        player.deck.push(item);
        added += 1;
      } catch (error) {
        errors.push(error.message);
      }
    }
    setBusy(false);
    render();
    if (files.length > remaining) showToast(`残り${remaining}枚まで追加しました。`);
    else if (errors.length) showToast(`${added}枚追加。${errors[0]}`);
    else showToast(`${added}枚の画像を追加しました。`);
  }

  async function processImageFile(file, position) {
    if (!file.type.startsWith("image/")) throw new Error("画像ファイルだけ選択できます。");
    if (file.size > MAX_FILE_BYTES) throw new Error("15MBを超える画像は選択できません。");
    const bitmap = await decodeImage(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#090b12";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap.source, 0, 0, width, height);
    bitmap.close?.();
    const blob = await canvasToBlob(canvas, "image/webp", 0.86);
    return makeDeckItem(blob, position);
  }

  function decodeImage(file) {
    if ("createImageBitmap" in window) {
      return createImageBitmap(file).then((source) => ({
        source,
        width: source.width,
        height: source.height,
        close: () => source.close(),
      })).catch(() => decodeImageWithElement(file));
    }
    return decodeImageWithElement(file);
  }

  function decodeImageWithElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        resolve({
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          close: () => URL.revokeObjectURL(url),
        });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("画像を読み込めませんでした。"));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("画像の変換に失敗しました。"));
      }, type, quality);
    });
  }

  function makeDeckItem(blob, position) {
    return {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      blob,
      url: URL.createObjectURL(blob),
      position,
      used: false,
    };
  }

  function removeDeckCard(player, id) {
    const item = player.deck.find((candidate) => candidate.id === id);
    if (item) URL.revokeObjectURL(item.url);
    player.deck = player.deck.filter((candidate) => candidate.id !== id);
    player.deck.forEach((candidate, index) => { candidate.position = index; });
    render();
  }

  async function fillCurrentDeckWithDemo() {
    const player = state.players[state.setupIndex];
    const remaining = MAX_ROUNDS - player.deck.length;
    if (remaining <= 0) {
      showToast("5枚すべて選択済みです。");
      return;
    }
    setBusy(true, "デモ画像を生成しています…");
    const items = await createDemoItems(state.setupIndex, remaining, player.deck.length);
    player.deck.push(...items);
    setBusy(false);
    render();
    showToast(`${remaining}枚のデモ画像を追加しました。`);
  }

  async function createDemoItems(playerIndex, count = MAX_ROUNDS, offset = 0) {
    const items = [];
    for (let index = 0; index < count; index += 1) {
      const position = offset + index;
      const blob = await createDemoImage(playerIndex, position);
      items.push(makeDeckItem(blob, position));
    }
    return items;
  }

  function createDemoImage(playerIndex, position) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    const palette = demoThemes[(position + playerIndex * 2) % demoThemes.length];
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, palette[0]);
    gradient.addColorStop(1, "#080a10");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = "rgba(255,255,255,.055)";
    context.lineWidth = 2;
    for (let x = 0; x <= canvas.width; x += 80) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 80) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
    }

    const centerX = 600 + (playerIndex === 0 ? -35 : 35);
    context.strokeStyle = palette[1];
    context.lineWidth = 18;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(centerX, 690);
    context.bezierCurveTo(centerX - 25, 530, centerX + 38, 375, centerX, 190);
    context.stroke();

    for (let leaf = 0; leaf < 7; leaf += 1) {
      const y = 540 - leaf * 58;
      const side = leaf % 2 === 0 ? -1 : 1;
      context.save();
      context.translate(centerX + side * (54 + leaf * 5), y);
      context.rotate(side * (0.42 + position * 0.025));
      const leafGradient = context.createLinearGradient(-100, 0, 100, 0);
      leafGradient.addColorStop(0, palette[1]);
      leafGradient.addColorStop(1, palette[2]);
      context.fillStyle = leafGradient;
      context.beginPath();
      context.ellipse(0, 0, 115 - leaf * 4, 48 + leaf * 2, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(255,255,255,.3)";
      context.lineWidth = 4;
      context.beginPath(); context.moveTo(-80, 0); context.lineTo(78, 0); context.stroke();
      context.restore();
    }

    context.fillStyle = "#d8c2a4";
    context.beginPath();
    context.roundRect(centerX - 150, 645, 300, 78, 22);
    context.fill();
    context.fillStyle = "#9c7558";
    context.beginPath();
    context.moveTo(centerX - 125, 710); context.lineTo(centerX + 125, 710);
    context.lineTo(centerX + 90, 850); context.lineTo(centerX - 90, 850); context.closePath();
    context.fill();

    context.fillStyle = "rgba(255,255,255,.82)";
    context.font = "800 30px system-ui, sans-serif";
    context.letterSpacing = "4px";
    context.fillText(`BOTANICAL ENTRY ${String(position + 1).padStart(2, "0")}`, 54, 70);
    context.fillStyle = "rgba(255,255,255,.46)";
    context.font = "700 20px system-ui, sans-serif";
    context.fillText(`LOCAL DEMO / PLAYER ${playerIndex + 1}`, 56, 106);
    return canvasToBlob(canvas, "image/webp", 0.9);
  }

  async function startDemoMatch() {
    setBusy(true, "デモデッキを生成しています…");
    releaseAllImages();
    state = createInitialState();
    state.players[0].name = "LEAF RED";
    state.players[1].name = "LEAF CYAN";
    state.players[0].deck = await createDemoItems(0);
    state.players[1].deck = await createDemoItems(1);
    loadPlayerStreaks();
    state.screen = "matchReady";
    setBusy(false);
    render();
  }

  function completePlayerSetup() {
    const player = state.players[state.setupIndex];
    player.name = player.name.trim().slice(0, 16);
    if (!player.name || player.deck.length !== MAX_ROUNDS) return;
    if (state.setupIndex === 0) {
      state.players[1].name = state.players[1].name || "PLAYER 2";
      state.screen = "handoffSetup";
    } else {
      loadPlayerStreaks();
      state.screen = "matchReady";
    }
    render();
  }

  function prepareMatch() {
    state.players.forEach((player) => {
      player.hp = MAX_HP;
      player.totalReceived = 0;
      player.criticals = 0;
      player.perfects = 0;
      player.deck.forEach((item) => { item.used = false; });
    });
    state.round = 1;
    state.roundPicks = [null, null];
    state.givenScores = [null, null];
    state.history = [];
    state.chatMessages = [];
    state.outcome = null;
    state.statsCommitted = false;
    state.chooserIndex = 0;
    state.screen = "select";
  }

  function lockScore() {
    if (!state.selectedScore) return;
    state.givenScores[state.scorerIndex] = state.selectedScore;
    state.selectedScore = null;
    if (state.scorerIndex === 0) {
      state.scorerIndex = 1;
      state.screen = "handoffScore";
      render();
      return;
    }
    resolveRound();
  }

  function resolveRound() {
    const scorePlayerOne = state.givenScores[1];
    const scorePlayerTwo = state.givenScores[0];
    state.players[0].totalReceived += scorePlayerOne;
    state.players[1].totalReceived += scorePlayerTwo;
    [scorePlayerOne, scorePlayerTwo].forEach((score, index) => {
      if (score >= 8) state.players[index].criticals += 1;
      if (score === 10) state.players[index].perfects += 1;
    });
    getPickedItem(0).used = true;
    getPickedItem(1).used = true;
    let winnerIndex = null;
    let loserIndex = null;
    let damage = 0;
    if (scorePlayerOne > scorePlayerTwo) {
      winnerIndex = 0;
      loserIndex = 1;
      damage = scorePlayerOne;
    } else if (scorePlayerTwo > scorePlayerOne) {
      winnerIndex = 1;
      loserIndex = 0;
      damage = scorePlayerTwo;
    }
    if (loserIndex !== null) state.players[loserIndex].hp = Math.max(0, state.players[loserIndex].hp - damage);
    state.history.push({
      round: state.round,
      scorePlayerOne,
      scorePlayerTwo,
      winnerIndex,
      loserIndex,
      damage,
    });
    state.screen = "result";
    render();
    const topScore = Math.max(scorePlayerOne, scorePlayerTwo);
    if (topScore >= 8) triggerCriticalFx(topScore === 10 ? "PERFECT!!" : "CRITICAL!");
  }

  function isMatchOver() {
    return state.players.some((player) => player.hp <= 0) || state.round >= MAX_ROUNDS;
  }

  function determineOutcome() {
    const [first, second] = state.players;
    if (first.hp !== second.hp) {
      return { winnerIndex: first.hp > second.hp ? 0 : 1, reason: first.hp <= 0 || second.hp <= 0 ? "hp" : "rounds" };
    }
    if (first.totalReceived !== second.totalReceived) {
      return { winnerIndex: first.totalReceived > second.totalReceived ? 0 : 1, reason: "rounds" };
    }
    if (first.criticals !== second.criticals) {
      return { winnerIndex: first.criticals > second.criticals ? 0 : 1, reason: "rounds" };
    }
    if (first.perfects !== second.perfects) {
      return { winnerIndex: first.perfects > second.perfects ? 0 : 1, reason: "rounds" };
    }
    return { winnerIndex: null, reason: "draw" };
  }

  function finishMatch() {
    state.outcome = determineOutcome();
    commitStats();
    releaseAllImages();
    state.chatMessages = [];
    state.screen = "gameover";
    render();
  }

  function triggerCriticalFx(text) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    fxLayer.innerHTML = `<div class="critical-flash"></div><div class="critical-text">${escapeHtml(text)}</div>`;
    window.setTimeout(() => { fxLayer.innerHTML = ""; }, 1250);
  }

  function getStoredStats() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function statsKey(name) {
    return name.trim().toLocaleLowerCase("ja-JP");
  }

  function loadPlayerStreaks() {
    const stats = getStoredStats();
    state.players.forEach((player) => {
      player.streak = stats[statsKey(player.name)]?.streak || 0;
    });
  }

  function commitStats() {
    if (state.statsCommitted) return;
    state.statsCommitted = true;
    const stats = getStoredStats();
    state.players.forEach((player, index) => {
      const key = statsKey(player.name);
      const record = stats[key] || { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0 };
      if (state.outcome.winnerIndex === null) {
        record.draws += 1;
      } else if (state.outcome.winnerIndex === index) {
        record.wins += 1;
        record.streak += 1;
        record.bestStreak = Math.max(record.bestStreak, record.streak);
      } else {
        record.losses += 1;
        record.streak = 0;
      }
      stats[key] = record;
      player.streak = record.streak;
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch {
      showToast("このブラウザでは戦績を保存できませんでした。");
    }
  }

  function releaseAllImages() {
    state.players.forEach((player) => {
      player.deck.forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
        item.url = "";
        item.blob = null;
      });
    });
  }

  function resetToSetup() {
    releaseAllImages();
    state = createInitialState();
    state.screen = "setup";
    render();
  }

  function resetToLanding() {
    releaseAllImages();
    state = createInitialState();
    render();
  }

  function setOfflineChrome() {
    const status = document.querySelector(".status-dot");
    const privacy = document.querySelector(".privacy-badge");
    const footerItems = document.querySelectorAll(".site-footer span");
    if (status) status.innerHTML = "<i></i> READY";
    if (privacy) privacy.textContent = "画像保存なし";
    if (footerItems[0]) footerItems[0].textContent = "ONLINE / OFFLINE 1ON1";
    if (footerItems[1]) footerItems[1].textContent = "画像本体はサーバーへ保存しません";
  }

  document.querySelector("#homeLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (window.HariaiOnline?.isActive?.()) {
      window.HariaiOnline.requestHome();
      return;
    }
    if (state.screen === "landing" || state.screen === "gameover") {
      resetToLanding();
    } else {
      destroyDialog.showModal();
    }
  });

  document.querySelector("#confirmDestroy")?.addEventListener("click", () => {
    if (window.HariaiOnline?.isActive?.()) {
      window.setTimeout(() => window.HariaiOnline.destroyRoom(), 0);
      return;
    }
    window.setTimeout(() => {
      resetToLanding();
      showToast("ルームを破棄しました。戦績には影響しません。");
    }, 0);
  });

  window.addEventListener("beforeunload", releaseAllImages);

  window.HariaiOfflineApp = {
    returnHome: resetToLanding,
    shared: {
      escapeHtml,
      showToast,
      setBusy,
      processImageFile,
      createDemoItems,
    },
  };

  render();
})();
