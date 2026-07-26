"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "../../team-duo-challenge.mjs")).href;
const helpersPromise = import(moduleUrl);

test("queue grouping accepts only protocol v2 solo plus two challengers", async () => {
  const {
    TEAM_CHALLENGE_PROTOCOL_VERSION,
    TEAM_CHALLENGE_VARIANT,
    eligibleTeamChallengeQueueEntries,
    validTeamChallengeQueueEntries,
    selectTeamChallengeGroup,
  } = await helpersPromise;
  assert.equal(eligibleTeamChallengeQueueEntries, validTeamChallengeQueueEntries);
  const now = 1_000_000;
  const base = {
    protocolVersion: TEAM_CHALLENGE_PROTOCOL_VERSION,
    variant: TEAM_CHALLENGE_VARIANT,
    state: "waiting",
    joinedAt: now - 2_000,
    lastSeen: now,
  };
  const entries = validTeamChallengeQueueEntries({
    old: { ...base, uid: "old", role: "oshi_jouzu", protocolVersion: 1 },
    solo: { ...base, uid: "solo", role: "oshi_jouzu" },
    first: { ...base, uid: "first", role: "challenger", joinedAt: now - 1_000 },
    second: { ...base, uid: "second", role: "challenger", joinedAt: now - 500 },
    active: { ...base, uid: "active", role: "challenger" },
  }, { now, activeUsers: { active: "room" } });
  assert.deepEqual(entries.map((entry) => entry.uid), ["solo", "first", "second"]);
  assert.deepEqual(selectTeamChallengeGroup(entries).map((entry) => entry.uid), ["solo", "first", "second"]);
});

test("duo plan uses agreement and deterministic slot fallback", async () => {
  const { resolveDuoPlan } = await helpersPromise;
  const challengers = [
    { uid: "b", slot: 2 },
    { uid: "a", slot: 1 },
  ];
  const components = {
    a: { audio: true, video: false, words: "Aのことば" },
    b: { audio: true, video: true, words: "Bのことば" },
  };
  assert.deepEqual(resolveDuoPlan({
    challengers,
    components,
    choices: {
      a: { audioOwnerUid: "b", videoOwnerUid: "b", wordsOwnerUid: "a" },
      b: { audioOwnerUid: "b", videoOwnerUid: "b", wordsOwnerUid: "a" },
    },
  }), {
    ready: true,
    agreed: true,
    audioOwnerUid: "b",
    videoOwnerUid: "b",
    wordsOwnerUid: "a",
  });
  assert.deepEqual(resolveDuoPlan({
    challengers,
    components,
    choices: {
      a: { audioOwnerUid: "b", videoOwnerUid: "", wordsOwnerUid: "b" },
      b: { audioOwnerUid: "a", videoOwnerUid: "b", wordsOwnerUid: "a" },
    },
  }), {
    ready: true,
    agreed: false,
    audioOwnerUid: "a",
    videoOwnerUid: "b",
    wordsOwnerUid: "a",
  });
});

test("one versus two scoring uses strict higher and equal is draw", async () => {
  const { resolveDuoChallengeScores } = await helpersPromise;
  const soloWin = resolveDuoChallengeScores({
    soloUid: "solo",
    challengerUids: ["a", "b"],
    scores: {
      solo: { values: { a: 8, b: 7 } },
      a: { values: { solo: 7 } },
      b: { values: { solo: 7 } },
    },
  });
  assert.equal(soloWin.soloScore, 7);
  assert.equal(soloWin.duoScore, 7.5);
  assert.equal(soloWin.winnerSide, "duo");
  assert.deepEqual(soloWin.outcomes, { solo: "loss", a: "win", b: "win" });

  const draw = resolveDuoChallengeScores({
    soloUid: "solo",
    challengerUids: ["a", "b"],
    scores: {
      solo: { values: { a: 8, b: 6 } },
      a: { values: { solo: 7 } },
      b: { values: { solo: 7 } },
    },
  });
  assert.equal(draw.soloScore, 7);
  assert.equal(draw.duoScore, 7);
  assert.equal(draw.winnerSide, null);
  assert.deepEqual(draw.outcomes, { solo: "draw", a: "draw", b: "draw" });
});

test("talk and replay require all three players", async () => {
  const { presentationReplayStatus, teamTalkStatus } = await helpersPromise;
  const members = ["solo", "a", "b"];
  assert.equal(teamTalkStatus({
    talkDecisions: { solo: "accept", a: "accept", b: "accept" },
  }, members, 100), "ready");
  assert.equal(teamTalkStatus({
    talkDecisions: { solo: "accept", a: "accept", b: "accept" },
    talkStartedAt: 50,
  }, members, 100), "active");
  assert.equal(teamTalkStatus({
    talkDecisions: { solo: "accept", a: "decline", b: "accept" },
  }, members, 100), "declined");

  assert.equal(presentationReplayStatus({ ready: { solo: true, a: true } }, members), "waiting");
  assert.equal(presentationReplayStatus({ ready: { solo: true, a: true, b: true } }, members), "ready");
  assert.equal(presentationReplayStatus({
    startedAt: 100,
    completed: { solo: true, a: true },
  }, members), "playing");
  assert.equal(presentationReplayStatus({
    startedAt: 100,
    completed: { solo: true, a: true, b: true },
  }, members), "completed");
});

test("per-peer transfer queue serializes only the same remote peer", async () => {
  const { createPerPeerTransferQueue } = await helpersPromise;
  const queue = createPerPeerTransferQueue();
  const events = [];
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = queue.enqueue("peer-a", async () => {
    events.push("a1-start");
    await gate;
    events.push("a1-end");
  });
  const second = queue.enqueue("peer-a", async () => {
    events.push("a2");
  });
  const other = queue.enqueue("peer-b", async () => {
    events.push("b1");
  });
  await other;
  assert.deepEqual(events, ["a1-start", "b1"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["a1-start", "b1", "a1-end", "a2"]);
});
