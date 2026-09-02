"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const strategySource = fs.readFileSync(path.join(root, "strategy.js"), "utf8");

function section(start, end) {
  const startIndex = strategySource.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = strategySource.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return strategySource.slice(startIndex, endIndex);
}

test("strategy freezes at activation, then materializes one immutable snapshot after reveal", () => {
  assert.match(strategySource, /httpsCallable,[\s\S]*?firebase-functions\.js/);
  assert.match(strategySource, /const matchAchievementShowcaseCallable = httpsCallable\(functions, "matchAchievementShowcase"\);/);

  const materialize = section(
    "function materializeMatchAchievementShowcases(room)",
    "function start()",
  );
  assert.match(materialize, /room\?\.status !== "active"/);
  assert.match(materialize, /room\?\.hostUid !== state\.uid/);
  assert.match(materialize, /!matchAchievementShowcaseRevealReady\(room\)/);
  assert.match(materialize, /state\.matchAchievementShowcaseRequested/);
  assert.match(materialize, /phase: "materialize"/);
  assert.match(materialize, /state\.roomId !== requestedRoomId/);
  assert.match(materialize, /captureMatchAchievementShowcases\(response\.data\)/);
  assert.match(materialize, /\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(materialize, /\bawait\b/);

  const freeze = section(
    "async function freezeMatchAchievementShowcases(roomId)",
    "function materializeMatchAchievementShowcases(room)",
  );
  assert.match(freeze, /matchAchievementShowcaseCallable\(\{/);
  assert.match(freeze, /phase: "freeze"/);
  assert.match(freeze, /return false/);
  assert.doesNotMatch(freeze, /captureMatchAchievementShowcases/);

  const acceptOffer = section("async function acceptOffer(roomId, offer)", "async function enterRoom(roomId,");
  const activateRoom = acceptOffer.indexOf('await set(statusRef, "active");');
  const freezeRoom = acceptOffer.indexOf("await freezeMatchAchievementShowcases(roomId);");
  const enterAcceptedRoom = acceptOffer.indexOf("await enterRoom(roomId, generation);");
  assert.ok(activateRoom >= 0 && activateRoom < freezeRoom);
  assert.ok(freezeRoom < enterAcceptedRoom);

  const enterRoom = section("async function enterRoom(roomId,", "async function setupRoomListeners()");
  const playerHydration = enterRoom.indexOf("state.players =");
  const existingCapture = enterRoom.indexOf("captureMatchAchievementShowcases(room.achievementShowcases);");
  const initialRender = enterRoom.indexOf("render();");
  const listeners = enterRoom.indexOf("await setupRoomListeners();");
  assert.ok(playerHydration >= 0 && playerHydration < existingCapture);
  assert.ok(initialRender >= 0 && initialRender < listeners);
  assert.doesNotMatch(enterRoom, /materializeMatchAchievementShowcases/);
  assert.doesNotMatch(enterRoom, /await materializeMatchAchievementShowcases/);
});

test("strategy freezes capped achievements and only bounded Danwaku days from the first snapshot", () => {
  const helpers = section(
    "function normalizeMatchAchievementShowcases(value)",
    "function renderOpponentAchievementShowcase",
  );
  const state = {
    players: [{ uid: "host" }, { uid: "guest" }],
    opponentUid: "guest",
    matchAchievementShowcases: null,
  };
  const knownIds = new Set(["one", "two", "three", "four"]);
  const window = {
    HariaiAchievements: {
      normalizeIds(value, maximum) {
        return [...new Set(String(value || "").split(",").filter((id) => knownIds.has(id)))].slice(0, maximum);
      },
    },
  };
  const load = new Function(
    "state",
    "window",
    `"use strict";
      const MATCH_ACHIEVEMENT_SHOWCASE_VERSION = 1;
      const MATCH_ACHIEVEMENT_SHOWCASE_LIMIT = 3;
      ${helpers}
      return { normalizeMatchAchievementShowcases, captureMatchAchievementShowcases, opponentAchievementShowcaseIds };`,
  );
  const harness = load(state, window);
  const first = {
    version: 1,
    capturedAt: 12345,
    players: {
      host: {
        ids: "four,three,two,one",
        danwakuDays: 1,
        noteTitle: "PRIVATE TITLE",
      },
      guest: {
        ids: "one,unknown,two,three,four",
        danwakuDays: 1_000_000,
        noteBody: "PRIVATE BODY",
        uid: "PRIVATE UID",
      },
    },
  };

  assert.equal(harness.captureMatchAchievementShowcases(first), true);
  assert.equal(Object.isFrozen(state.matchAchievementShowcases), true);
  assert.equal(Object.isFrozen(state.matchAchievementShowcases.players), true);
  assert.equal(Object.isFrozen(state.matchAchievementShowcases.players.guest), true);
  assert.equal(state.matchAchievementShowcases.players.host.ids, "four,three,two");
  assert.equal(state.matchAchievementShowcases.players.guest.ids, "one,two,three");
  assert.equal(state.matchAchievementShowcases.players.host.danwakuDays, 1);
  assert.equal(state.matchAchievementShowcases.players.guest.danwakuDays, 1_000_000);
  assert.deepEqual(
    Object.keys(state.matchAchievementShowcases.players.guest).sort(),
    ["danwakuDays", "ids"],
  );
  assert.doesNotMatch(
    JSON.stringify(state.matchAchievementShowcases.players),
    /PRIVATE TITLE|PRIVATE BODY|PRIVATE UID/,
  );
  assert.deepEqual(harness.opponentAchievementShowcaseIds(), ["one", "two", "three"]);

  assert.equal(harness.captureMatchAchievementShowcases({
    ...first,
    capturedAt: 99999,
    players: { host: { ids: "one" }, guest: { ids: "four" } },
  }), false);
  assert.equal(state.matchAchievementShowcases.capturedAt, 12345);
  assert.equal(state.matchAchievementShowcases.players.guest.danwakuDays, 1_000_000);
  assert.deepEqual(harness.opponentAchievementShowcaseIds(), ["one", "two", "three"]);

  state.matchAchievementShowcases = null;
  assert.equal(harness.normalizeMatchAchievementShowcases({ ...first, version: 2 }), null);
  assert.equal(harness.normalizeMatchAchievementShowcases({ ...first, capturedAt: 0 }), null);
  assert.equal(harness.normalizeMatchAchievementShowcases({
    ...first,
    players: { host: { ids: "one" } },
  }), null);

  for (const invalidDays of [0, -1, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    const normalized = harness.normalizeMatchAchievementShowcases({
      ...first,
      players: {
        host: { ids: "one", danwakuDays: invalidDays },
        guest: { ids: "two" },
      },
    });
    assert.equal("danwakuDays" in normalized.players.host, false, String(invalidDays));
  }
});

test("strategy room synchronization adopts the first server snapshot and rerenders only revealed phases", () => {
  const listeners = section("async function setupRoomListeners()", "async function setupPeerConnection()");
  assert.match(listeners, /const showcaseCaptured = captureMatchAchievementShowcases\(state\.roomData\.achievementShowcases\);/);
  assert.match(listeners, /materializeMatchAchievementShowcases\(state\.roomData\);/);
  assert.match(listeners, /if \(showcaseCaptured\) refreshMatchAchievementShowcaseIfVisible\(\);/);

  const refresh = section(
    "function refreshMatchAchievementShowcaseIfVisible()",
    "function matchAchievementShowcaseRevealReady(room)",
  );
  assert.match(refresh, /\["identity", "waitingBattle", "gameover"\]\.includes\(state\.screen\)/);
  assert.doesNotMatch(refresh, /IDENTIFIED_CHAT_SCREENS|review|connecting|intro|waitingDecision|deck|waitingDeck/);

  const revealBoundary = section(
    "function matchAchievementShowcaseRevealReady(room)",
    "function materializeMatchAchievementShowcases(room)",
  );
  assert.match(revealBoundary, /\[room\?\.hostUid, room\?\.guestUid\]/);
  assert.match(revealBoundary, /room\?\.deckReady\?\.\[uid\]\?\.ready === true/);
  assert.match(revealBoundary, /room\?\.deckReady\?\.\[uid\]\?\.mainCount === MAIN_COUNT/);
  assert.match(revealBoundary, /room\?\.deckReady\?\.\[uid\]\?\.reserveCount === RESERVE_COUNT/);
});

test("strategy hides achievements and Danwaku before identity, then shows only the opponent", () => {
  for (const [start, end] of [
    ["function renderConnecting()", "function renderAnonymousIntro()"],
    ["function renderAnonymousIntro()", "function renderWaitingDecision()"],
    ["function renderWaitingDecision()", "function renderDeckBuilder()"],
    ["function renderDeckBuilder()", "function renderDeckZone(zone)"],
    ["function renderWaitingDeck()", "function renderIdentityReveal()"],
  ]) {
    assert.doesNotMatch(section(start, end), /renderOpponentAchievementShowcase/);
  }

  const identity = section("function renderIdentityReveal()", "function renderWaitingBattle()");
  assert.match(identity, /localPlayer \? "" : renderOpponentAchievementShowcase\(\{ context: "is-identity"/);

  const waitingBattle = section("function renderWaitingBattle()", "function renderBaseSelect()");
  assert.match(waitingBattle, /renderOpponentAchievementShowcase\(\{ context: "is-identity"/);

  const hud = section("function renderHudPlayer(index)", "function renderBattleImage(");
  assert.match(hud, /localPlayer \? "" : renderOpponentAchievementShowcase\(\{ compact: true, context: "is-hud"/);

  const result = section("function renderGameOver()", "function syncStrategyFreeTableResultLamp()");
  assert.match(result, /index === state\.playerIndex \? "" : renderOpponentAchievementShowcase\(\{ context: "is-result"/);

  const renderer = section(
    "function renderOpponentAchievementShowcase",
    "function refreshMatchAchievementShowcaseIfVisible()",
  );
  assert.match(renderer, /if \(!ids\.length && !showDanwaku\) return "";/);
  assert.match(renderer, /renderBadges\?\.\(ids, \{ compact, empty: "" \}\)/);
  assert.match(renderer, /<span class="match-danwaku-badge"[^`]*>🪷 断惑 \$\{danwakuDays\}日目<\/span>/);
  assert.match(renderer, /match-achievement-showcase is-opponent\$\{modifier\}/);
  assert.match(renderer, /\["is-identity", "is-hud", "is-result"\]/);

  const renderHarness = new Function(
    "state",
    "window",
    "escapeHtml",
    `"use strict";
      function opponentAchievementShowcaseIds() { return []; }
      ${renderer}
      return renderOpponentAchievementShowcase;`,
  )({
    opponentUid: "guest",
    matchAchievementShowcases: {
      version: 1,
      capturedAt: 12345,
      players: {
        guest: {
          ids: "",
          danwakuDays: 7,
          noteTitle: "PRIVATE TITLE",
          noteBody: "PRIVATE BODY",
          uid: "PRIVATE UID",
        },
      },
    },
  }, {
    HariaiAchievements: {
      renderBadges() { return ""; },
    },
  }, String);
  const rendered = renderHarness({ context: "is-identity", label: "相手の実績" });
  assert.match(rendered, /match-achievement-showcase is-opponent is-identity/);
  assert.match(rendered, /<span class="match-danwaku-badge"[^>]*>🪷 断惑 7日目<\/span>/);
  assert.doesNotMatch(rendered, /PRIVATE TITLE|PRIVATE BODY|PRIVATE UID/);
});
