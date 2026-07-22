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
  let expandedRankingEntryId = "";
  let rankingComments = [];
  let rankingCommentsStatus = "idle";
  let rankingCommentsError = "";
  let rankingCommentIdentity = null;
  let rankingCommentIdentityStatus = "idle";
  let rankingPeriod = "weekly";
  let rankingDisplayedPeriodKey = "";

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
        <span class="eyebrow hero-eyebrow"><i aria-hidden="true">♥</i><span>好きな画像で、気軽にオンライン対戦</span><i aria-hidden="true">✦</i></span>
        <h1 aria-label="貼り合え。YOUR FAVORITE, YOUR POWER."><span class="hero-title-text">貼り合え</span><span class="hero-heart" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><defs><linearGradient id="heroHeartGradient" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse"><stop stop-color="#ff6b85"/><stop offset="0.58" stop-color="#ff4f72"/><stop offset="1" stop-color="#66e9df"/></linearGradient></defs><path d="M32 58C28.8 54.8 8.1 42.8 5.1 26.1 2.6 12.1 10.1 4 20.1 4 25.9 4 30 7 32 11c2-4 6.1-7 11.9-7 10 0 17.5 8.1 15 22.1C55.9 42.8 35.2 54.8 32 58Z" fill="url(#heroHeartGradient)"/><path d="M13.5 19.5C15.2 12.4 22.5 9.4 27.4 14" fill="none" stroke="rgba(255,255,255,.72)" stroke-linecap="round" stroke-width="3"/></svg></span><span class="hero-tagline">YOUR FAVORITE, YOUR POWER.</span></h1>
        <p class="hero-welcome"><span aria-hidden="true">♡</span><strong>はじめてでも大丈夫。</strong>あなたの「好き」が、いちばんのカードです。</p>
        <p class="hero-copy">
          お気に入りの画像を5枚選んで、知らない誰かと楽しく採点。
          1on1、協力型2on2、4人で最後の1人を決めるバトルロワイヤルを選べます。
        </p>
        <ul class="hero-assurances" aria-label="安心して遊べるポイント">
          <li>匿名で参加</li><li>画像はサーバー保存なし</li><li>ひとりでも友達とでも</li>
        </ul>
        <div class="hero-actions">
          <button class="button button-primary hero-mode-button" id="onlineButton"><small>気軽にスタート</small><span>通常型1on1対戦</span></button>
          <button class="button button-strategy hero-mode-button" id="strategyLabButton"><small>弱点を見抜こう</small><span>戦略型1on1対戦</span></button>
          <button class="button button-cyan hero-mode-button" id="teamBattleButton"><small>ふたりで協力</small><span>2on2チーム対戦</span></button>
          <button class="button button-royale hero-mode-button" id="royaleBattleButton"><small>最後のひとりへ</small><span>4人バトルロワイヤル</span></button>
          <button class="button button-ghost hero-utility-button" id="rankingButton">オンライン総合ランキング</button>
          <button class="button button-ghost hero-utility-button" id="dailyMissionButton">デイリーミッション</button>
          <button class="button button-ghost hero-utility-button" id="pointShopButton">ポイントショップ</button>
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
    expandedRankingEntryId = "";
    rankingComments = [];
    rankingCommentsStatus = "idle";
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

  function rankingCommentDate(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "日時不明";
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(Number(timestamp)));
  }

  function renderRankingCommentPanel(entry) {
    const entryId = String(entry.entryId || "");
    if (entry.commentsEnabled === false) {
      return `<div class="ranking-comments-panel is-disabled"><p>このプレイヤーはコメント受付を停止しています。</p></div>`;
    }
    if (rankingCommentsStatus === "loading") {
      return `<div class="ranking-comments-panel"><p>コメントを読み込んでいます…</p></div>`;
    }
    if (rankingCommentsStatus === "error") {
      return `<div class="ranking-comments-panel"><p>${escapeHtml(rankingCommentsError || "コメントを取得できませんでした。")}</p><button class="button button-ghost button-small" data-ranking-comments-retry="${escapeHtml(entryId)}">再読み込み</button></div>`;
    }

    const identityEntryId = String(rankingCommentIdentity?.entryId || "");
    const commentItems = rankingComments.length ? rankingComments.map((comment) => {
      const canDelete = rankingCommentIdentity?.canPost
        && (identityEntryId === comment.authorEntryId || identityEntryId === entryId);
      return `<li class="ranking-comment-item">
        <div class="ranking-comment-meta"><strong>${escapeHtml(comment.authorName)}</strong><time>${escapeHtml(rankingCommentDate(comment.updatedAt))}</time></div>
        <p>${escapeHtml(comment.text)}</p>
        ${canDelete ? `<button class="ranking-comment-delete" type="button" data-ranking-comment-delete="${escapeHtml(comment.authorEntryId)}" data-ranking-comment-target="${escapeHtml(entryId)}">削除</button>` : ""}
      </li>`;
    }).join("") : `<li class="ranking-comment-empty">まだコメントはありません。</li>`;

    let composer = "";
    if (rankingCommentIdentityStatus === "loading") {
      composer = `<p class="ranking-comment-guide">投稿資格を確認しています…</p>`;
    } else if (rankingCommentIdentityStatus !== "ready") {
      composer = `<div class="ranking-comment-auth"><p>ランキング参加者は、このプレイヤーへ1件コメントできます。</p><button class="button button-ghost button-small" type="button" data-ranking-comment-auth="${escapeHtml(entryId)}">投稿資格を確認</button></div>`;
    } else if (!rankingCommentIdentity?.canPost) {
      composer = `<p class="ranking-comment-guide">コメントするには、いずれかのオンライン対戦準備画面またはランキング画面で「オンライン総合ランキングに参加する」を有効にしてください。</p>`;
    } else if (identityEntryId === entryId) {
      composer = `<p class="ranking-comment-guide">自分の欄には投稿できません。寄せられたコメントは削除できます。</p>`;
    } else {
      const ownComment = rankingComments.find((comment) => comment.authorEntryId === identityEntryId);
      composer = `<form class="ranking-comment-form" data-ranking-comment-form="${escapeHtml(entryId)}">
        <label for="rankingCommentText">${ownComment ? "自分のコメントを更新" : "このプレイヤーへコメント"}</label>
        <textarea id="rankingCommentText" maxlength="80" rows="2" required placeholder="URLを含まない1行80文字以内">${escapeHtml(ownComment?.text || "")}</textarea>
        <div><small>1人につき1件。改行とURLは使えません。</small><button class="button button-primary button-small" type="submit">${ownComment ? "更新する" : "投稿する"}</button></div>
      </form>`;
    }

    return `<div class="ranking-comments-panel" id="rankingComments-${escapeHtml(entryId)}">
      <div class="ranking-comments-head"><strong>プレイヤーコメント</strong><small>新しい順・最大20件</small></div>
      <ul class="ranking-comment-list">${commentItems}</ul>
      ${composer}
    </div>`;
  }

  async function loadRankingComments(entryId) {
    const targetId = String(entryId || "");
    rankingCommentsStatus = "loading";
    rankingCommentsError = "";
    rankingComments = [];
    renderRankingScreen({ preserveScroll: true });
    try {
      const comments = await window.HariaiOnline?.getLeaderboardComments?.(targetId);
      if (expandedRankingEntryId !== targetId) return;
      rankingComments = Array.isArray(comments) ? comments : [];
      rankingCommentsStatus = "ready";
    } catch (error) {
      if (expandedRankingEntryId !== targetId) return;
      rankingCommentsStatus = "error";
      rankingCommentsError = error?.message || "コメントを取得できませんでした。";
    }
    renderRankingScreen({ preserveScroll: true });
  }

  function toggleRankingComments(entryId) {
    const targetId = String(entryId || "");
    if (expandedRankingEntryId === targetId) {
      expandedRankingEntryId = "";
      rankingComments = [];
      rankingCommentsStatus = "idle";
      renderRankingScreen({ preserveScroll: true });
      return;
    }
    expandedRankingEntryId = targetId;
    loadRankingComments(targetId);
  }

  async function prepareRankingCommentIdentity(entryId) {
    rankingCommentIdentityStatus = "loading";
    renderRankingScreen({ preserveScroll: true });
    try {
      rankingCommentIdentity = await window.HariaiOnline?.getLeaderboardCommentIdentity?.();
      rankingCommentIdentityStatus = "ready";
    } catch (error) {
      rankingCommentIdentity = null;
      rankingCommentIdentityStatus = "idle";
      showToast(error?.message || "投稿資格を確認できませんでした。");
    }
    if (expandedRankingEntryId === entryId) renderRankingScreen({ preserveScroll: true });
  }

  async function submitRankingComment(form) {
    const targetId = String(form.dataset.rankingCommentForm || "");
    const textarea = form.querySelector("textarea");
    try {
      setBusy(true, "コメントを保存しています…");
      await window.HariaiOnline?.saveLeaderboardComment?.(targetId, textarea?.value || "");
      showToast("コメントを保存しました。");
      await loadRankingComments(targetId);
    } catch (error) {
      showToast(error?.message || "コメントを保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function removeRankingComment(targetId, authorId) {
    if (!window.confirm("このコメントを削除しますか？")) return;
    try {
      setBusy(true, "コメントを削除しています…");
      await window.HariaiOnline?.deleteLeaderboardComment?.(targetId, authorId);
      showToast("コメントを削除しました。");
      await loadRankingComments(targetId);
    } catch (error) {
      showToast(error?.message || "コメントを削除できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  function bindRankingCommentEvents() {
    document.querySelectorAll("[data-ranking-comments-toggle]").forEach((button) => {
      button.addEventListener("click", () => toggleRankingComments(button.dataset.rankingCommentsToggle));
    });
    document.querySelector("[data-ranking-comments-retry]")?.addEventListener("click", (event) => {
      loadRankingComments(event.currentTarget.dataset.rankingCommentsRetry);
    });
    document.querySelector("[data-ranking-comment-auth]")?.addEventListener("click", (event) => {
      prepareRankingCommentIdentity(event.currentTarget.dataset.rankingCommentAuth);
    });
    document.querySelector("[data-ranking-comment-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitRankingComment(event.currentTarget);
    });
    document.querySelectorAll("[data-ranking-comment-delete]").forEach((button) => {
      button.addEventListener("click", () => removeRankingComment(button.dataset.rankingCommentTarget, button.dataset.rankingCommentDelete));
    });
  }

  function rankingPeriodInfo() {
    return window.HariaiOnline?.getLeaderboardPeriodInfo?.(rankingPeriod) || {
      period: rankingPeriod,
      key: "",
      label: "期間を確認中",
      nextResetAt: 0,
      minimumMatches: rankingPeriod === "daily" ? 1 : rankingPeriod === "weekly" ? 3 : 5,
    };
  }

  function rankingResetLabel(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "";
    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    }).format(new Date(Number(timestamp)));
  }

  function refreshSelectedRankingPeriod() {
    const info = rankingPeriodInfo();
    rankingDisplayedPeriodKey = info.key;
    expandedRankingEntryId = "";
    rankingComments = [];
    rankingCommentsStatus = "idle";
    window.HariaiOnline?.refreshLeaderboard?.(rankingPeriod);
  }

  function selectRankingPeriod(period) {
    if (!["daily", "weekly", "monthly"].includes(period) || period === rankingPeriod) return;
    rankingPeriod = period;
    refreshSelectedRankingPeriod();
  }

  function refreshRankingAtPeriodBoundary() {
    if (currentScreen !== "ranking") return;
    const info = rankingPeriodInfo();
    if (info.key && info.key !== rankingDisplayedPeriodKey) refreshSelectedRankingPeriod();
  }

  function renderRankingScreen({ refresh = false, preserveScroll = false } = {}) {
    currentScreen = "ranking";
    setLandingChrome();
    const entries = window.HariaiOnline?.getLeaderboard?.() || [];
    const status = window.HariaiOnline?.getLeaderboardStatus?.() || "idle";
    const participationMenu = window.HariaiOnline?.renderOverallRankingParticipation?.({
      controlId: "rankingOverallParticipation",
    }) || "";
    const periodInfo = rankingPeriodInfo();
    const resetLabel = rankingResetLabel(periodInfo.nextResetAt);
    const rows = entries.length ? entries.map((entry, index) => {
      const matches = Number(entry.wins || 0) + Number(entry.losses || 0) + Number(entry.draws || 0);
      const hasModePoints = entry.modePoints && typeof entry.modePoints === "object";
      const modePoints = {
        solo: Number(hasModePoints ? entry.modePoints.solo || 0 : entry.points || 0),
        strategy: Number(hasModePoints ? entry.modePoints.strategy || 0 : 0),
        team: Number(hasModePoints ? entry.modePoints.team || 0 : 0),
        royale: Number(hasModePoints ? entry.modePoints.royale || 0 : 0),
      };
      const modeBreakdown = `<span class="ranking-mode-points" aria-label="モード別期間ポイント"><em>通常 ${modePoints.solo}</em><em>戦略 ${modePoints.strategy}</em><em>2on2 ${modePoints.team}</em><em>BR ${modePoints.royale}</em></span>`;
      const provisional = matches < Number(periodInfo.minimumMatches || 1);
      const xHandle = /^[A-Za-z0-9_]{1,15}$/.test(String(entry.xHandle || "")) ? String(entry.xHandle) : "";
      const xLink = xHandle ? `<a class="ranking-x-link" href="https://x.com/${encodeURIComponent(xHandle)}" target="_blank" rel="noopener noreferrer">X&nbsp;@${escapeHtml(xHandle)}</a>` : "";
      const entryId = String(entry.entryId || "");
      const expanded = expandedRankingEntryId === entryId;
      const commentsEnabled = entry.commentsEnabled !== false;
      return `<article class="ranking-entry ${expanded ? "is-expanded" : ""}">
        <div class="ranking-row">
          <strong class="ranking-position">${index + 1}</strong>
          <div class="ranking-player"><b>${escapeHtml(entry.name)}</b>${xLink}<small>${provisional ? `仮順位 / ${matches}戦` : `${matches}戦`}</small></div>
          <div class="ranking-rating"><strong>${Number(entry.points || 0)}</strong><small>PERIOD PT</small></div>
          <div class="ranking-record"><span>総合 ${Number(entry.wins || 0)}勝 ${Number(entry.losses || 0)}敗 ${Number(entry.draws || 0)}分</span><small>総合RATE ${Number(entry.rating || 1000)}</small>${modeBreakdown}</div>
          <button class="ranking-comment-toggle" type="button" data-ranking-comments-toggle="${escapeHtml(entryId)}" aria-expanded="${expanded}" aria-controls="rankingComments-${escapeHtml(entryId)}" ${commentsEnabled ? "" : "disabled"}>${commentsEnabled ? (expanded ? "閉じる" : "コメント") : "受付停止"}</button>
        </div>
        ${expanded ? renderRankingCommentPanel(entry) : ""}
      </article>`;
    }).join("") : status === "error"
      ? `<div class="ranking-empty">ランキングを取得できませんでした。<br /><button class="button button-ghost button-small" id="rankingRetryButton">もう一度取得</button></div>`
      : status === "ready"
        ? `<div class="ranking-empty">この期間にはまだ対戦記録がありません。<br />オンライン対戦4モードの完了後に集計されます。</div>`
        : `<div class="ranking-empty">ランキングを取得しています…</div>`;
    app.innerHTML = `<section class="screen ranking-screen">
      <div class="section-head">
        <div><span class="eyebrow">ONLINE OVERALL RANKING / TOP 50</span><h1>オンライン総合ランキング</h1>
          <p>4つのオンライン対戦モード共通の期間ポイントと総合RATEで競います。</p></div>
        <button class="button button-ghost button-small" id="rankingBackButton">タイトルへ</button>
      </div>
      ${participationMenu}
      <div class="ranking-period-tabs" role="tablist" aria-label="ランキング期間">
        <button type="button" role="tab" data-ranking-period="daily" aria-selected="${rankingPeriod === "daily"}" class="${rankingPeriod === "daily" ? "is-active" : ""}">デイリー</button>
        <button type="button" role="tab" data-ranking-period="weekly" aria-selected="${rankingPeriod === "weekly"}" class="${rankingPeriod === "weekly" ? "is-active" : ""}">ウィークリー</button>
        <button type="button" role="tab" data-ranking-period="monthly" aria-selected="${rankingPeriod === "monthly"}" class="${rankingPeriod === "monthly" ? "is-active" : ""}">マンスリー</button>
      </div>
      <div class="ranking-period-summary"><strong>${escapeHtml(periodInfo.label)}</strong><span>勝利・BR優勝3pt ／ 引き分け・BR2位1pt${resetLabel ? ` ／ 次回切替 ${escapeHtml(resetLabel)}` : ""}</span></div>
      <div class="ranking-notice">通常型1on1・戦略型1on1・2on2・バトルロワイヤルを合算します。期間戦績は日本時間で自動切替、総合RATEはリセットされません。任意公開のXリンク・コメントも表示します。</div>
      <div class="ranking-list" aria-label="プレイヤーランキング">${rows}</div>
      <p class="ranking-casual-note">総合ランキング導入後に完了した4モードのオンライン対戦を集計します。バトルロワイヤルは1位を勝利、2位を引き分け、3・4位を敗北として扱います。カジュアル版のため、RATEと戦績はブラウザからFirebaseへ送信されます。</p>
    </section>`;
    document.querySelector("#rankingBackButton")?.addEventListener("click", renderLandingScreen);
    document.querySelector("#rankingRetryButton")?.addEventListener("click", refreshSelectedRankingPeriod);
    document.querySelectorAll("[data-ranking-period]").forEach((button) => {
      button.addEventListener("click", () => selectRankingPeriod(button.dataset.rankingPeriod));
    });
    window.HariaiOnline?.bindOverallRankingParticipation?.({
      controlId: "rankingOverallParticipation",
      onUpdate: () => renderRankingScreen({ preserveScroll: true }),
    });
    bindRankingCommentEvents();
    app.focus({ preventScroll: true });
    if (!preserveScroll) window.scrollTo({ top: 0, behavior: "smooth" });
    if (refresh) refreshSelectedRankingPeriod();
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

  function makeDeckItem(blob, position, { isSample = false } = {}) {
    return {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      blob,
      url: URL.createObjectURL(blob),
      position,
      used: false,
      isSample,
    };
  }

  async function createSampleItems(playerIndex, count = MAX_ROUNDS, offset = 0) {
    const items = [];
    for (let index = 0; index < count; index += 1) {
      const position = offset + index;
      const blob = await createSampleImage(playerIndex, position);
      items.push(makeDeckItem(blob, position, { isSample: true }));
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
    if (footerItems[0]) footerItems[0].textContent = "ONLINE 1ON1 + STRATEGY + 2ON2 + BATTLE ROYALE / FIREBASE + WEBRTC";
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
    if (currentScreen === "ranking") renderRankingScreen({ preserveScroll: true });
  });

  window.addEventListener("hariai-online-ready", () => {
    if (currentScreen === "ranking") refreshSelectedRankingPeriod();
  });

  window.setInterval(refreshRankingAtPeriodBoundary, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshRankingAtPeriodBoundary();
  });

  renderLandingScreen();
})();
