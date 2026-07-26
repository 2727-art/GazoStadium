"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const {
  get,
  ref,
  remove,
  set,
  update,
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.TEAM_DUO_RULES_TEST_PROJECT_ID || "demo-team-duo";
const runsAgainstSafeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

function legacyEligibility(uid, now) {
  return {
    uid,
    version: 1,
    eligible: true,
    tier: "oshi_jouzu",
    rating: 1234,
    serverMatches: 12,
    reason: "rating",
    issuedAt: now - 1_000,
    expiresAt: now + (60 * 60 * 1000),
  };
}

function roleplayCompatibility(uid) {
  return {
    uid,
    version: 2,
    eligible: true,
    reason: "roleplay",
  };
}

function components(overrides = {}) {
  return {
    audio: false,
    video: false,
    words: false,
    ...overrides,
  };
}

function queueEntry(uid, role, now) {
  return {
    uid,
    name: uid,
    rating: 1000,
    streak: 0,
    joinedAt: now,
    lastSeen: now,
    state: "waiting",
    protocolVersion: 2,
    variant: "oshi_jouzu_duo",
    role,
    components: components(),
  };
}

function player(uid, name, role, team, slot, media = {}) {
  return {
    uid,
    name,
    role,
    team,
    slot,
    rating: 1000,
    streak: 0,
    components: components(media),
  };
}

function roomPayload({
  now,
  soloUid,
  firstUid,
  secondUid,
  eligibilitySnapshot = null,
}) {
  return {
    protocolVersion: 2,
    variant: "oshi_jouzu_duo",
    hostUid: soloUid,
    createdAt: now,
    status: "forming",
    roster: {
      soloUid,
      challenger1Uid: firstUid,
      challenger2Uid: secondUid,
    },
    members: {
      [soloUid]: true,
      [firstUid]: true,
      [secondUid]: true,
    },
    players: {
      [soloUid]: player(soloUid, "OSHI", "oshi_jouzu", "A", 1, {
        audio: true,
        words: true,
      }),
      [firstUid]: player(firstUid, "FIRST", "challenger", "B", 1, {
        video: true,
        words: true,
      }),
      [secondUid]: player(secondUid, "SECOND", "challenger", "B", 2),
    },
    accepted: {
      [soloUid]: true,
    },
    ...(eligibilitySnapshot ? { eligibilitySnapshot } : {}),
    presentationOrder: ["solo", "duo"],
  };
}

async function createEnvironment(context) {
  assert.equal(projectId.startsWith("demo-"), true);
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());
  return environment;
}

