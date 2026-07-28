"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const online = JSON.parse(
  fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
).rules.online;

test("training matchmaking is owner-scoped and protocol-fenced", () => {
  const queue = online.trainingQueue;
  const queueEntry = queue.$uid;
  const lock = online.trainingMatchLock;
  const invite = online.trainingInvites.$targetUid.$roomId;

  assert.equal(queue[".read"], "auth != null");
  assert.match(queueEntry[".write"], /auth\.uid === \$uid/);
  assert.match(queueEntry[".write"], /data\.child\('sessionId'\)\.val\(\) === newData\.child\('sessionId'\)\.val\(\)/);
  assert.match(queueEntry[".write"], /data\.child\('lastSeen'\)\.val\(\) <= now - 60000/);
  assert.doesNotMatch(queueEntry[".validate"], /conditions/);
  assert.match(queueEntry[".validate"], /'sessionId'/);
  assert.equal(Object.hasOwn(queueEntry, "conditions"), false);
  assert.match(queueEntry.sessionId[".validate"], /length <= 64/);
  assert.match(queueEntry.protocolVersion[".validate"], /newData\.val\(\) === 2/);
  assert.match(queueEntry.protocolVersion[".validate"], /newData\.val\(\) === 3/);
  assert.match(queueEntry.variant[".validate"], /kitaeai_60_v2/);
  assert.match(queueEntry.variant[".validate"], /kitaeai_hp_v3/);
  assert.match(queueEntry[".validate"], /commandDeck/);
  assert.match(queueEntry[".validate"], /imageBpms/);
  assert.match(queueEntry.commandDeck[".validate"], /protocolVersion/);
  assert.match(queueEntry.commandDeck.$card[".validate"], /\$card === '1'/);
  assert.match(queueEntry.commandDeck.$card[".validate"], /\$card === '3'/);
  assert.match(queueEntry.commandDeck.$card.beatsPerRep[".validate"], /=== 8/);
  assert.equal(queueEntry.commandDeck.$card.$other[".validate"], false);
  assert.match(queueEntry.imageBpms.$image[".validate"], /newData\.val\(\) === 0/);
  assert.match(queueEntry.imageBpms.$image[".validate"], /newData\.val\(\) >= 40/);
  assert.match(queueEntry.imageBpms.$image[".validate"], /newData\.val\(\) <= 160/);
  assert.match(queueEntry.intensity[".validate"], /light/);
  assert.match(queueEntry.intensity[".validate"], /standard/);
  assert.match(queueEntry.intensity[".validate"], /strong/);
  assert.equal(queueEntry.$other[".validate"], false);

  const active = online.trainingActive.$uid;
  assert.match(active[".read"], /auth\.uid === \$uid/);
  assert.match(active[".write"], /auth\.uid === \$uid/);
  assert.match(active[".write"], /!newData\.exists\(\) && !data\.child\('rooms'\)\.exists\(\)/);
  assert.match(active[".write"], /newData\.child\('rooms\/' \+ newData\.child\('roomId'\)\.val\(\)\)\.val\(\) === true/);
  assert.match(active[".validate"], /newData\.child\('roomId'\)\.isString\(\)/);
  assert.match(active[".validate"], /newData\.child\('rooms'\)\.exists\(\)/);
  assert.match(
    active.roomId[".write"],
    /auth\.uid === \$uid/,
  );
  assert.match(
    active.roomId[".write"],
    /!root\.child\('online\/trainingActive\/' \+ \$uid \+ '\/rooms'\)\.exists\(\)/,
  );
  assert.match(
    active.rooms.$roomId[".write"],
    /auth\.uid === \$uid/,
  );
  assert.match(
    active.rooms.$roomId[".write"],
    /!data\.exists\(\) && newData\.val\(\) === true/,
  );
  assert.match(
    active.rooms.$roomId[".write"],
    /data\.val\(\) === true && !newData\.exists\(\)/,
  );
  assert.match(
    active.rooms.$roomId[".validate"],
    /newData\.val\(\) === true/,
  );
  assert.match(
    active.rooms.$roomId[".validate"],
    /\$roomId === newData\.parent\(\)\.parent\(\)\.child\('roomId'\)\.val\(\)/,
  );
  assert.equal(active.$other[".validate"], false);
  assert.match(lock[".write"], /expiresAt/);
  assert.match(lock.expiresAt[".validate"], /now \+ 60000/);
  assert.equal(lock.$other[".validate"], false);

  assert.match(online.trainingInvites.$targetUid[".read"], /auth\.uid === \$targetUid/);
  assert.match(invite[".write"], /auth\.uid === \$targetUid/);
  assert.match(invite[".write"], /trainingRooms/);
  assert.match(invite[".write"], /guestUid/);
  assert.match(invite[".validate"], /createdAt/);
  assert.match(invite[".validate"], /targetSessionId/);
  assert.match(invite[".write"], /trainingQueue/);
  assert.match(invite[".write"], /targetSessionId/);
  assert.match(
    invite[".write"],
    /!root\.child\('online\/trainingInvites\/' \+ \$targetUid\)\.exists\(\)/,
  );
  assert.match(
    invite[".write"],
    /trainingQueue\/' \+ auth\.uid \+ '\/state'\)\.val\(\) === 'forming'/,
  );
  assert.match(
    invite[".write"],
    /trainingQueue\/' \+ \$targetUid \+ '\/state'\)\.val\(\) === 'waiting'/,
  );
  assert.match(
    invite[".write"],
    /trainingMatchLock\/uid'\)\.val\(\) === auth\.uid/,
  );
  assert.match(
    invite[".write"],
    /trainingMatchLock\/roomId'\)\.val\(\) === \$roomId/,
  );
  assert.match(
    invite[".write"],
    /trainingMatchLock\/expiresAt'\)\.val\(\) > now/,
  );
  assert.match(invite[".validate"], /protocolVersion/);
  assert.match(invite[".validate"], /variant/);
  assert.match(invite.protocolVersion[".validate"], /newData\.val\(\) === 2/);
  assert.match(invite.protocolVersion[".validate"], /newData\.val\(\) === 3/);
  assert.match(invite.variant[".validate"], /kitaeai_60_v2/);
  assert.match(invite.variant[".validate"], /kitaeai_hp_v3/);
  assert.match(invite.targetSessionId[".validate"], /length <= 64/);
  assert.equal(invite.$other[".validate"], false);
  assert.deepEqual(online.trainingRoomCleanupCursor, {
    ".read": false,
    ".write": false,
  });
});

