"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const online = JSON.parse(
  fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
).rules.online;

test("retired training matchmaking namespaces deny client access", () => {
  for (const pathParts of [
    ["trainingSessionClaims"],
    ["trainingQueueV4"],
    ["trainingActiveV4"],
    ["trainingOffersV4"],
    ["trainingQueue"],
    ["trainingActive"],
    ["trainingMatchLock"],
    ["trainingInvites"],
  ]) {
    const node = pathParts.reduce((value, part) => value[part], online);
    assert.equal(node[".read"], false, `${pathParts.join("/")} read`);
    assert.equal(node[".write"], false, `${pathParts.join("/")} write`);
  }

  assert.deepEqual(online.trainingRoomCleanupCursor, {
    ".read": false,
    ".write": false,
  });
  assert.deepEqual(online.trainingActiveCleanupCursor, {
    ".read": false,
    ".write": false,
  });
  assert.deepEqual(online.trainingActiveCleanupGuards, {
    ".read": false,
    ".write": false,
  });
});

test("training v3 HP rounds keep draws owner-scoped, scores secret, and workouts canonical", () => {
  const room = online.trainingRooms.$roomId;
  const round = room.rounds.$round;
  const draw = round.draws.$uid;
  const score = round.scores.$scorerUid;
  const choice = round.commandChoices.$traineeUid;
  const workout = round.workouts.$traineeUid;

  assert.match(room[".validate"], /sessionProtocolVersion'\)\.val\(\) === 5/);
  assert.match(room[".validate"], /signalingVersion'\)\.val\(\) === 5/);
  assert.match(room[".validate"], /trainingAttemptsV5/);
  assert.match(room[".validate"], /roomAttemptId/);
  assert.match(room[".validate"], /transportEpoch/);

  assert.match(round[".write"], /protocolVersion'\)\.val\(\) === 3/);
  assert.match(round[".write"], /auth\.uid === root\.child\('online\/trainingRooms\/' \+ \$roomId \+ '\/hostUid'\)\.val\(\)/);
  assert.match(round[".write"], /\$round === '1'/);
  assert.match(round[".write"], /\$round === '5'/);
  assert.match(round[".write"], /scores\//);
  assert.match(round[".write"], /<= 7 \? 0/);
  assert.match(round[".write"], /< 30/);
  assert.match(round[".write"], /!newData\.child\('draws'\)\.exists\(\)/);
  assert.match(round.createdAt[".validate"], /parent\(\)\.parent\(\)\.child\('4\/completedAt'\)/);

  assert.match(draw[".write"], /auth\.uid === \$uid/);
  assert.match(draw[".write"], /!data\.exists\(\)/);
  assert.match(draw[".validate"], /rounds\/4\/draws/);
  assert.match(draw.imageIndex[".validate"], /newData\.val\(\) <= 5/);
  assert.match(draw.bpm[".validate"], /imageBpms/);
  assert.match(draw.drawnAt[".validate"], /now - 15000/);
  assert.equal(draw.$other[".validate"], false);

  assert.match(round.imageReceived.$recipientUid[".write"], /auth\.uid === \$recipientUid/);
  assert.match(round.imageReceived.$recipientUid[".write"], /draws/);
  assert.match(round.scores[".read"], /hostUid/);
  assert.match(round.scores[".read"], /guestUid/);
  assert.match(score[".read"], /auth\.uid === \$scorerUid/);
  assert.match(score[".write"], /imageReceived/);
  assert.match(score[".validate"], /newData\.val\(\) >= 1/);
  assert.match(score[".validate"], /newData\.val\(\) <= 10/);

  assert.match(choice[".write"], /trainerUid'\)\.val\(\) === auth\.uid/);
  assert.match(choice[".write"], /scores/);
  assert.match(choice[".validate"], /rounds\/4\/commandChoices/);
  assert.match(choice.cardIndex[".validate"], /newData\.val\(\) <= 3/);
  assert.match(choice.selectedAt[".validate"], /now \+ 15000/);
  assert.equal(choice.$other[".validate"], false);

  assert.match(workout[".write"], /auth\.uid === \$traineeUid/);
  assert.match(workout[".write"], /commandChoices/);
  assert.match(workout.completedAt[".write"], /!data\.exists\(\)/);
  assert.match(workout.completedAt[".validate"], /\+ 60000/);
  assert.match(workout.completedAt[".validate"], /\+ 75000/);
  assert.match(workout.completedAt[".validate"], /\+ 90000/);
  assert.match(workout.completedAt[".validate"], /<= now/);
  assert.equal(workout.$other[".validate"], false);

  assert.match(round.completedAt[".write"], /workouts/);
  assert.match(round.completedAt[".write"], /auth\.uid === root\.child\('online\/trainingRooms\/' \+ \$roomId \+ '\/hostUid'\)\.val\(\)/);
  assert.match(round.completedAt[".validate"], /now - 15000/);
  assert.equal(round.$other[".validate"], false);
  assert.match(room.surrendered[".write"], /protocolVersion'\)\.val\(\) === 3/);
  assert.match(room.surrendered[".write"], /newData\.child\('uid'\)\.val\(\) === auth\.uid/);
  assert.equal(room.surrendered.$other[".validate"], false);
});

test("training is public-presence eligible but remains outside RATE", () => {
  const presence = online.publicPresence.$sessionId;
  const daily = online.economy.$uid.daily;

  assert.match(presence[".validate"], /training/);
  assert.match(presence.mode[".validate"], /training/);
  assert.doesNotMatch(presence[".validate"], /team/);
  assert.doesNotMatch(presence.mode[".validate"], /team/);
  assert.equal(daily.trainingSets[".validate"].includes("<= 3"), true);
  assert.match(daily.trainingSeconds[".validate"], /<= 86400/);
  assert.match(daily.trainingMatches[".validate"], /<= 1/);
  assert.match(daily.claimed.$missionId[".validate"], /play_training/);

  assert.equal(Object.hasOwn(online.overallProfiles.$uid.modes, "training"), false);
  assert.doesNotMatch(
    online.overallProfiles.$uid.modes.$mode[".validate"],
    /\$mode === 'training'/,
  );
});
