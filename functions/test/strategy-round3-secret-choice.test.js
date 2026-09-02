"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const strategySource = read("strategy.js");
const indexHtml = read("index.html");

function namedFunction(source, name) {
  const markers = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu)];
  const markerIndex = markers.findIndex((match) => match[1] === name);
  assert.ok(markerIndex >= 0, `function is available: ${name}`);
  return source.slice(markers[markerIndex].index, markers[markerIndex + 1]?.index ?? source.length);
}

function loadWeaknessResolution({ localGuess, remoteGuess, localCorrect, remoteCorrect }) {
  const players = [
    {
      uid: "local",
      hp: 30,
      reserveCount: 5,
      reserveUsed: 0,
      totalPower: 0,
      overkill: 0,
      weaknessGuess: localGuess,
      weaknessChoice: localGuess === -1 ? "pass" : "guess",
      weaknessCorrect: localCorrect,
      weaknessChainCount: 0,
    },
    {
      uid: "remote",
      hp: 30,
      reserveCount: 5,
      reserveUsed: 0,
      totalPower: 0,
      overkill: 0,
      weaknessGuess: remoteGuess,
      weaknessChoice: remoteGuess === -1 ? "pass" : "guess",
      weaknessCorrect: remoteCorrect,
      weaknessChainCount: 0,
    },
  ];
  const sandbox = {
    MAX_WEAKNESS_CHAIN: 3,
    WEAKNESS_CHAIN_DAMAGE: [4, 3, 2],
    WEAKNESS_MISS_DAMAGE: 5,
    state: {
      players,
      playerIndex: 0,
      weaknessChainApplied: false,
      weaknessResult: null,
      screen: "waitingWeaknessChain",
    },
    setStrategyChrome() {},
    triggerCriticalFx() {},
    render() {},
  };
  vm.runInNewContext(
    `${namedFunction(strategySource, "resolveWeaknessChain")}\nthis.resolveForTest = resolveWeaknessChain;`,
    sandbox,
  );
  sandbox.resolveForTest(
    {
      local: { guessIndex: localGuess, round: 3 },
      remote: { guessIndex: remoteGuess, round: 3 },
    },
    {
      local: { ready: true, count: 0 },
      remote: { ready: true, count: 0 },
    },
  );
  return sandbox;
}

function loadChoiceVerifier() {
  const sandbox = {
    WEAKNESS_SCOUT_ROUND: 3,
    state: {
      roomId: "room-secret-choice",
      weaknessTriggerRound: 0,
      players: [
        { uid: "local", weaknessChoice: "", weaknessGuess: null, weaknessCorrect: false },
        { uid: "remote", weaknessChoice: "", weaknessGuess: null, weaknessCorrect: false },
      ],
    },
    async sha256Hex(value) {
      return createHash("sha256").update(String(value)).digest("hex");
    },
  };
  vm.runInNewContext(
    [
      namedFunction(strategySource, "normalizeWeaknessChoice"),
      namedFunction(strategySource, "weaknessChoiceCommitMaterial"),
      namedFunction(strategySource, "verifyWeaknessChoiceReveals"),
      "this.materialForTest = weaknessChoiceCommitMaterial;",
      "this.verifyForTest = verifyWeaknessChoiceReveals;",
    ].join("\n"),
    sandbox,
  );
  return sandbox;
}