test("training room bootstrap fixes both identities and keeps signals target-private", () => {
  const room = online.trainingRooms.$roomId;
  const signalTarget = room.signals.$targetUid;
  const signal = signalTarget.$signalId;

  assert.deepEqual(online.trainingRooms[".indexOn"], ["createdAt"]);
  assert.equal(room[".read"], false);
  assert.match(room[".write"], /!newData\.child\('turns'\)\.exists\(\)/);
  assert.match(room[".write"], /trainingQueue/);
  assert.match(room[".write"], /protocolVersion'\)\.val\(\) === 2/);
  assert.match(room[".write"], /variant'\)\.val\(\) === 'kitaeai_60_v2'/);
  assert.match(room[".write"], /protocolVersion'\)\.val\(\) === 3/);
  assert.match(room[".write"], /variant'\)\.val\(\) === 'kitaeai_hp_v3'/);
  assert.match(room[".write"], /!newData\.child\('carrotChoices'\)\.exists\(\)/);
  assert.match(room[".write"], /!newData\.child\('rounds'\)\.exists\(\)/);
  assert.match(room[".write"], /!newData\.child\('surrendered'\)\.exists\(\)/);
  assert.match(room[".write"], /members\//);
  assert.match(room[".write"], /players\//);
  assert.match(
    room[".write"],
    /trainingActive\/' \+ auth\.uid \+ '\/roomId'\)\.val\(\) === \$roomId/,
  );
  assert.match(
    room[".write"],
    /trainingActive\/' \+ auth\.uid \+ '\/rooms\/' \+ \$roomId\)\.val\(\) === true/,
  );
  assert.match(
    room[".write"],
    /!root\.child\('online\/trainingActive\/' \+ newData\.child\('guestUid'\)\.val\(\) \+ '\/rooms'\)\.exists\(\)/,
  );
  assert.match(
    room[".write"],
    /!root\.child\('online\/trainingInvites\/' \+ auth\.uid\)\.exists\(\)/,
  );
  assert.match(
    room[".write"],
    /!root\.child\('online\/trainingInvites\/' \+ newData\.child\('guestUid'\)\.val\(\)\)\.exists\(\)/,
  );
  assert.match(
    room[".write"],
    /trainingMatchLock\/uid'\)\.val\(\) === auth\.uid/,
  );
  assert.match(
    room[".write"],
    /trainingMatchLock\/roomId'\)\.val\(\) === \$roomId/,
  );
  assert.match(
    room[".write"],
    /trainingMatchLock\/expiresAt'\)\.val\(\) > now/,
  );
  assert.match(room[".write"], /\/conditions'\)\.val\(\) === ''/);
  assert.match(room[".write"], /!newData\.child\('accepted\/'/);

  for (const immutable of [
    "protocolVersion",
    "variant",
    "hostUid",
    "guestUid",
    "createdAt",
    "firstTrainerUid",
    "members",
    "players",
  ]) {
    assert.equal(room[immutable][".write"], false, immutable);
    assert.match(room[immutable][".read"], /members/);
  }

  assert.match(room.status[".write"], /data\.val\(\) === 'forming'/);
  assert.match(room.status[".write"], /newData\.val\(\) === 'active'/);
  assert.match(room.status[".write"], /newData\.val\(\) === 'expired'/);
  assert.match(room.status[".write"], /accepted/);
  assert.match(room.status[".validate"], /expired/);
  assert.match(room.accepted.$uid[".write"], /auth\.uid === \$uid/);
  assert.match(room.accepted.$uid[".write"], /!data\.exists\(\)/);
  assert.match(room.accepted.$uid[".write"], /trainingActive/);
  assert.match(room.accepted.$uid[".write"], /targetSessionId/);
  assert.match(room.players.$uid[".validate"], /!data\.exists\(\)/);
  assert.match(room.players.$uid[".validate"], /data\.exists\(\)/);
  assert.match(
    room.players.$uid.conditions[".write"],
    /auth\.uid === \$uid/,
  );
  assert.match(
    room.players.$uid.conditions[".write"],
    /guestUid/,
  );
  assert.match(
    room.players.$uid.conditions[".write"],
    /status'\)\.val\(\) === 'forming'/,
  );
  assert.match(
    room.players.$uid.conditions[".write"],
    /!root\.child\('online\/trainingRooms\/' \+ \$roomId \+ '\/accepted\//,
  );
  assert.match(room.players.$uid.conditions[".write"], /data\.val\(\) === ''/);
  assert.match(room.players.$uid.conditions[".write"], /trainingActive/);
  assert.match(room.players.$uid.conditions[".write"], /targetSessionId/);
  assert.doesNotMatch(
    room.players.$uid.conditions[".write"],
    /newData\.val\(\)\.length > 0/,
  );

  assert.match(signalTarget[".read"], /auth\.uid === \$targetUid/);
  assert.match(signal[".write"], /auth\.uid !== \$targetUid/);
  assert.match(signal[".write"], /auth\.uid === \$targetUid/);
  assert.match(signal[".write"], /!newData\.exists\(\)/);
  assert.match(signal[".validate"], /createdAt/);
  assert.equal(signal.$other[".validate"], false);
});

test("training turns can only be authored and resolved by the assigned roles", () => {
  const room = online.trainingRooms.$roomId;
  const turn = room.turns.$turn;
  const instruction = turn.instruction;

  assert.match(turn[".write"], /newData\.child\('trainerUid'\)\.val\(\) === auth\.uid/);
  assert.match(turn[".write"], /!newData\.child\('startedAt'\)\.exists\(\)/);
  assert.match(turn[".write"], /firstTrainerUid/);
  assert.match(turn[".write"], /turns\/1\/completedAt/);
  assert.match(turn[".write"], /turns\/1\/completedAt/);
  assert.match(turn[".write"], /continueVotes\/1/);
  assert.match(turn[".write"], /continueVotes\/2/);
  assert.match(turn[".write"], /imageReceived/);
  assert.match(turn[".write"], /hostUid/);
  assert.match(turn[".write"], /guestUid/);
  assert.match(turn[".write"], /carrotChoices/);
  assert.match(turn[".write"], /targetDurationMs/);
  assert.match(turn[".write"], /imageOwnerUid/);
  assert.match(turn[".validate"], /\$turn === '1'/);
  assert.match(turn[".validate"], /\$turn === '6'/);
  assert.match(turn[".validate"], /completedAt/);
  assert.match(turn[".validate"], /surrenderedAt/);
  assert.match(turn[".validate"], /timedOutAt/);
  assert.match(turn.createdAt[".validate"], /turns\/1\/completedAt/);
  assert.match(turn.createdAt[".validate"], /turns\/5\/completedAt/);

  assert.match(instruction.exercise[".validate"], /length <= 40/);
  assert.match(instruction.completion[".validate"], /length <= 60/);
  assert.match(instruction.command[".validate"], /length <= 120/);
  assert.match(instruction.bpm[".validate"], /newData\.val\(\) === 0/);
  assert.match(instruction.bpm[".validate"], /newData\.val\(\) >= 40/);
  assert.match(instruction.bpm[".validate"], /newData\.val\(\) <= 160/);
  assert.match(instruction.beatsPerRep[".validate"], /newData\.val\(\) === 4/);

  for (const field of ["startedAt", "completedAt", "surrenderedAt"]) {
    assert.match(turn[field][".write"], /traineeUid/);
    assert.match(turn[field][".write"], /!data\.exists\(\)/);
  }
  assert.match(turn.completedAt[".validate"], /\+ 60000/);
  assert.match(turn.completedAt[".validate"], /targetDurationMs/);
  assert.match(turn.baseCompletedAt[".validate"], /=== newData\.parent\(\)\.child\('startedAt'\)\.val\(\) \+ 60000/);
  assert.match(turn.baseCompletedAt[".validate"], /<= now/);
  assert.match(turn.boostCompletedAt[".validate"], /targetDurationMs/);
  assert.match(turn.boostCompletedAt[".validate"], /<= now/);
  assert.match(turn.surrenderedAt[".validate"], /\+ 60000/);
  assert.doesNotMatch(turn.completedAt[".validate"], /\+ 65000/);
  assert.doesNotMatch(turn.surrenderedAt[".validate"], /\+ 65000/);
  assert.match(turn.timedOutAt[".write"], /members/);
  assert.match(turn.timedOutAt[".validate"], /\+ 60000/);
  assert.doesNotMatch(turn.timedOutAt[".validate"], /\+ 90000/);

  assert.match(room.imageReceived.$uid[".write"], /auth\.uid === \$uid/);
  assert.match(room.carrotChoices[".read"], /hostUid/);
  assert.match(room.carrotChoices[".read"], /guestUid/);
  assert.match(room.carrotChoices.$uid[".read"], /auth\.uid === \$uid/);
  assert.match(room.carrotChoices.$uid[".write"], /!data\.exists\(\)/);
  assert.match(room.carrotChoices.$uid[".write"], /!root\.child\('online\/trainingRooms\/' \+ \$roomId \+ '\/turns'\)\.exists\(\)/);
  assert.match(room.continueVotes.$pair.$uid[".write"], /\$pair === '3'/);
  assert.match(room.continueVotes.$pair.$uid[".write"], /turns\/2\/completedAt/);
  assert.match(room.continueVotes.$pair.$uid[".write"], /turns\/4\/completedAt/);
  assert.match(room.continueVotes.$pair.$uid[".write"], /turns\/6\/completedAt/);
  assert.match(room.continueVotes.$pair.$uid[".validate"], /continue/);
  assert.match(room.continueVotes.$pair.$uid[".validate"], /finish/);
  assert.match(room.destroyed[".write"], /members/);
  assert.match(room.destroyed[".write"], /!data\.exists\(\)/);
  assert.match(room.destroyed[".write"], /!root\.child\('online\/trainingRooms\/' \+ \$roomId \+ '\/serverFinalized'\)\.exists\(\)/);
  assert.equal(room.serverFinalized[".write"], false);
  assert.equal(room.$other[".validate"], false);
});

test("training v3 HP rounds keep draws owner-scoped, scores secret, and workouts canonical", () => {
  const room = online.trainingRooms.$roomId;
  const round = room.rounds.$round;
  const draw = round.draws.$uid;
  const score = round.scores.$scorerUid;
  const choice = round.commandChoices.$traineeUid;
  const workout = round.workouts.$traineeUid;

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