test("team duo rules let any authenticated player choose the role while bootstrap stays atomic", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TEAM_DUO_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const soloUid = "oshi-player";
  const firstUid = "duo-first";
  const secondUid = "duo-second";
  const outsiderUid = "outsider";
  const roomId = "-teamDuoRoom123456789";
  const validLegacySnapshot = legacyEligibility(soloUid, now);
  const validRoleplaySnapshot = roleplayCompatibility(soloUid);

  const soloDatabase = environment.authenticatedContext(soloUid).database();
  const firstDatabase = environment.authenticatedContext(firstUid).database();
  const secondDatabase = environment.authenticatedContext(secondUid).database();
  const outsiderDatabase = environment.authenticatedContext(outsiderUid).database();

  await assertFails(set(
    ref(soloDatabase, `online/teamEligibility/${soloUid}`),
    validLegacySnapshot,
  ));

  await assertSucceeds(set(
    ref(soloDatabase, `online/teamQueue/${soloUid}`),
    {
      ...queueEntry(soloUid, "oshi_jouzu", now),
      rating: 100,
    },
  ));
  await assertFails(set(
    ref(soloDatabase, `online/teamQueue/${soloUid}`),
    {
      ...queueEntry(soloUid, "oshi_jouzu", now),
      eligibilitySnapshot: validRoleplaySnapshot,
    },
  ));
  await assertSucceeds(set(
    ref(firstDatabase, `online/teamQueue/${firstUid}`),
    queueEntry(firstUid, "challenger", now),
  ));
  await assertSucceeds(set(
    ref(firstDatabase, `online/teamQueue/${firstUid}`),
    queueEntry(firstUid, "oshi_jouzu", now),
  ));
  await assertSucceeds(set(
    ref(firstDatabase, `online/teamQueue/${firstUid}`),
    queueEntry(firstUid, "challenger", now),
  ));
  await assertFails(set(
    ref(secondDatabase, `online/teamQueue/${secondUid}`),
    queueEntry(secondUid, "challenger", now + 60_000),
  ));

  const validRoom = roomPayload({
    now,
    soloUid,
    firstUid,
    secondUid,
  });
  await assertFails(set(
    ref(firstDatabase, `online/teamRooms/${roomId}`),
    { ...validRoom, hostUid: firstUid },
  ));
  await assertFails(set(
    ref(soloDatabase, `online/teamRooms/${roomId}`),
    {
      ...validRoom,
      roster: {
        ...validRoom.roster,
        challenger2Uid: firstUid,
      },
    },
  ));
  await assertSucceeds(set(
    ref(soloDatabase, `online/teamRooms/${roomId}`),
    validRoom,
  ));
  await assertFails(get(ref(outsiderDatabase, `online/teamRooms/${roomId}`)));
  await assertFails(set(
    ref(soloDatabase, `online/teamRooms/${roomId}/members/${outsiderUid}`),
    true,
  ));
  await assertFails(set(
    ref(soloDatabase, `online/teamRooms/${roomId}/status`),
    "active",
  ));

  await assertSucceeds(set(
    ref(firstDatabase, `online/teamRooms/${roomId}/accepted/${firstUid}`),
    true,
  ));
  await assertSucceeds(set(
    ref(secondDatabase, `online/teamRooms/${roomId}/accepted/${secondUid}`),
    true,
  ));
  await assertSucceeds(set(
    ref(soloDatabase, `online/teamRooms/${roomId}/status`),
    "active",
  ));

  await assertSucceeds(set(
    ref(soloDatabase, "online/teamRooms/-teamDuoLegacySnapshot"),
    roomPayload({
      now,
      soloUid,
      firstUid,
      secondUid,
      eligibilitySnapshot: validLegacySnapshot,
    }),
  ));
  await assertSucceeds(set(
    ref(soloDatabase, "online/teamRooms/-teamDuoRoleplaySnapshot"),
    roomPayload({
      now,
      soloUid,
      firstUid,
      secondUid,
      eligibilitySnapshot: validRoleplaySnapshot,
    }),
  ));
  await assertFails(set(
    ref(soloDatabase, "online/teamRooms/-teamDuoWrongSnapshot"),
    roomPayload({
      now,
      soloUid,
      firstUid,
      secondUid,
      eligibilitySnapshot: roleplayCompatibility("different-player"),
    }),
  ));
});