test("ROUND 3 offers an independent secret choice while ROUND 1/2 keep voluntary early guesses", () => {
  assert.match(strategySource, /const STRATEGY_PROTOCOL_VERSION = 2;/u);
  assert.match(strategySource, /const WEAKNESS_SCOUT_ROUND = 3;/u);

  const roundResult = namedFunction(strategySource, "renderRoundResult");
  const earlyGuess = namedFunction(strategySource, "renderWeaknessGuess");
  const roundThreeChoice = namedFunction(strategySource, "renderWeaknessChoice");
  const bindings = namedFunction(strategySource, "bindScreenEvents");
  assert.match(roundResult, /state\.round < WEAKNESS_SCOUT_ROUND/u);
  assert.match(roundResult, /今ここで弱点を看破する/u);
  assert.match(roundThreeChoice, /看破する/u);
  assert.match(roundThreeChoice, /見送る/u);
  assert.match(roundThreeChoice, /秘密/u);
  assert.doesNotMatch(roundThreeChoice, /相手が看破を宣言しました/u);
  assert.match(earlyGuess, /相手が看破を宣言しました/u);
  assert.match(bindings, /input\[name="weaknessChoice"\]/u);
  assert.match(bindings, /#strategyWeaknessChoiceForm[^\n]*lockWeaknessChoice/u);
});

test("protocol version 2 fences new secret-choice clients from legacy matchmaking", () => {
  const begin = namedFunction(strategySource, "beginMatchmaking");
  const incoming = namedFunction(strategySource, "processIncomingOffers");
  const hosting = namedFunction(strategySource, "attemptToHost");
  const createOffer = namedFunction(strategySource, "createOffer");
  const acceptOffer = namedFunction(strategySource, "acceptOffer");
  const enterRoom = namedFunction(strategySource, "enterRoom");

  assert.match(begin, /protocolVersion:\s*STRATEGY_PROTOCOL_VERSION/u);
  assert.match(begin, /state:\s*STRATEGY_QUEUE_WAITING_STATE/u);
  assert.match(hosting, /Number\(entry\.protocolVersion\)\s*===\s*STRATEGY_PROTOCOL_VERSION/u);
  assert.match(hosting, /entry\.state\s*===\s*STRATEGY_QUEUE_WAITING_STATE/u);
  assert.match(incoming, /Number\(offer\?\.protocolVersion\)\s*===\s*STRATEGY_PROTOCOL_VERSION/u);
  assert.ok(
    (createOffer.match(/protocolVersion:\s*STRATEGY_PROTOCOL_VERSION/gu) || []).length >= 2,
    "the room and offer both advertise protocol version 2",
  );
  assert.match(acceptOffer, /Number\(offer\?\.protocolVersion\)\s*!==\s*STRATEGY_PROTOCOL_VERSION/u);
  assert.match(acceptOffer, /Number\(room\.protocolVersion\)\s*!==\s*STRATEGY_PROTOCOL_VERSION/u);
  assert.match(enterRoom, /Number\(room\.protocolVersion\)\s*!==\s*STRATEGY_PROTOCOL_VERSION/u);
});

test("ROUND 3 choice commit binds room, player, round, choice, guess and salt without disclosing the choice", () => {
  const material = namedFunction(strategySource, "weaknessChoiceCommitMaterial");
  const prepare = namedFunction(strategySource, "prepareWeaknessChoiceCommit");
  const lock = namedFunction(strategySource, "lockWeaknessChoice");
  const submit = namedFunction(strategySource, "submitWeaknessChoiceCommit");

  assert.match(prepare, /randomHex\(/u);
  assert.match(prepare, /sha256Hex\(weaknessChoiceCommitMaterial\(targetState\.roomId, targetState\.uid, reveal\)\)/u);
  for (const binding of ["uid", "round", "choice", "guessIndex", "salt"]) {
    assert.match(`${material}\n${prepare}`, new RegExp(`\\b${binding}\\b`), `commit binds ${binding}`);
  }

  assert.match(submit, /weaknessChoiceCommits\/\$\{uid\}/u);
  const commitWrite = submit.match(/await set\(commitRef,\s*\{[\s\S]*?\}\);/u)?.[0] || "";
  assert.match(commitWrite, /digest/u);
  assert.match(commitWrite, /round:\s*WEAKNESS_SCOUT_ROUND/u);
  assert.match(commitWrite, /lockedAt:\s*serverTimestamp\(\)/u);
  assert.doesNotMatch(commitWrite, /\b(?:choice|guessIndex|salt)\s*:/u,
    "the public commit record must not reveal the pending choice");
  assert.match(`${lock}\n${submit}`, /waitingWeaknessChoice/u);
});

test("ROUND 3 choice locking closes the double-submit race before hashing", async () => {
  let releaseHash;
  let prepareCalls = 0;
  let setCalls = 0;
  const hashGate = new Promise((resolve) => { releaseHash = resolve; });
  const targetState = {
    roomId: "room-double-submit",
    uid: "local",
    round: 3,
    weaknessPhaseComplete: false,
    weaknessChoiceLocked: false,
    selectedWeaknessChoice: "pass",
    roomData: {},
    destroyedByOpponent: false,
    weaknessIntegrityFailed: false,
  };
  const sandbox = {
    WEAKNESS_SCOUT_ROUND: 3,
    active: true,
    state: targetState,
    database: {},
    document: {
      querySelector(selector) {
        return selector.includes('name="weaknessChoice"') ? { value: "pass" } : null;
      },
    },
    async prepareWeaknessChoiceCommit() {
      prepareCalls += 1;
      await hashGate;
      return {
        reveal: { choice: "pass", guessIndex: -1, round: 3, salt: "b".repeat(32) },
        digest: "a".repeat(64),
      };
    },
    ref: (_database, valuePath) => valuePath,
    async set() { setCalls += 1; },
    get: async () => ({ val: () => null }),
    serverTimestamp: () => 123,
    setStrategyChrome() {},
    render() {},
    showToast() {},
    console: { error() {} },
  };
  vm.runInNewContext(
    [
      namedFunction(strategySource, "strategyRoomOperationIsCurrent"),
      namedFunction(strategySource, "submitWeaknessChoiceCommit"),
      namedFunction(strategySource, "lockWeaknessChoice"),
      "this.lockForTest = lockWeaknessChoice;",
    ].join("\n"),
    sandbox,
  );

  const first = sandbox.lockForTest({ preventDefault() {} });
  const second = sandbox.lockForTest({ preventDefault() {} });
  assert.equal(targetState.weaknessChoiceLocked, true);
  assert.equal(targetState.screen, "waitingWeaknessChoice", "the editable form is removed before hashing yields");
  assert.equal(prepareCalls, 1, "only the first click may start hashing");
  releaseHash();
  await Promise.all([first, second]);
  assert.equal(setCalls, 1, "only one opaque commit may be written");
  assert.equal(targetState.screen, "waitingWeaknessChoice");
});

test("an ambiguous commit response keeps the original choice sealed and retries only the same digest", async () => {
  const digest = "c".repeat(64);
  const writes = [];
  let failFirstWrite = true;
  const targetState = {
    roomId: "room-ambiguous-commit",
    uid: "local",
    round: 3,
    weaknessPhaseComplete: false,
    weaknessChoiceLocked: true,
    weaknessChoiceCommitSending: false,
    weaknessChoiceCommitUncertain: false,
    weaknessChoiceDigest: digest,
    selectedWeaknessChoice: "pass",
    selectedWeaknessGuess: null,
    roomData: {},
    destroyedByOpponent: false,
    weaknessIntegrityFailed: false,
    screen: "waitingWeaknessChoice",
  };
  const sandbox = {
    WEAKNESS_SCOUT_ROUND: 3,
    active: true,
    state: targetState,
    database: {},
    ref: (_database, valuePath) => valuePath,
    serverTimestamp: () => 789,
    async set(_commitRef, payload) {
      writes.push({ ...payload });
      if (failFirstWrite) {
        failFirstWrite = false;
        throw new Error("response lost");
      }
    },
    async get() {
      throw new Error("offline while reconciling");
    },
    async failWeaknessIntegrityCheck() {
      throw new Error("integrity failure was not expected");
    },
    setStrategyChrome() {},
    render() {},
    showToast() {},
    console: { error() {} },
  };
  vm.runInNewContext(
    [
      namedFunction(strategySource, "strategyRoomOperationIsCurrent"),
      namedFunction(strategySource, "submitWeaknessChoiceCommit"),
      namedFunction(strategySource, "retryWeaknessChoiceCommit"),
      "this.submitForTest = submitWeaknessChoiceCommit;",
      "this.retryForTest = retryWeaknessChoiceCommit;",
    ].join("\n"),
    sandbox,
  );

  assert.equal(await sandbox.submitForTest(targetState, targetState.roomId, targetState.uid, digest), false);
  assert.equal(targetState.weaknessChoiceLocked, true, "an ambiguous network result must not reopen the choice");
  assert.equal(targetState.weaknessChoiceCommitUncertain, true);
  assert.equal(targetState.selectedWeaknessChoice, "pass");
  assert.equal(targetState.weaknessChoiceDigest, digest);

  await sandbox.retryForTest();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map((payload) => payload.digest), [digest, digest]);
  assert.equal(targetState.weaknessChoiceCommitUncertain, false);
  assert.equal(targetState.weaknessChoiceLocked, true);
  assert.equal(targetState.selectedWeaknessChoice, "pass");
});

test("database reconnect re-drives sealed weakness writes in the same room", () => {
  const listeners = namedFunction(strategySource, "setupRoomListeners");
  assert.match(listeners, /ref\(database, "\.info\/connected"\)/u);
  assert.match(listeners, /databaseWasConnected\s*===\s*false\s*&&\s*connected/u);
  assert.match(listeners, /state\.roomId\s*!==\s*ownedRoomId/u);
  assert.match(listeners, /reactToRoomData\(\)\.catch\(handleRecoverableError\)/u);
});

test("strategy result claim recovers an ACK lost after the write-once pair committed", async () => {
  let updateCalls = 0;
  let storedRoom = {};
  const targetState = {
    roomId: "room-final-claim",
    uid: "local",
    playerIndex: 0,
    resultClaimCommitted: false,
    roomData: {},
  };
  const sandbox = {
    database: {},
    ref: (_database, valuePath) => valuePath,
    serverTimestamp: () => 456,
    update: async (_roomPath, patch) => {
      updateCalls += 1;
      storedRoom = {
        resultClaims: { local: patch["resultClaims/local"] },
        finished: { local: patch["finished/local"] },
      };
      throw new Error("response lost after server commit");
    },
    get: async () => ({ val: () => storedRoom }),
  };
  vm.runInNewContext(
    `${namedFunction(strategySource, "ensureStrategyResultClaim")}\nthis.ensureForTest = ensureStrategyResultClaim;`,
    sandbox,
  );

  assert.equal(await sandbox.ensureForTest(targetState, { winnerIndex: 0 }), true);
  assert.equal(targetState.resultClaimCommitted, true);
  assert.equal(storedRoom.resultClaims.local.outcome, "win");
  assert.equal(storedRoom.finished.local, true);
  assert.equal(updateCalls, 1);
  assert.equal(await sandbox.ensureForTest(targetState, { winnerIndex: 0 }), true);
  assert.equal(updateCalls, 1, "a verified write-once claim is not submitted twice");
});

test("room destruction during final hash verification cannot publish a result or reopen gameover", async () => {
  let releaseVerification;
  let resultClaims = 0;
  const verificationGate = new Promise((resolve) => { releaseVerification = resolve; });
  const targetState = {
    roomId: "room-final-destroy-race",
    uid: "local",
    opponentUid: "remote",
    playerIndex: 0,
    players: [{ hp: 10, totalPower: 20 }, { hp: 5, totalPower: 10 }],
    screen: "waitingFinalWeaknessReveal",
    roomData: {
      weaknessReveals: {
        local: { weaknessIndex: 0, salt: "a".repeat(32) },
        remote: { weaknessIndex: 1, salt: "b".repeat(32) },
      },
    },
    destroyedByOpponent: false,
    weaknessIntegrityFailed: false,
    finalWeaknessRevealsVerified: false,
    finalizationBusy: false,
  };
  const sandbox = {
    active: true,
    state: targetState,
    stopStrategyVideoRecording() {},
    closeStrategyVideoDialog() {},
    both: (value) => Boolean(value?.local && value?.remote),
    async ensureLocalWeaknessReveal() {},
    async verifyWeaknessCommitReveals() {
      await verificationGate;
      return true;
    },
    async failWeaknessIntegrityCheck() {},
    determineOutcome: () => ({ winnerIndex: 0 }),
    async ensureStrategyResultClaim() { resultClaims += 1; },
    cleanupPublicPresence() { return Promise.resolve(); },
    async commitStrategyStats() {},
    setStrategyChrome() {},
    render() {},
    showToast() {},
    console,
  };
  vm.runInNewContext(
    [
      namedFunction(strategySource, "strategyRoomOperationIsCurrent"),
      namedFunction(strategySource, "finishMatch"),
      "this.finishForTest = finishMatch;",
    ].join("\n"),
    sandbox,
  );

  const pending = sandbox.finishForTest();
  await Promise.resolve();
  targetState.destroyedByOpponent = true;
  targetState.screen = "noContest";
  releaseVerification();
  await pending;

  assert.equal(resultClaims, 0);
  assert.equal(targetState.screen, "noContest");
  assert.equal(targetState.finalWeaknessRevealsVerified, false);
});

test("a transient result-claim failure stays on the reconnect-retry finalization screen", async () => {
  let claimAttempts = 0;
  let statsCommits = 0;
  const targetState = {
    roomId: "room-final-retry",
    uid: "local",
    opponentUid: "remote",
    playerIndex: 0,
    players: [{ hp: 20, totalPower: 30 }, { hp: 10, totalPower: 20 }],
    screen: "roundResult",
    roomData: {
      weaknessReveals: {
        local: { weaknessIndex: 0, salt: "a".repeat(32) },
        remote: { weaknessIndex: 1, salt: "b".repeat(32) },
      },
    },
    destroyedByOpponent: false,
    weaknessIntegrityFailed: false,
    finalWeaknessRevealsVerified: true,
    finalizationBusy: false,
    resultClaimCommitted: false,
  };
  const sandbox = {
    active: true,
    state: targetState,
    stopStrategyVideoRecording() {},
    closeStrategyVideoDialog() {},
    both: (value) => Boolean(value?.local && value?.remote),
    async ensureLocalWeaknessReveal() {},
    async verifyWeaknessCommitReveals() { return true; },
    async failWeaknessIntegrityCheck() {},
    determineOutcome: () => ({ winnerIndex: 0 }),
    async ensureStrategyResultClaim() {
      claimAttempts += 1;
      if (claimAttempts === 1) throw new Error("temporary result write failure");
      targetState.resultClaimCommitted = true;
    },
    cleanupPublicPresence() { return Promise.resolve(); },
    async commitStrategyStats() { statsCommits += 1; },
    setStrategyChrome() {},
    render() {},
    showToast() {},
    console: { error() {} },
  };
  vm.runInNewContext(
    [
      namedFunction(strategySource, "strategyRoomOperationIsCurrent"),
      namedFunction(strategySource, "finishMatch"),
      "this.finishForTest = finishMatch;",
    ].join("\n"),
    sandbox,
  );

  await assert.rejects(sandbox.finishForTest(), /temporary result write failure/u);
  assert.equal(targetState.screen, "waitingFinalWeaknessReveal");
  assert.equal(targetState.finalizationBusy, false);
  assert.equal(claimAttempts, 1);
  assert.equal(statsCommits, 0);

  await sandbox.finishForTest();
  assert.equal(claimAttempts, 2);
  assert.equal(statsCommits, 1);
  assert.equal(targetState.screen, "gameover");
});

test("a rejected room destruction never exits or reports a no-contest", async () => {
  const toasts = [];
  let cleanupCalls = 0;
  let returnHomeCalls = 0;
  let transactionCalls = 0;
  const sandbox = {
    active: true,
    state: {
      roomId: "room-destroy-denied",
      uid: "local",
      finalizationBusy: false,
      resultClaimCommitted: false,
    },
    database: {},
    ref: (_database, valuePath) => valuePath,
    async runTransaction() {
      transactionCalls += 1;
      throw new Error("permission denied");
    },
    async get() { return { val: () => null }; },
    async handleOpponentDestroyed() {},
    async cleanupOnlineResources() { cleanupCalls += 1; },
    releaseAllImages() {},
    window: { HariaiApp: { returnHome() { returnHomeCalls += 1; } } },
    showToast(message) { toasts.push(message); },
    console: { error() {} },
  };
  vm.runInNewContext(
    `${namedFunction(strategySource, "destroyRoom")}\nthis.destroyForTest = destroyRoom;`,
    sandbox,
  );

  await sandbox.destroyForTest();
  assert.equal(sandbox.active, true);
  assert.equal(cleanupCalls, 0);
  assert.equal(returnHomeCalls, 0);
  assert.match(toasts.at(-1), /破棄を確定できません/u);
  assert.doesNotMatch(toasts.at(-1), /戦績には影響しません/u);

  sandbox.state.finalizationBusy = true;
  await sandbox.destroyForTest();
  assert.equal(transactionCalls, 1, "finalization blocks a second destruction attempt before any write");
  assert.match(toasts.at(-1), /対戦結果を確定中/u);
});

test("choice reveal waits for both commits and validates both digests before outcome handling", () => {
  const react = namedFunction(strategySource, "reactToRoundThreeWeaknessChoice");
  const verify = namedFunction(strategySource, "verifyWeaknessChoiceReveals");

  const commitsRead = react.indexOf("weaknessChoiceCommits");
  const bothCommits = react.indexOf("both(commits)");
  const revealWrite = react.indexOf("weaknessChoices/${state.uid}");
  const choicesRead = react.indexOf("weaknessChoices");
  const bothChoices = react.indexOf("both(choices)");
  const verification = react.indexOf("verifyWeaknessChoiceReveals");
  assert.ok(commitsRead >= 0);
  assert.ok(bothCommits > commitsRead);
  assert.ok(revealWrite > bothCommits, "a choice cannot be revealed until both opaque commits exist");
  assert.ok(choicesRead >= 0);
  assert.ok(bothChoices > choicesRead);
  assert.ok(verification > bothChoices, "neither choice is acted on until both reveals are present");

  assert.match(verify, /sha256Hex\(/u);
  assert.match(verify, /commit\??\.digest|commits\[/u);
  const choiceContract = [
    namedFunction(strategySource, "normalizeWeaknessChoice"),
    namedFunction(strategySource, "weaknessChoiceCommitMaterial"),
    verify,
  ].join("\n");
  assert.match(choiceContract, /choice/u);
  assert.match(choiceContract, /guessIndex/u);
  assert.match(choiceContract, /salt/u);
  assert.match(verify, /return false/u);
});

test("choice digest verification accepts an honest pass/guess pair and rejects tampering", async () => {
  const sandbox = loadChoiceVerifier();
  const choices = {
    local: { choice: "pass", guessIndex: -1, round: 3, salt: "a".repeat(32) },
    remote: { choice: "guess", guessIndex: 2, round: 3, salt: "b".repeat(32) },
  };
  const commits = {};
  for (const [uid, choice] of Object.entries(choices)) {
    const material = sandbox.materialForTest(sandbox.state.roomId, uid, choice);
    commits[uid] = {
      digest: createHash("sha256").update(String(material)).digest("hex"),
      round: 3,
    };
  }

  assert.equal(await sandbox.verifyForTest(commits, choices), true);
  assert.equal(sandbox.state.players[0].weaknessChoice, "pass");
  assert.equal(sandbox.state.players[0].weaknessGuess, null);
  assert.equal(sandbox.state.players[1].weaknessChoice, "guess");
  assert.equal(sandbox.state.players[1].weaknessGuess, 2);

  const tampered = {
    ...choices,
    remote: { ...choices.remote, guessIndex: 1 },
  };
  assert.equal(await sandbox.verifyForTest(commits, tampered), false);
});

test("pass is represented as guessIndex -1 and only an incorrect guess takes miss damage", () => {
  const normalize = namedFunction(strategySource, "normalizeWeaknessChoice");
  assert.match(normalize, /choice\s*===\s*"pass"[^\n]*guessIndex\s*!==\s*-1/u);

  const oneGuess = loadWeaknessResolution({
    localGuess: -1,
    remoteGuess: 1,
    localCorrect: false,
    remoteCorrect: false,
  });
  assert.deepEqual(
    Array.from(oneGuess.state.weaknessResult.missDamage),
    [0, 5],
    "the passer is safe while the player who guessed incorrectly takes five damage",
  );
  assert.deepEqual(Array.from(oneGuess.state.players, (player) => player.hp), [30, 25]);

  const bothPass = loadWeaknessResolution({
    localGuess: -1,
    remoteGuess: -1,
    localCorrect: false,
    remoteCorrect: false,
  });
  assert.deepEqual(Array.from(bothPass.state.weaknessResult.missDamage), [0, 0]);
  assert.deepEqual(Array.from(bothPass.state.players, (player) => player.hp), [30, 30]);
});

test("both pass advances through zero-card chains without publishing either true weakness", () => {
  const react = namedFunction(strategySource, "reactToRoundThreeWeaknessChoice");
  const chain = namedFunction(strategySource, "reactToWeaknessChainResolution");
  const result = namedFunction(strategySource, "renderWeaknessChainResult");
  const context = vm.createContext({
    WEAKNESS_SCOUT_ROUND: 3,
    state: {
      players: [{ uid: "local" }, { uid: "remote" }],
    },
  });
  vm.runInContext(
    [
      namedFunction(strategySource, "normalizeWeaknessChoice"),
      namedFunction(strategySource, "weaknessRevealTargetsForChoices"),
      "this.targetsForTest = weaknessRevealTargetsForChoices;",
    ].join("\n"),
    context,
  );
  const pass = (salt) => ({ choice: "pass", guessIndex: -1, round: 3, salt });
  const guess = (guessIndex, salt) => ({ choice: "guess", guessIndex, round: 3, salt });
  assert.deepEqual(
    Array.from(context.targetsForTest({ local: pass("a".repeat(32)), remote: pass("b".repeat(32)) })),
    [],
    "both pass must not target either registered weakness for publication",
  );
  assert.deepEqual(
    Array.from(context.targetsForTest({ local: guess(0, "a".repeat(32)), remote: pass("b".repeat(32)) })),
    ["remote"],
    "a lone guess reveals only the opponent weakness needed to judge that guess",
  );

  assert.match(react, /revealTargets\.includes\(state\.uid\)[\s\S]*?ensureLocalWeaknessReveal\(\)/u);
  assert.match(react, /await reactToWeaknessChainResolution\(choices\)/u);
  assert.match(chain, /weaknessChains\/\$\{state\.uid\}/u);
  assert.match(chain, /ready:\s*true,\s*count:\s*0/u);
  assert.match(result, /BOTH PASSED/u);
  assert.match(result, /本当の弱点は伏せたまま、次のラウンドへ進みます。/u);
  assert.match(result, /回答なし \/ ペナルティなし/u);
});

test("Strategy browser asset uses the ROUND 3 secret-choice cache marker", () => {
  assert.match(
    indexHtml,
    /strategy\.js\?v=[^"]*strategy-round3-secret-choice-v1[^"]*"/u,
  );
});
