const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const strategy = fs.readFileSync(path.join(root, "strategy.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const rules = JSON.parse(
  fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
);

function extractFunction(name) {
  const asyncMarker = `async function ${name}(`;
  const functionMarker = `function ${name}(`;
  let start = strategy.indexOf(asyncMarker);
  if (start < 0) start = strategy.indexOf(functionMarker);
  assert.notEqual(start, -1, `${name} could not be found`);

  const openingBrace = strategy.indexOf("{", start);
  assert.notEqual(openingBrace, -1, `${name} has no body`);
  let depth = 0;
  for (let index = openingBrace; index < strategy.length; index += 1) {
    if (strategy[index] === "{") depth += 1;
    else if (strategy[index] === "}") {
      depth -= 1;
      if (depth === 0) return strategy.slice(start, index + 1);
    }
  }
  assert.fail(`${name} body is incomplete`);
}

function createSandbox({
  localWeaknessCorrect = true,
  remoteWeaknessCorrect = false,
  localChainCount = 3,
  remoteChainCount = 0,
  localReserveCount = 5,
  remoteReserveCount = 5,
} = {}) {
  const local = {
    uid: "local",
    weaknessCorrect: localWeaknessCorrect,
    weaknessChainCount: 0,
    reserveCount: localReserveCount,
    reserveUsed: 0,
    totalPower: 0,
    hp: 30,
    overkill: 0,
  };
  const remote = {
    uid: "remote",
    weaknessCorrect: remoteWeaknessCorrect,
    weaknessChainCount: 0,
    reserveCount: remoteReserveCount,
    reserveUsed: 0,
    totalPower: 0,
    hp: 30,
    overkill: 0,
  };
  const counters = {
    advance: 0,
    advanceState: null,
    fail: 0,
    send: 0,
  };
  const receivedSlots = (count) => Object.fromEntries(
    Array.from({ length: count }, (_, index) => [index, true]),
  );
  const sandbox = {
    MAX_WEAKNESS_CHAIN: 3,
    WEAKNESS_CHAIN_DAMAGE: [4, 3, 2],
    WEAKNESS_MISS_DAMAGE: 5,
    WEAKNESS_SCOUT_ROUND: 3,
    counters,
    state: {
      uid: local.uid,
      opponentUid: remote.uid,
      playerIndex: 0,
      players: [local, remote],
      reserve: [],
      roomId: "room",
      roomData: {
        weaknessGuesses: {
          [local.uid]: { guessIndex: 0, round: 3 },
          [remote.uid]: { guessIndex: 1, round: 3 },
        },
        weaknessReveals: {
          [local.uid]: { weaknessIndex: 2, salt: "a".repeat(32) },
          [remote.uid]: { weaknessIndex: 0, salt: "b".repeat(32) },
        },
        weaknessChains: {
          [local.uid]: { ready: true, count: localChainCount },
          [remote.uid]: { ready: true, count: remoteChainCount },
        },
        weaknessChainImagesReceived: {
          [local.uid]: {
            [remote.uid]: receivedSlots(localChainCount),
          },
          [remote.uid]: {
            [local.uid]: receivedSlots(remoteChainCount),
          },
        },
      },
      weaknessTriggerRound: 3,
      weaknessIntegrityFailed: false,
      weaknessPhaseComplete: false,
      weaknessRevealsVerified: true,
      weaknessChainLocked: true,
      weaknessChainApplied: false,
      weaknessResult: null,
      weaknessSurrenderApplied: false,
      localWeaknessChainCards: Array.from({ length: localChainCount }, () => ({})),
      remoteImages: new Map(
        Array.from(
          { length: remoteChainCount },
          (_, index) => [`weaknessChain:${index}`, {}],
        ),
      ),
      screen: "waitingWeaknessChainImage",
    },
    applyWeaknessSurrenders: null,
    both(object) {
      return Boolean(object?.[local.uid] && object?.[remote.uid]);
    },
    getLocalPlayer() {
      return sandbox.state.players[sandbox.state.playerIndex];
    },
    getOpponent() {
      return sandbox.state.players[1 - sandbox.state.playerIndex];
    },
    async advanceAfterWeaknessPhase() {
      counters.advance += 1;
      counters.advanceState = {
        remoteHp: sandbox.state.players[1].hp,
        remoteSurrendered: sandbox.state.weaknessResult?.surrenders?.[1] === true,
      };
      sandbox.state.weaknessPhaseComplete = true;
    },
    async failWeaknessIntegrityCheck() {
      counters.fail += 1;
      sandbox.state.weaknessIntegrityFailed = true;
    },
    async sendWeaknessChainImages() {
      if (sandbox.weaknessImagesSent) return;
      sandbox.weaknessImagesSent = true;
      counters.send += 1;
    },
    async verifyWeaknessReveals() {
      return true;
    },
    setStrategyChrome() {},
    triggerCriticalFx() {},
    render() {},
    showToast() {},
    console,
  };

  const runtime = [
    extractFunction("imageKey"),
    extractFunction("remainingReserve"),
    extractFunction("weaknessChainImagesReady"),
    extractFunction("weaknessChainsValid"),
    extractFunction("resolveWeaknessChain"),
    extractFunction("applyWeaknessSurrenders"),
    extractFunction("reactToWeaknessPhase"),
    "this.reactToWeaknessPhase = reactToWeaknessPhase;",
    "this.weaknessChainsValid = weaknessChainsValid;",
  ].join("\n");
  vm.runInNewContext(runtime, sandbox);
  return sandbox;
}

test("resolved weakness chains skip mutable reserve revalidation on later room updates", async () => {
  const scenarios = [
    {
      label: "one-card local chain",
      options: { localChainCount: 1, localReserveCount: 1 },
    },
    {
      label: "two-card local chain",
      options: { localChainCount: 2, localReserveCount: 2 },
    },
    {
      label: "three-card local chain",
      options: { localChainCount: 3, localReserveCount: 5 },
    },
    {
      label: "three-card remote chain",
      options: {
        localWeaknessCorrect: false,
        remoteWeaknessCorrect: true,
        localChainCount: 0,
        remoteChainCount: 3,
        remoteReserveCount: 5,
      },
    },
    {
      label: "simultaneous successful chains",
      options: {
        localWeaknessCorrect: true,
        remoteWeaknessCorrect: true,
        localChainCount: 3,
        remoteChainCount: 2,
        localReserveCount: 5,
        remoteReserveCount: 2,
      },
    },
  ];

  for (const scenario of scenarios) {
    const sandbox = createSandbox(scenario.options);
    const chains = sandbox.state.roomData.weaknessChains;

    assert.equal(sandbox.weaknessChainsValid(chains), true, scenario.label);
    await sandbox.reactToWeaknessPhase();
    assert.equal(sandbox.state.weaknessChainApplied, true, scenario.label);
    assert.equal(sandbox.counters.fail, 0, scenario.label);

    const appliedPlayers = sandbox.state.players.map((player) => ({
      hp: player.hp,
      overkill: player.overkill,
      reserveUsed: player.reserveUsed,
      totalPower: player.totalPower,
      weaknessChainCount: player.weaknessChainCount,
    }));
    const sendsAfterApply = sandbox.counters.send;
    assert.equal(
      sandbox.weaknessChainsValid(chains),
      false,
      `${scenario.label}: the old repeated validation would reject the consumed chain`,
    );

    sandbox.state.roomData.weaknessContinue = { local: true };
    await sandbox.reactToWeaknessPhase();

    assert.equal(sandbox.counters.fail, 0, scenario.label);
    assert.equal(sandbox.counters.send, sendsAfterApply, scenario.label);
    assert.deepEqual(
      sandbox.state.players.map((player) => ({
        hp: player.hp,
        overkill: player.overkill,
        reserveUsed: player.reserveUsed,
        totalPower: player.totalPower,
        weaknessChainCount: player.weaknessChainCount,
      })),
      appliedPlayers,
      scenario.label,
    );
  }
});

test("resolved weakness chains still apply surrender before both players continue", async () => {
  const sandbox = createSandbox();
  await sandbox.reactToWeaknessPhase();

  sandbox.state.roomData.weaknessSurrenders = {
    remote: { surrendered: true },
  };
  sandbox.state.roomData.weaknessContinue = {
    local: true,
    remote: true,
  };
  await sandbox.reactToWeaknessPhase();

  assert.equal(sandbox.state.players[1].hp, 0);
  assert.equal(sandbox.state.weaknessResult.surrenders[1], true);
  assert.equal(sandbox.counters.advance, 1);
  assert.deepEqual(sandbox.counters.advanceState, {
    remoteHp: 0,
    remoteSurrendered: true,
  });
  assert.equal(sandbox.counters.fail, 0);
  assert.equal(sandbox.counters.send, 1);
});

test("weakness chains wait for every image receipt and resolve only once", async () => {
  const sandbox = createSandbox();
  delete sandbox.state.roomData
    .weaknessChainImagesReceived.local.remote[2];

  await sandbox.reactToWeaknessPhase();
  assert.equal(sandbox.state.weaknessChainApplied, false);
  assert.equal(sandbox.counters.send, 1);
  assert.equal(sandbox.counters.fail, 0);

  sandbox.state.roomData
    .weaknessChainImagesReceived.local.remote[2] = true;
  await sandbox.reactToWeaknessPhase();
  assert.equal(sandbox.state.weaknessChainApplied, true);
  assert.equal(sandbox.state.players[0].reserveUsed, 3);
  assert.equal(sandbox.counters.send, 1);

  const appliedHp = sandbox.state.players.map((player) => player.hp);
  await sandbox.reactToWeaknessPhase();
  assert.deepEqual(
    sandbox.state.players.map((player) => player.hp),
    appliedHp,
  );
  assert.equal(sandbox.state.players[0].reserveUsed, 3);
  assert.equal(sandbox.counters.send, 1);
  assert.equal(sandbox.counters.fail, 0);
});

test("unresolved weakness chains still reject invalid first-time declarations", async () => {
  for (const scenario of [
    {
      label: "more cards than the remaining reserve",
      options: { localChainCount: 3, localReserveCount: 2 },
    },
    {
      label: "a positive chain after a failed weakness guess",
      options: { localWeaknessCorrect: false, localChainCount: 1 },
    },
  ]) {
    const sandbox = createSandbox(scenario.options);
    await sandbox.reactToWeaknessPhase();
    assert.equal(sandbox.counters.fail, 1, scenario.label);
    assert.equal(sandbox.counters.send, 0, scenario.label);
    assert.equal(sandbox.state.weaknessChainApplied, false, scenario.label);
  }
});

test("strategy weakness-chain fix uses a fresh browser cache key", () => {
  assert.match(
    index,
    /strategy\.js\?v=[^"]*strategy-weakness-chain-reentry-v1/,
  );
});

test("weakness chain declarations remain write-once in database rules", () => {
  const writeRule = rules.rules.online.strategyRooms.$roomId
    .weaknessChains.$uid[".write"];
  assert.match(writeRule, /!data\.exists\(\)/);
});