test("team duo rules seal scores and gate the one-shot and talk state machine", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TEAM_DUO_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const now = Date.now();
  const soloUid = "oshi";
  const firstUid = "first";
  const secondUid = "second";
  const roomId = "-teamDuoFlow123456789";

  const soloDatabase = environment.authenticatedContext(soloUid).database();
  const firstDatabase = environment.authenticatedContext(firstUid).database();
  const secondDatabase = environment.authenticatedContext(secondUid).database();
  await assertSucceeds(set(
    ref(soloDatabase, `online/teamRooms/${roomId}`),
    roomPayload({
      now,
      soloUid,
      firstUid,
      secondUid,
    }),
  ));
  await assertSucceeds(set(ref(firstDatabase, `online/teamRooms/${roomId}/accepted/${firstUid}`), true));
  await assertSucceeds(set(ref(secondDatabase, `online/teamRooms/${roomId}/accepted/${secondUid}`), true));
  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/status`), "active"));

  await assertFails(set(ref(firstDatabase, `online/teamRooms/${roomId}/meshReady/${soloUid}`), true));
  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/meshReady/${soloUid}`), true));
  await assertSucceeds(set(ref(firstDatabase, `online/teamRooms/${roomId}/meshReady/${firstUid}`), true));
  await assertFails(set(ref(soloDatabase, `online/teamRooms/${roomId}/duoStartedAt`), Date.now()));
  await assertSucceeds(set(ref(secondDatabase, `online/teamRooms/${roomId}/meshReady/${secondUid}`), true));
  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/duoStartedAt`), Date.now()));

  const choice = {
    audioOwnerUid: "",
    videoOwnerUid: firstUid,
    wordsOwnerUid: firstUid,
    locked: true,
    lockedAt: Date.now(),
  };
  await assertSucceeds(set(ref(firstDatabase, `online/teamRooms/${roomId}/duoChoices/${firstUid}`), choice));
  await assertSucceeds(set(ref(secondDatabase, `online/teamRooms/${roomId}/duoChoices/${secondUid}`), choice));
  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/duoPlan`), {
    audioOwnerUid: "",
    videoOwnerUid: firstUid,
    wordsOwnerUid: firstUid,
    agreed: true,
    lockedAt: Date.now(),
  }));

  for (const [database, uid] of [
    [soloDatabase, soloUid],
    [firstDatabase, firstUid],
    [secondDatabase, secondUid],
  ]) {
    await assertSucceeds(set(ref(database, `online/teamRooms/${roomId}/assetsReady/${uid}`), true));
  }
  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/revealStartedAt`), Date.now()));
  for (const [database, uid] of [
    [soloDatabase, soloUid],
    [firstDatabase, firstUid],
    [secondDatabase, secondUid],
  ]) {
    await assertSucceeds(set(ref(database, `online/teamRooms/${roomId}/presentationCompleted/${uid}`), true));
  }
  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/scoringStartedAt`), Date.now()));

  const soloScore = {
    values: { [firstUid]: 8, [secondUid]: 6 },
    auto: false,
    lockedAt: Date.now(),
  };
  const firstScore = {
    values: { [soloUid]: 7 },
    auto: false,
    lockedAt: Date.now(),
  };
  const secondScore = {
    values: { [soloUid]: 7 },
    auto: true,
    lockedAt: Date.now(),
  };
  await assertFails(set(ref(firstDatabase, `online/teamDuoScores/${roomId}/${firstUid}`), {
    ...firstScore,
    values: { [secondUid]: 10 },
  }));
  await assertFails(set(ref(firstDatabase, `online/teamDuoScores/${roomId}/${firstUid}`), {
    ...firstScore,
    values: { [soloUid]: 7.5 },
  }));
  await assertSucceeds(set(ref(soloDatabase, `online/teamDuoScores/${roomId}/${soloUid}`), soloScore));
  await assertSucceeds(set(ref(firstDatabase, `online/teamDuoScores/${roomId}/${firstUid}`), firstScore));
  await assertSucceeds(set(ref(secondDatabase, `online/teamDuoScores/${roomId}/${secondUid}`), secondScore));
  await assertSucceeds(get(ref(firstDatabase, `online/teamDuoScores/${roomId}/${firstUid}`)));
  await assertFails(get(ref(firstDatabase, `online/teamDuoScores/${roomId}`)));

  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/scoreReady/${soloUid}`), true));
  await assertSucceeds(set(ref(firstDatabase, `online/teamRooms/${roomId}/scoreReady/${firstUid}`), true));
  await assertFails(get(ref(firstDatabase, `online/teamDuoScores/${roomId}`)));
  await assertSucceeds(set(ref(secondDatabase, `online/teamRooms/${roomId}/scoreReady/${secondUid}`), true));
  await assertSucceeds(get(ref(firstDatabase, `online/teamDuoScores/${roomId}`)));
  await assertFails(set(ref(firstDatabase, `online/teamRooms/${roomId}/rounds/2/scores/${firstUid}`), firstScore));
  await assertFails(set(ref(firstDatabase, `online/teamRooms/${roomId}/resultClaims/${firstUid}`), {
    outcome: "win",
    createdAt: Date.now(),
  }));

  await assertFails(set(ref(firstDatabase, `online/teamRooms/${roomId}/feedback/${firstUid}`), {
    point: "image",
  }));
  await assertFails(set(ref(firstDatabase, `online/teamRooms/${roomId}/feedbackReady/${secondUid}`), true));
  for (const [database, uid] of [
    [soloDatabase, soloUid],
    [firstDatabase, firstUid],
    [secondDatabase, secondUid],
  ]) {
    await assertSucceeds(set(ref(database, `online/teamRooms/${roomId}/feedbackReady/${uid}`), true));
  }
  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/talkDecisions/${soloUid}`), "accept"));
  await assertFails(set(ref(soloDatabase, `online/teamRooms/${roomId}/talkStartedAt`), Date.now()));
  await assertSucceeds(set(ref(firstDatabase, `online/teamRooms/${roomId}/talkDecisions/${firstUid}`), "accept"));
  await assertSucceeds(set(ref(secondDatabase, `online/teamRooms/${roomId}/talkDecisions/${secondUid}`), "accept"));
  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/talkStartedAt`), Date.now()));

  for (const [database, uid] of [
    [soloDatabase, soloUid],
    [firstDatabase, firstUid],
    [secondDatabase, secondUid],
  ]) {
    await assertSucceeds(set(ref(database, `online/teamRooms/${roomId}/talkReplay/solo/ready/${uid}`), true));
  }
  await assertSucceeds(set(ref(soloDatabase, `online/teamRooms/${roomId}/talkReplay/solo/startedAt`), Date.now()));
  await assertSucceeds(set(ref(firstDatabase, `online/teamRooms/${roomId}/talkReplay/solo/completed/${firstUid}`), true));
  await assertFails(remove(ref(firstDatabase, `online/teamRooms/${roomId}/talkReplay/solo/completed/${firstUid}`)));

  const playingPath = `online/teamRooms/${roomId}/referenceVideoPlay/${soloUid}/playing/${firstUid}`;
  const successPath = `online/teamRooms/${roomId}/referenceVideoPlay/${soloUid}/success/${firstUid}`;
  await assertSucceeds(set(ref(firstDatabase, playingPath), true));
  await assertSucceeds(set(ref(firstDatabase, successPath), true));
  await assertFails(remove(ref(firstDatabase, successPath)));
  await assertFails(remove(ref(firstDatabase, playingPath)));

  const retryPlayingPath = `online/teamRooms/${roomId}/referenceVideoPlay/${firstUid}/playing/${secondUid}`;
  await assertSucceeds(set(ref(secondDatabase, retryPlayingPath), true));
  await assertSucceeds(remove(ref(secondDatabase, retryPlayingPath)));
});

test("legacy protocol-less team room creation remains available", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* TEAM_DUO_RULES_TEST_PROJECT_ID",
}, async (context) => {
  const environment = await createEnvironment(context);
  const hostUid = "legacy-host";
  const roomId = "-legacyTeamRoom1234567";
  const hostDatabase = environment.authenticatedContext(hostUid).database();

  await assertSucceeds(set(ref(hostDatabase, `online/teamRooms/${roomId}/hostUid`), hostUid));
  await assertSucceeds(set(ref(hostDatabase, `online/teamRooms/${roomId}/createdAt`), Date.now()));
  await assertSucceeds(set(ref(hostDatabase, `online/teamRooms/${roomId}/status`), "forming"));
  await assertSucceeds(update(ref(hostDatabase, `online/teamRooms/${roomId}`), {
    [`members/${hostUid}`]: true,
    [`players/${hostUid}`]: {
      uid: hostUid,
      name: "LEGACY",
      team: "A",
      slot: 1,
      rating: 1000,
      streak: 0,
    },
  }));
});
