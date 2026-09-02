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
  ref,
  set,
  update,
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.STRATEGY_ROUND3_RULES_TEST_PROJECT_ID
  || "demo-strategy-round3-secret-choice";
const safeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

const hostUid = "round3-host";
const guestUid = "round3-guest";
const otherUid = "round3-outsider";

function commit(digestCharacter, now) {
  return {
    digest: digestCharacter.repeat(64),
    round: 3,
    lockedAt: now,
  };
}

function choice(kind, guessIndex, saltCharacter, now) {
  return {
    choice: kind,
    guessIndex,
    round: 3,
    salt: saltCharacter.repeat(32),
    revealedAt: now,
  };
}

function actualWeakness(weaknessIndex, saltCharacter, now) {
  return {
    weaknessIndex,
    salt: saltCharacter.repeat(32),
    revealedAt: now,
  };
}

function chain(count, now) {
  return {
    ready: true,
    count,
    lockedAt: now,
  };
}

test("strategy round 3 secret-choice rules enforce ownership, reveal order, and compatibility", {
  skip: safeEmulator
    ? false
    : "run inside a loopback Database Emulator with a demo-* project",
}, async (context) => {
  assert.equal(projectId.startsWith("demo-"), true);
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());

  const hostDatabase = environment.authenticatedContext(hostUid).database();
  const guestDatabase = environment.authenticatedContext(guestUid).database();
  const otherDatabase = environment.authenticatedContext(otherUid).database();

  async function seedRoundThreeRoom(roomId, { protocolVersion = 2, roundThreeContinued = true } = {}) {
    const now = Date.now();
    const room = {
      status: "active",
      hostUid,
      guestUid,
      members: {
        [hostUid]: true,
        [guestUid]: true,
      },
      deckReady: {
        [hostUid]: { reserveCount: 5 },
        [guestUid]: { reserveCount: 5 },
      },
      battleReady: {
        [hostUid]: true,
        [guestUid]: true,
      },
      rounds: {
        3: {
          basePicks: {
            [hostUid]: { ready: true },
            [guestUid]: { ready: true },
          },
          ratings: {
            [hostUid]: { score: 5 },
            [guestUid]: { score: 5 },
          },
          actionPicks: {
            [hostUid]: { skipped: true },
            [guestUid]: { skipped: true },
          },
        },
      },
    };
    if (roundThreeContinued) {
      room.rounds[3].continue = {
        [hostUid]: true,
        [guestUid]: true,
      };
    }
    if (protocolVersion !== null) room.protocolVersion = protocolVersion;

    await environment.withSecurityRulesDisabled(async (adminContext) => {
      await set(ref(adminContext.database(), `online/strategyRooms/${roomId}`), room);
    });
    return now;
  }

  async function seedSecretChoices(roomId, hostChoice, guestChoice, now) {
    await environment.withSecurityRulesDisabled(async (adminContext) => {
      const database = adminContext.database();
      await set(ref(database, `online/strategyRooms/${roomId}/weaknessChoiceCommits`), {
        [hostUid]: commit("a", now),
        [guestUid]: commit("b", now),
      });
      await set(ref(database, `online/strategyRooms/${roomId}/weaknessChoices`), {
        [hostUid]: hostChoice,
        [guestUid]: guestChoice,
      });
    });
  }

  await context.test("round 3 commits wait for both players to continue", async () => {
    const roomId = "round3-continue-gate";
    const now = await seedRoundThreeRoom(roomId, { roundThreeContinued: false });
    const hostCommitRef = ref(
      hostDatabase,
      `online/strategyRooms/${roomId}/weaknessChoiceCommits/${hostUid}`,
    );

    await assertFails(set(hostCommitRef, commit("a", now)));
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/rounds/3/continue/${hostUid}`),
      true,
    ));
    await assertFails(set(hostCommitRef, commit("a", now)));
    await assertSucceeds(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/rounds/3/continue/${guestUid}`),
      true,
    ));
    await assertSucceeds(set(hostCommitRef, commit("a", now)));
  });

  await context.test("commit and choice reveal are owner-only, write-once, and ordered", async () => {
    const roomId = "round3-commit-gates";
    const now = await seedRoundThreeRoom(roomId);
    const hostCommitRef = ref(
      hostDatabase,
      `online/strategyRooms/${roomId}/weaknessChoiceCommits/${hostUid}`,
    );

    await assertFails(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessChoiceCommits/${hostUid}`),
      commit("c", now),
    ));
    await assertFails(set(
      ref(otherDatabase, `online/strategyRooms/${roomId}/weaknessChoiceCommits/${otherUid}`),
      commit("d", now),
    ));
    await assertSucceeds(set(hostCommitRef, commit("a", now)));
    await assertFails(set(hostCommitRef, commit("e", now + 1)));

    await assertFails(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessChoices/${hostUid}`),
      choice("guess", 1, "1", now),
    ));

    await assertSucceeds(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessChoiceCommits/${guestUid}`),
      commit("b", now),
    ));
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessChoices/${hostUid}`),
      choice("guess", 1, "1", now),
    ));
    await assertFails(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessChoices/${guestUid}`),
      choice("pass", 0, "2", now),
    ));
    await assertSucceeds(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessChoices/${guestUid}`),
      choice("pass", -1, "2", now),
    ));
  });

  await context.test("version 2 blocks the legacy round 3 weakness guess path", async () => {
    const roomId = "round3-v2-legacy-block";
    const now = await seedRoundThreeRoom(roomId);

    await assertFails(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessGuesses/${hostUid}`),
      { guessIndex: 1, round: 3, lockedAt: now },
    ));
  });

  await context.test("version 2 keeps early-round guesses and positive correct chains", async () => {
    const roomId = "round2-v2-early-guess";
    const now = await seedRoundThreeRoom(roomId);
    await environment.withSecurityRulesDisabled(async (adminContext) => {
      await set(ref(adminContext.database(), `online/strategyRooms/${roomId}/rounds/3`), null);
      await set(ref(adminContext.database(), `online/strategyRooms/${roomId}/rounds/2`), {
        ratings: {
          [hostUid]: { score: 5 },
          [guestUid]: { score: 5 },
        },
        actionPicks: {
          [hostUid]: { skipped: true },
          [guestUid]: { skipped: true },
        },
      });
    });

    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessGuesses/${hostUid}`),
      { guessIndex: 1, round: 2, lockedAt: now },
    ));
    await assertSucceeds(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessGuesses/${guestUid}`),
      { guessIndex: 2, round: 2, lockedAt: now },
    ));
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessReveals/${hostUid}`),
      actualWeakness(2, "3", now),
    ));
    await assertSucceeds(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessReveals/${guestUid}`),
      actualWeakness(1, "4", now),
    ));
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessChains/${hostUid}`),
      chain(1, now),
    ));
    await assertSucceeds(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessChains/${guestUid}`),
      chain(1, now),
    ));
  });

  await context.test("version 2 blocks retroactive early guesses after the next round starts", async () => {
    const roomId = "round2-v2-retroactive-block";
    const now = await seedRoundThreeRoom(roomId);
    await environment.withSecurityRulesDisabled(async (adminContext) => {
      await set(ref(adminContext.database(), `online/strategyRooms/${roomId}/rounds/2`), {
        ratings: {
          [hostUid]: { score: 5 },
          [guestUid]: { score: 5 },
        },
        actionPicks: {
          [hostUid]: { skipped: true },
          [guestUid]: { skipped: true },
        },
        continue: {
          [hostUid]: true,
          [guestUid]: true,
        },
      });
    });

    await assertFails(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessGuesses/${hostUid}`),
      { guessIndex: 1, round: 2, lockedAt: now },
    ));
  });

  await context.test("legacy early guesses and round 3 secret commitments cannot mix", async () => {
    const roomId = "round2-v2-exclusive-paths";
    const now = await seedRoundThreeRoom(roomId, { roundThreeContinued: false });
    await environment.withSecurityRulesDisabled(async (adminContext) => {
      const database = adminContext.database();
      await set(ref(database, `online/strategyRooms/${roomId}/rounds/3`), null);
      await set(ref(database, `online/strategyRooms/${roomId}/rounds/2`), {
        ratings: {
          [hostUid]: { score: 5 },
          [guestUid]: { score: 5 },
        },
        actionPicks: {
          [hostUid]: { skipped: true },
          [guestUid]: { skipped: true },
        },
      });
    });
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessGuesses/${hostUid}`),
      { guessIndex: 1, round: 2, lockedAt: now },
    ));
    await environment.withSecurityRulesDisabled(async (adminContext) => {
      await set(ref(adminContext.database(), `online/strategyRooms/${roomId}/rounds/3`), {
        ratings: {
          [hostUid]: { score: 5 },
          [guestUid]: { score: 5 },
        },
        actionPicks: {
          [hostUid]: { skipped: true },
          [guestUid]: { skipped: true },
        },
        continue: {
          [hostUid]: true,
          [guestUid]: true,
        },
      });
    });
    await assertFails(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessChoiceCommits/${guestUid}`),
      commit("b", now),
    ));
  });

  await context.test("only the guessed player's actual weakness is revealed before chains", async () => {
    const roomId = "round3-guess-pass-target";
    const now = await seedRoundThreeRoom(roomId);
    await seedSecretChoices(
      roomId,
      choice("guess", 1, "1", now),
      choice("pass", -1, "2", now),
      now,
    );

    await assertFails(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessReveals/${hostUid}`),
      actualWeakness(2, "3", now),
    ));
    await assertSucceeds(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessReveals/${guestUid}`),
      actualWeakness(1, "4", now),
    ));

    await assertFails(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessChains/${guestUid}`),
      chain(1, now),
    ));
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessChains/${hostUid}`),
      chain(1, now),
    ));
    await assertSucceeds(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessChains/${guestUid}`),
      chain(0, now),
    ));
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessReveals/${hostUid}`),
      actualWeakness(2, "3", now),
    ));
  });

  await context.test("a positive chain requires a correct guess", async () => {
    const roomId = "round3-wrong-guess-chain";
    const now = await seedRoundThreeRoom(roomId);
    await seedSecretChoices(
      roomId,
      choice("guess", 0, "1", now),
      choice("pass", -1, "2", now),
      now,
    );
    await environment.withSecurityRulesDisabled(async (adminContext) => {
      await set(
        ref(
          adminContext.database(),
          `online/strategyRooms/${roomId}/weaknessReveals/${guestUid}`,
        ),
        actualWeakness(1, "4", now),
      );
    });

    await assertFails(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessChains/${hostUid}`),
      chain(1, now),
    ));
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessChains/${hostUid}`),
      chain(0, now),
    ));
  });

  await context.test("pass/pass withholds actual weaknesses until both zero chains exist", async () => {
    const roomId = "round3-pass-pass-final-reveal";
    const now = await seedRoundThreeRoom(roomId);
    await seedSecretChoices(
      roomId,
      choice("pass", -1, "1", now),
      choice("pass", -1, "2", now),
      now,
    );
    const hostRevealRef = ref(
      hostDatabase,
      `online/strategyRooms/${roomId}/weaknessReveals/${hostUid}`,
    );
    const guestRevealRef = ref(
      guestDatabase,
      `online/strategyRooms/${roomId}/weaknessReveals/${guestUid}`,
    );

    await assertFails(set(hostRevealRef, actualWeakness(0, "3", now)));
    await assertFails(set(guestRevealRef, actualWeakness(2, "4", now)));
    await assertFails(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessChains/${hostUid}`),
      chain(1, now),
    ));
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessChains/${hostUid}`),
      chain(0, now),
    ));
    await assertSucceeds(set(
      ref(guestDatabase, `online/strategyRooms/${roomId}/weaknessChains/${guestUid}`),
      chain(0, now),
    ));
    await assertSucceeds(set(hostRevealRef, actualWeakness(0, "3", now)));
    await assertSucceeds(set(guestRevealRef, actualWeakness(2, "4", now)));
  });

  await context.test("room destruction blocks later phase writes and cannot coexist with a final result", async () => {
    const destroyedRoomId = "round3-destroyed-terminal";
    const now = await seedRoundThreeRoom(destroyedRoomId);
    await assertFails(update(
      ref(hostDatabase, `online/strategyRooms/${destroyedRoomId}`),
      {
        destroyed: { by: hostUid, at: now },
        [`weaknessChoiceCommits/${hostUid}`]: commit("a", now),
      },
    ));
    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${destroyedRoomId}/destroyed`),
      { by: hostUid, at: now },
    ));
    await assertFails(set(
      ref(hostDatabase, `online/strategyRooms/${destroyedRoomId}/weaknessChoiceCommits/${hostUid}`),
      commit("a", now),
    ));
    await assertFails(update(
      ref(hostDatabase, `online/strategyRooms/${destroyedRoomId}`),
      {
        [`resultClaims/${hostUid}`]: { outcome: "draw", createdAt: now },
        [`finished/${hostUid}`]: true,
      },
    ));

    const finishedRoomId = "round3-finished-terminal";
    const finishedAt = await seedRoundThreeRoom(finishedRoomId);
    const roomRef = ref(hostDatabase, `online/strategyRooms/${finishedRoomId}`);
    const resultPatch = {
      [`resultClaims/${hostUid}`]: { outcome: "draw", createdAt: finishedAt },
      [`finished/${hostUid}`]: true,
    };
    await assertFails(update(roomRef, resultPatch));
    await environment.withSecurityRulesDisabled(async (adminContext) => {
      await set(ref(adminContext.database(), `online/strategyRooms/${finishedRoomId}/weaknessReveals`), {
        [hostUid]: actualWeakness(0, "3", finishedAt),
        [guestUid]: actualWeakness(2, "4", finishedAt),
      });
    });
    await assertFails(set(
      ref(hostDatabase, `online/strategyRooms/${finishedRoomId}/resultClaims/${hostUid}`),
      { outcome: "draw", createdAt: finishedAt },
    ));
    await assertSucceeds(update(roomRef, resultPatch));
    await assertFails(set(
      ref(hostDatabase, `online/strategyRooms/${finishedRoomId}/destroyed`),
      { by: hostUid, at: finishedAt },
    ));
  });

  await context.test("legacy rooms still accept round 3 weakness guesses", async () => {
    const roomId = "round3-legacy-compatible";
    const now = await seedRoundThreeRoom(roomId, { protocolVersion: null });

    await assertSucceeds(set(
      ref(hostDatabase, `online/strategyRooms/${roomId}/weaknessGuesses/${hostUid}`),
      { guessIndex: 2, round: 3, lockedAt: now },
    ));
  });
});
