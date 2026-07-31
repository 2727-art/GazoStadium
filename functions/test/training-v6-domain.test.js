"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const domainUrl = pathToFileURL(
  path.join(__dirname, "..", "..", "training-v6-domain.mjs"),
).href;
let domain;

test.before(async () => {
  domain = await import(domainUrl);
});

const participants = Object.freeze(["player-alpha", "player-bravo"]);

test("the first single hit fixes trainer and victim and stops later draws", () => {
  const outcome = domain.deriveTrainingV6FirstHit({
    participantUids: participants,
    draws: [
      {
        roundNumber: 1,
        scores: { "player-alpha": 7, "player-bravo": 6 },
      },
      {
        roundNumber: 2,
        scores: { "player-alpha": 9, "player-bravo": 7 },
      },
      {
        roundNumber: 3,
        scores: { "player-alpha": 10, "player-bravo": 10 },
      },
    ],
  });

  assert.equal(outcome.kind, "single_hit");
  assert.equal(outcome.roundNumber, 2);
  assert.equal(outcome.victimUid, "player-alpha");
  assert.equal(outcome.trainerUid, "player-bravo");
  assert.equal(outcome.nextRoundNumber, null);
  assert.equal(outcome.workoutQueue.length, 1);
  assert.equal(outcome.workoutQueue[0].durationMs, 60_000);
});

test("a double hit creates two sequential workouts in member order", () => {
  const outcome = domain.deriveTrainingV6DrawOutcome({
    roundNumber: 1,
    participantUids: participants,
    scores: { "player-alpha": 8, "player-bravo": 10 },
  });

  assert.equal(outcome.kind, "double_hit");
  assert.deepEqual(
    outcome.workoutQueue.map((workout) => ({
      sequence: workout.sequence,
      trainerUid: workout.trainerUid,
      victimUid: workout.victimUid,
    })),
    [
      {
        sequence: 0,
        trainerUid: "player-bravo",
        victimUid: "player-alpha",
      },
      {
        sequence: 1,
        trainerUid: "player-alpha",
        victimUid: "player-bravo",
      },
    ],
  );
  assert.notEqual(
    outcome.workoutQueue[0].workoutId,
    outcome.workoutQueue[1].workoutId,
  );
});

test("five misses end at the draw limit without a workout", () => {
  const draws = Array.from({ length: 5 }, (_, index) => ({
    roundNumber: index + 1,
    scores: { "player-alpha": 7, "player-bravo": 7 },
  }));
  const outcome = domain.deriveTrainingV6FirstHit({
    participantUids: participants,
    draws,
  });

  assert.equal(outcome.kind, "draw_limit");
  assert.equal(outcome.roundNumber, 5);
  assert.equal(outcome.nextRoundNumber, null);
  assert.deepEqual(outcome.workoutQueue, []);
});

test("instruction contract carries only server-authoritative exercise and intensity", () => {
  const instruction = domain.createTrainingV6Instruction({
    exerciseId: "custom",
    exercise: "  スクワット  ",
    completion: "60秒続ける",
    command: "膝を無理に深く曲げず、自分のペースで",
    bpm: "96",
    beatsPerRep: "4",
  });

  assert.deepEqual(instruction, {
    exerciseId: "custom",
    exercise: "スクワット",
    completion: "60秒続ける",
    command: "膝を無理に深く曲げず、自分のペースで",
    bpm: 96,
    beatsPerRep: 4,
  });
  assert.equal(domain.validateTrainingV6Instruction(instruction), true);
  assert.throws(
    () => domain.createTrainingV6Instruction({
      ...instruction,
      bpm: 0,
    }),
    /instruction is invalid/,
  );
  assert.throws(
    () => domain.createTrainingV6Instruction({
      ...instruction,
      beatsPerRep: 1,
    }),
    /instruction is invalid/,
  );
  assert.throws(
    () => domain.createTrainingV6Instruction({
      ...instruction,
      exerciseId: "unsafe_unknown",
    }),
    /instruction is invalid/,
  );
});

test("cheer and reaction are bounded ephemeral P2P events", () => {
  const event = domain.createTrainingV6P2PEvent({
    kind: "cheer",
    eventId: "event-12345678",
    roomId: "room-12345678",
    roundNumber: 2,
    workoutId: "workout-2-1",
    fromUid: "player-bravo",
    toUid: "player-alpha",
    text: "  あと少し！  ",
    createdAt: 1_000,
  });

  assert.equal(event.text, "あと少し！");
  assert.equal(domain.validateTrainingV6P2PEvent(event), true);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(domain.validateTrainingV6P2PEvent({
    ...event,
    kind: "progress",
  }), false);
});
