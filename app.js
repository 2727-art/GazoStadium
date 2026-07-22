(function () {
  "use strict";

  const MAX_ROUNDS = 5;
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_IMAGE_SIDE = 1600;

  const app = document.querySelector("#app");
  const toast = document.querySelector("#toast");
  const destroyDialog = document.querySelector("#destroyDialog");
  let toastTimer = null;
  let currentScreen = "landing";

  const sampleThemes = [
    ["#142a25", "#66d18f", "#f4c96b"],
    ["#27203b", "#aa83ff", "#64e8d5"],
    ["#352119", "#ff8a5b", "#f5d48b"],
    ["#12273c", "#65c8ff", "#96efc0"],
    ["#2e1b2b", "#f27cab", "#e5e789"],
  ];

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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

  function renderLanding() {
    const lobbyStats = window.HariaiOnline?.getLobbyStats?.() || {};
    const modeStats = (mode) => lobbyStats[mode] || { waiting: null, playing: null };
    const soloStats = modeStats("solo");
    const strategyStats = modeStats("strategy");
    const teamStats = modeStats("team");
    const royaleStats = modeStats("royale");
    const statValue = (value) => Number.isInteger(value) ? value : "--";
    return `<section class="screen hero">
      <div>
        <span class="eyebrow">ONLINE 1ON1 / 2ON2 / BATTLE ROYALE</span>
        <h1>貼り合え。<span>YOUR FAVORITE, YOUR POWER.</span></h1>
        <p class="hero-copy">
          自慢の画像を5枚用意し、知らない誰かと魅力を採点し合う。
          1on1、協力型2on2、4人で最後の1人を決めるバトルロワイヤルを選べます。
        </p>
        <div class="hero-actions">
          <button class="button button-primary" id="onlineButton">通常型1on1対戦</button>
          <button class="button button-strategy" id="strategyLabButton">戦略型1on1対戦</button>
          <button class="button button-cyan" id="teamBattleButton">2on2チーム対戦</button>
          <button class="button button-royale" id="royaleBattleButton">4人バトルロワイヤル</button>
          <button class="button button-ghost" id="rankingButton">ランキングを見る</button>
          <button class="button button-ghost" id="dailyMissionButton">デイリーミッション</button>
          <button class="button button-ghost" id="pointShopButton">ポイントショップ</button>
        </div>
        <div class="mode-lobby-stats" aria-label="モード別オンライン対戦の参加状況">
          <article class="lobby-mode-card solo"><div class="lobby-mode-head"><span>通常型1ON1</span><small>STANDARD</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbySoloWaitingCount">${statValue(soloStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbySoloPlayingCount">${statValue(soloStats.playing)}</span><em>人</em></strong></div>
          </div></article>
          <article class="lobby-mode-card strategy"><div class="lobby-mode-head"><span>戦略型1ON1</span><small>STRATEGY</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbyStrategyWaitingCount">${statValue(strategyStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbyStrategyPlayingCount">${statValue(strategyStats.playing)}</span><em>人</em></strong></div>
          </div></article>
          <article class="lobby-mode-card team"><div class="lobby-mode-head"><span>2ON2</span><small>TEAM BATTLE</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbyTeamWaitingCount">${statValue(teamStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbyTeamPlayingCount">${statValue(teamStats.playing)}</span><em>人</em></strong></div>
          </div></article>
          <article class="lobby-mode-card royale"><div class="lobby-mode-head"><span>BATTLE ROYALE</span><small>4 PLAYER</small></div><div class="lobby-mode-counts">
            <div><small>待機中</small><strong><span id="lobbyRoyaleWaitingCount">${statValue(royaleStats.waiting)}</span><em>人</em></strong></div>
            <div><small>対戦中</small><strong><span id="lobbyRoyalePlayingCount">${statValue(royaleStats.playing)}</span><em>人</em></strong></div>
          </div></article>
        </div>
        <p class="lobby-privacy">トップページの閲覧者は含みません。表示名・匿名UID・ルーム情報は公開しません。</p>
        <p class="mode-note">画像は対戦中だけ相手へ直接送信され、Firebaseには保存されません。</p>
      </div>
    </section>`;
  }

  function renderLandingScreen() {
    currentScreen = "landing";
    setLandingChrome();
    app.innerHTML = renderLanding();
    document.querySelector("#strategyLabButton")?.addEventListener("click", startStrategyLab);
    document.querySelector("#onlineButton")?.addEventListener("click", startOnlineBattle);
    document.querySelector("#teamBattleButton")?.addEventListener("click", startTeamBattle);
    document.querySelector("#royaleBattleButton")?.addEventListener("click", startRoyaleBattle);
    document.querySelector("#rankingButton")?.addEventListener("click", () => renderRankingScreen({ refresh: true }));
    document.querySelector("#dailyMissionButton")?.addEventListener("click", () => openOnlineFeature("openDailyMissions"));
    document.querySelector("#pointShopButton")?.addEventListener("click", () => openOnlineFeature("openPointShop"));
    app.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderRankingScreen({ refresh = false } = {}) {
    currentScreen = "ranking";
    setLandingChrome();
    const entries = window.HariaiOnline?.getLeaderboard?.() || [];
    const status = window.HariaiOnline?.getLeaderboardStatus?.() || "idle";
    const rows = entries.length ? entries.map((entry, index) => {
      const matches = Number(entry.wins || 0) + Number(entry.losses || 0) + Number(entry.draws || 0);
      const xHandle = /^[A-Za-z0-9_]{1,15}$/.test(String(entry.xHandle || "")) ? String(entry.xHandle) : "";
      const xLink = xHandle ? `<a class="ranking-x-link" href="https://x.com/${encodeURIComponent(xHandle)}" target="_blank" rel="noopener noreferrer">X&nbsp;@${escapeHtml(xHandle)}</a>` : "";
      return `<div class="ranking-row">
        <strong class="ranking-position">${index + 1}</strong>
        <div class="ranking-player"><b>${escapeHtml(entry.name)}</b>${xLink}<small>${matches < 5 ? "仮レート" : `${matches}戦`}</small></div>
        <div class="ranking-rating"><strong>${Number(entry.rating || 1000)}</strong><small>RATE</small></div>
        <div class="ranking-record"><span>${Number(entry.wins || 0)}勝 ${Number(entry.losses || 0)}敗 ${Number(entry.draws || 0)}分</span><small>最高${Number(entry.bestStreak || 0)}連勝</small></div>
      </div>`;
    }).join("") : status === "error"
      ? `<div class="ranking-empty">ランキングを取得できませんでした。<br /><button class="button button-ghost button-small" id="rankingRetryButton">もう一度取得</button></div>`
      : status === "ready"
        ? `<div class="ranking-empty">まだランキング参加者がいません。<br />オンライン対戦準備画面から参加できます。</div>`
        : `<div class="ranking-empty">ランキングを取得しています…</div>`;
    app.innerHTML = `<section class="screen ranking-screen">
      <div class="section-head">
        <div><span class="eyebrow">CASUAL RATING / TOP 50</span><h1>プレイヤーランキング</h1>
          <p>初期レート1000。勝敗と対戦相手のレートに応じて変動します。</p></div>
        <button class="button button-ghost button-small" id="rankingBackButton">タイトルへ</button>
      </div>
      <div class="ranking-notice">プレイヤーネームと戦績、本人が任意公開したXリンクを表示します。Xリンクは自己申告・未認証です。匿名UIDとルーム履歴は公開しません。</div>
      <div class="ranking-list" aria-label="プレイヤーランキング">${rows}</div>
      <p class="ranking-casual-note">カジュアル版のため、レートと戦績はブラウザからFirebaseへ送信されます。</p>
    </section>`;
    document.querySelector("#rankingBackButton")?.addEventListener("click", renderLandingScreen);
    document.querySelector("#rankingRetryButton")?.addEventListener("click", () => window.HariaiOnline?.refreshLeaderboard?.());
    app.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (refresh) window.HariaiOnline?.refreshLeaderboard?.();
  }

  function startOnlineBattle() {
    openOnlineFeature("start");
  }

  function startStrategyLab() {
    if (window.HariaiStrategy?.start) {
      window.HariaiStrategy.start();
      return;
    }
    showToast("戦略型1on1対戦を読み込んでいます…");
    window.addEventListener("hariai-strategy-ready", () => window.HariaiStrategy?.start?.(), { once: true });
  }

  function startTeamBattle() {
    if (window.HariaiTeam?.start) {
      window.HariaiTeam.start();
      return;
    }
    showToast("2on2機能を読み込んでいます…");
    window.addEventListener("hariai-team-ready", () => window.HariaiTeam?.start?.(), { once: true });
  }

  function startRoyaleBattle() {
    if (window.HariaiRoyale?.start) {
      window.HariaiRoyale.start();
      return;
    }
    showToast("バトルロワイヤル機能を読み込んでいます…");
    window.addEventListener("hariai-royale-ready", () => window.HariaiRoyale?.start?.(), { once: true });
  }

  function openOnlineFeature(method) {
    if (window.HariaiOnline?.[method]) {
      window.HariaiOnline[method]();
      return;
    }
    showToast("オンライン機能を読み込んでいます…");
    window.addEventListener("hariai-online-ready", () => window.HariaiOnline?.[method]?.(), { once: true });
  }

  async function processImageFile(file, position, options = {}) {
    if (!file.type.startsWith("image/")) throw new Error("画像ファイルだけ選択できます。");
    if (file.size > MAX_FILE_BYTES) throw new Error("15MBを超える画像は選択できません。");
    const bitmap = await decodeImage(file);
    const maxSide = Math.min(MAX_IMAGE_SIDE, Math.max(640, Number(options.maxSide || MAX_IMAGE_SIDE)));
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
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
    const blob = await canvasToBlob(canvas, "image/webp", Math.max(0.65, Math.min(0.9, Number(options.quality || 0.86))));
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

  async function createSampleItems(playerIndex, count = MAX_ROUNDS, offset = 0) {
    const items = [];
    for (let index = 0; index < count; index += 1) {
      const position = offset + index;
      const blob = await createSampleImage(playerIndex, position);
      items.push(makeDeckItem(blob, position));
    }
    return items;
  }

  function createSampleImage(playerIndex, position) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    const palette = sampleThemes[(position + playerIndex * 2) % sampleThemes.length];
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
    context.fillText(`ONLINE SAMPLE / PLAYER ${playerIndex + 1}`, 56, 106);
    return canvasToBlob(canvas, "image/webp", 0.9);
  }

  function setLandingChrome() {
    const status = document.querySelector(".status-dot");
    const privacy = document.querySelector(".privacy-badge");
    const footerItems = document.querySelectorAll(".site-footer span");
    if (status) status.innerHTML = "<i></i> ONLINE READY";
    if (privacy) privacy.textContent = "P2P画像転送";
    if (footerItems[0]) footerItems[0].textContent = "ONLINE 1ON1 + 2ON2 + BATTLE ROYALE / FIREBASE + WEBRTC";
    if (footerItems[1]) footerItems[1].textContent = "画像本体は対戦相手へ直接送信し、サーバーへ保存しません";
    const title = destroyDialog?.querySelector("h2");
    const body = destroyDialog?.querySelector("p");
    const confirm = destroyDialog?.querySelector("#confirmDestroy");
    if (title) title.textContent = "この対戦を破棄しますか？";
    if (body) body.textContent = "勝敗と連勝数には影響しません。選択した画像とチャットはすべて破棄されます。";
    if (confirm) confirm.textContent = "ルームを破棄";
  }

  document.querySelector("#homeLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (window.HariaiStrategy?.isActive?.()) {
      window.HariaiStrategy.requestHome();
      return;
    }
    if (window.HariaiRoyale?.isActive?.()) {
      window.HariaiRoyale.requestHome();
      return;
    }
    if (window.HariaiTeam?.isActive?.()) {
      window.HariaiTeam.requestHome();
      return;
    }
    if (window.HariaiOnline?.isActive?.()) {
      window.HariaiOnline.requestHome();
      return;
    }
    renderLandingScreen();
  });

  document.querySelector("#confirmDestroy")?.addEventListener("click", () => {
    if (window.HariaiStrategy?.isActive?.()) {
      window.setTimeout(() => window.HariaiStrategy.destroyRoom(), 0);
      return;
    }
    if (window.HariaiRoyale?.isActive?.()) {
      window.setTimeout(() => window.HariaiRoyale.destroyRoom(), 0);
      return;
    }
    if (window.HariaiTeam?.isActive?.()) {
      window.setTimeout(() => window.HariaiTeam.destroyRoom(), 0);
      return;
    }
    if (window.HariaiOnline?.isActive?.()) {
      window.setTimeout(() => window.HariaiOnline.destroyRoom(), 0);
    }
  });

  window.HariaiApp = {
    returnHome: renderLandingScreen,
    shared: {
      escapeHtml,
      showToast,
      setBusy,
      processImageFile,
      createSampleItems,
    },
  };

  window.addEventListener("hariai-leaderboard-updated", () => {
    if (currentScreen === "ranking") renderRankingScreen();
  });

  renderLandingScreen();
})();
