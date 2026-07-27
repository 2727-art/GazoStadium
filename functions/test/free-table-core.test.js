"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const modulePath = path.join(root, "free-table-core.mjs");
const freeTableModule = import(pathToFileURL(modulePath).href);

function roomSettings(overrides = {}) {
  return {
    name: "夜更かし食堂",
    description: "ひと息つける小さな食堂です",
    topic: "深夜の飯テロ",
    introduction: "店主と旅人として、今食べたいものを貼ります",
    journeyCue: "何か食べに出たくなったら",
    roleplayLevel: "light",
    duration: "15m",
    media: {
      text: true,
      image: true,
      audio: false,
      video: false,
    },
    avoid: "辛すぎる食べ物",
    welcome: "おかえり。席は空いています",
    themeId: "midnight-diner",
    ...overrides,
  };
}

function visitorCard(overrides = {}) {
  return {
    name: "夜道の旅人",
    activityTag: "文字でのんびり",
    message: "温かい麺を一枚持ってきました",
    roleplayLevel: "light",
    media: {
      text: true,
      image: true,
      audio: false,
      video: false,
    },
    ...overrides,
  };
}

function establishedSeat(overrides = {}) {
  return {
    hostUid: "host-a",
    visitorUid: "visitor-a",
    admissionAccepted: true,
    p2pConnected: true,
    arrivals: {
      host: true,
      visitor: true,
    },
    establishedAt: 1_800_000_000_000,
    ...overrides,
  };
}

test("room settings normalize bounded one-line fields and keep text available", async () => {
  const {
    FREE_TABLE_ROOM_LIMITS,
    normalizeFreeTableRoomSettings,
    validateFreeTableRoomSettings,
  } = await freeTableModule;
  const source = roomSettings({
    name: "  夜更かし\r\n食堂  ",
    description: "あ".repeat(FREE_TABLE_ROOM_LIMITS.description + 5),
    media: { text: false, image: true, audio: true, video: false },
  });
  const normalized = normalizeFreeTableRoomSettings(source);
  const validation = validateFreeTableRoomSettings(source);

  assert.equal(normalized.name, "夜更かし 食堂");
  assert.equal(Array.from(normalized.description).length, FREE_TABLE_ROOM_LIMITS.description);
  assert.deepEqual(normalized.media, {
    text: true,
    image: true,
    audio: true,
    video: false,
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("description_too_long"));
  assert.ok(validation.errors.includes("text_media_required"));
});

test("room settings require a room name and a host-chosen topic", async () => {
  const { validateFreeTableRoomSettings } = await freeTableModule;
  const validation = validateFreeTableRoomSettings(roomSettings({
    name: " \n ",
    topic: "",
  }));

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("name_required"));
  assert.ok(validation.errors.includes("topic_required"));
});

test("room settings reject unknown option ids, unsafe theme ids, and malformed media flags", async () => {
  const { validateFreeTableRoomSettings } = await freeTableModule;
  const validation = validateFreeTableRoomSettings(roomSettings({
    roleplayLevel: "competitive",
    duration: "endless",
    themeId: "../private",
    media: {
      text: true,
      image: "yes",
      audio: false,
      video: false,
    },
  }));

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("roleplayLevel_invalid"));
  assert.ok(validation.errors.includes("duration_invalid"));
  assert.ok(validation.errors.includes("themeId_invalid"));
  assert.ok(validation.errors.includes("image_media_invalid"));
});

test("legacy room settings receive the quiet default ambience without becoming invalid", async () => {
  const {
    FREE_TABLE_DEFAULT_AMBIENCE,
    normalizeFreeTableRoomSettings,
    validateFreeTableRoomSettings,
  } = await freeTableModule;
  const legacy = roomSettings();
  delete legacy.ambience;

  const normalized = normalizeFreeTableRoomSettings(legacy);
  const validation = validateFreeTableRoomSettings(legacy);

  assert.deepEqual(FREE_TABLE_DEFAULT_AMBIENCE, {
    metronomeBpm: 0,
    lightingId: "natural",
  });
  assert.deepEqual(normalized.ambience, FREE_TABLE_DEFAULT_AMBIENCE);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.value.ambience, FREE_TABLE_DEFAULT_AMBIENCE);
});

test("room ambience accepts silence or an integer 40 through 160 BPM and fixed lighting ids", async () => {
  const {
    FREE_TABLE_LIGHTING_IDS,
    FREE_TABLE_METRONOME_MAX_BPM,
    FREE_TABLE_METRONOME_MIN_BPM,
    normalizeFreeTableAmbience,
    validateFreeTableAmbience,
    validateFreeTableRoomSettings,
  } = await freeTableModule;

  assert.equal(FREE_TABLE_METRONOME_MIN_BPM, 40);
  assert.equal(FREE_TABLE_METRONOME_MAX_BPM, 160);
  assert.deepEqual(FREE_TABLE_LIGHTING_IDS, [
    "natural",
    "indirect",
    "daylight",
    "headlight",
  ]);

  for (const metronomeBpm of [0, 40, 120, 160]) {
    for (const lightingId of FREE_TABLE_LIGHTING_IDS) {
      const ambience = { metronomeBpm, lightingId };
      assert.deepEqual(normalizeFreeTableAmbience(ambience), ambience);
      assert.equal(validateFreeTableAmbience(ambience).valid, true);
      assert.equal(
        validateFreeTableRoomSettings(roomSettings({ ambience })).valid,
        true,
      );
    }
  }
});

test("room ambience rejects out-of-range or non-integer BPM, unknown lighting, and extra fields", async () => {
  const {
    FREE_TABLE_DEFAULT_AMBIENCE,
    normalizeFreeTableAmbience,
    validateFreeTableAmbience,
    validateFreeTableRoomSettings,
  } = await freeTableModule;

  for (const metronomeBpm of [39, 161, 60.5, "60", NaN]) {
    const validation = validateFreeTableAmbience({
      metronomeBpm,
      lightingId: "natural",
    });
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.includes("metronomeBpm_invalid"));
  }

  const invalid = validateFreeTableAmbience({
    metronomeBpm: 120,
    lightingId: "strobe",
    melodyId: "copyrighted-song",
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("lightingId_invalid"));
  assert.ok(invalid.errors.includes("ambience_unknown_field"));
  assert.deepEqual(invalid.value, {
    metronomeBpm: 120,
    lightingId: FREE_TABLE_DEFAULT_AMBIENCE.lightingId,
  });

  const roomValidation = validateFreeTableRoomSettings(roomSettings({
    ambience: {
      metronomeBpm: 120,
      lightingId: "headlight",
      melodyId: "not-allowed",
    },
  }));
  assert.equal(roomValidation.valid, false);
  assert.ok(roomValidation.errors.includes("ambience_unknown_field"));

  assert.deepEqual(normalizeFreeTableAmbience(null), FREE_TABLE_DEFAULT_AMBIENCE);
  assert.deepEqual(
    normalizeFreeTableAmbience({ metronomeBpm: 39, lightingId: "unknown" }),
    FREE_TABLE_DEFAULT_AMBIENCE,
  );
});

test("visitor cards are whitelisted, bounded, and contain no competitive metadata", async () => {
  const {
    normalizeFreeTableVisitorCard,
    validateFreeTableVisitorCard,
  } = await freeTableModule;
  const source = visitorCard({
    name: "  夜道の\n旅人 ",
    message: "声は使わず、文字で遊びたいです",
    publicPosition: 1,
    points: 9999,
    victories: 120,
    paymentBalance: 500,
  });
  const normalized = normalizeFreeTableVisitorCard(source);
  const validation = validateFreeTableVisitorCard(source);

  assert.equal(validation.valid, true);
  assert.equal(normalized.name, "夜道の 旅人");
  assert.deepEqual(Object.keys(normalized), [
    "name",
    "activityTag",
    "message",
    "roleplayLevel",
    "media",
  ]);
  assert.equal("publicPosition" in normalized, false);
  assert.equal("points" in normalized, false);
  assert.equal("victories" in normalized, false);
  assert.equal("paymentBalance" in normalized, false);
});

test("room settings also discard unrelated public or economic fields", async () => {
  const { normalizeFreeTableRoomSettings } = await freeTableModule;
  const normalized = normalizeFreeTableRoomSettings(roomSettings({
    publicPosition: 1,
    popularity: 999,
    resultRecord: { first: 10, second: 0 },
    paymentReward: 500,
  }));

  assert.equal("publicPosition" in normalized, false);
  assert.equal("popularity" in normalized, false);
  assert.equal("resultRecord" in normalized, false);
  assert.equal("paymentReward" in normalized, false);
});

test("departure wording is canonical hiragana and is a greeting rather than a result", async () => {
  const {
    FREE_TABLE_DEPARTURE_GREETING,
    FREE_TABLE_END_KINDS,
    FREE_TABLE_SENDOFF_GREETING,
    isCanonicalFreeTableDepartureLine,
    normalizeFreeTableDepartureLine,
    normalizeFreeTableEnding,
  } = await freeTableModule;
  const ending = normalizeFreeTableEnding({
    kind: FREE_TABLE_END_KINDS.DEPARTURE,
    line: "おなかがすきました",
    sendoffLine: "",
    score: 10,
    outcome: "first",
  });

  assert.equal(FREE_TABLE_DEPARTURE_GREETING, "いってきます");
  assert.equal(FREE_TABLE_SENDOFF_GREETING, "いってらっしゃい");
  assert.equal(normalizeFreeTableDepartureLine("いってきます！"), "いってきます");
  assert.deepEqual(ending, {
    kind: "departure",
    line: "おなかがすきました。いってきます",
    sendoffLine: "いってらっしゃい",
  });
  assert.equal(isCanonicalFreeTableDepartureLine(ending.line), true);
  assert.equal("score" in ending, false);
  assert.equal("outcome" in ending, false);

  const source = fs.readFileSync(modulePath, "utf8");
  const noncanonical = String.fromCodePoint(
    0x884c, 0x3063, 0x3066, 0x304d, 0x307e, 0x3059,
  );
  assert.equal(source.includes(noncanonical), false);
});

test("ending validation rejects unknown kinds and overlong custom lines", async () => {
  const {
    FREE_TABLE_ENDING_LIMITS,
    validateFreeTableEnding,
  } = await freeTableModule;
  const unknown = validateFreeTableEnding({ kind: "unknown", line: "" });
  const long = validateFreeTableEnding({
    kind: "departure",
    line: "あ".repeat(FREE_TABLE_ENDING_LIMITS.departureLine),
  });

  assert.equal(unknown.valid, false);
  assert.ok(unknown.errors.includes("kind_invalid"));
  assert.equal(long.valid, false);
  assert.ok(long.errors.includes("line_too_long"));
});

test("one room permits one distinct host and visitor", async () => {
  const {
    FREE_TABLE_MAX_PARTICIPANTS,
    isFreeTableParticipantPair,
  } = await freeTableModule;

  assert.equal(FREE_TABLE_MAX_PARTICIPANTS, 2);
  assert.equal(isFreeTableParticipantPair({ hostUid: "host", visitorUid: "visitor" }), true);
  assert.equal(isFreeTableParticipantPair({ hostUid: "same", visitorUid: "same" }), false);
  assert.equal(isFreeTableParticipantPair({ hostUid: "host", visitorUid: "" }), false);
});

test("the room lifecycle only allows role-appropriate welcoming and departures", async () => {
  const {
    FREE_TABLE_ACTIONS,
    FREE_TABLE_ROLES,
    FREE_TABLE_STATES,
    canApplyFreeTableAction,
    isFreeTableStateTransitionAllowed,
    nextFreeTableState,
  } = await freeTableModule;

  assert.equal(
    nextFreeTableState(
      FREE_TABLE_STATES.CLOSED,
      FREE_TABLE_ACTIONS.OPEN_ROOM,
      FREE_TABLE_ROLES.HOST,
    ),
    FREE_TABLE_STATES.OPEN,
  );
  assert.equal(
    nextFreeTableState(
      FREE_TABLE_STATES.OPEN,
      FREE_TABLE_ACTIONS.REQUEST_ENTRY,
      FREE_TABLE_ROLES.VISITOR,
    ),
    FREE_TABLE_STATES.ADMISSION_PENDING,
  );
  assert.equal(
    nextFreeTableState(
      FREE_TABLE_STATES.ADMISSION_PENDING,
      FREE_TABLE_ACTIONS.ACCEPT_REQUEST,
      FREE_TABLE_ROLES.HOST,
    ),
    FREE_TABLE_STATES.CONNECTING,
  );
  assert.equal(
    nextFreeTableState(
      FREE_TABLE_STATES.CONNECTING,
      FREE_TABLE_ACTIONS.CONNECTION_READY,
      FREE_TABLE_ROLES.SYSTEM,
    ),
    FREE_TABLE_STATES.ACTIVE,
  );
  assert.equal(
    nextFreeTableState(
      FREE_TABLE_STATES.ACTIVE,
      FREE_TABLE_ACTIONS.DEPART,
      FREE_TABLE_ROLES.VISITOR,
    ),
    FREE_TABLE_STATES.RESTING,
  );
  assert.equal(
    canApplyFreeTableAction(
      FREE_TABLE_STATES.ACTIVE,
      FREE_TABLE_ACTIONS.DEPART,
      FREE_TABLE_ROLES.HOST,
    ),
    false,
  );
  assert.equal(
    isFreeTableStateTransitionAllowed(
      FREE_TABLE_STATES.ACTIVE,
      FREE_TABLE_STATES.RESTING,
    ),
    true,
  );
  assert.equal(
    isFreeTableStateTransitionAllowed(
      FREE_TABLE_STATES.OPEN,
      FREE_TABLE_STATES.ACTIVE,
    ),
    false,
  );
});

test("a seat is established only after admission, connection, and both arrivals", async () => {
  const { isFreeTableSeatEstablished, resolveFreeTableGrowth } = await freeTableModule;
  const base = establishedSeat();
  const missingHost = establishedSeat({ arrivals: { host: false, visitor: true } });
  const missingVisitor = establishedSeat({ arrivals: { host: true, visitor: false } });

  assert.equal(isFreeTableSeatEstablished(missingHost), false);
  assert.equal(isFreeTableSeatEstablished(missingVisitor), false);
  assert.equal(isFreeTableSeatEstablished({ ...base, admissionAccepted: false }), false);
  assert.equal(isFreeTableSeatEstablished({ ...base, p2pConnected: false }), false);
  assert.equal(isFreeTableSeatEstablished(base), true);

  assert.equal(resolveFreeTableGrowth({
    seat: missingHost,
    currentSeatCount: 0,
  }).nextSeatCount, 0);
  assert.deepEqual(resolveFreeTableGrowth({
    seat: base,
    currentSeatCount: 0,
  }), {
    established: true,
    merged: false,
    growthEligible: true,
    reason: "counted",
    previousSeatCount: 0,
    nextSeatCount: 1,
    crossedMilestones: [1],
    currentMilestone: 1,
    nextMilestone: 3,
  });
});

test("same-pair reconnects up to thirty minutes merge into the preceding seat", async () => {
  const {
    FREE_TABLE_RECONNECT_MERGE_MS,
    resolveFreeTableGrowth,
    shouldMergeFreeTableReconnect,
  } = await freeTableModule;
  const endedAt = 1_800_000_000_000;
  const previousSeat = {
    hostUid: "host-a",
    visitorUid: "visitor-a",
    endedAt,
  };
  const atBoundary = establishedSeat({
    establishedAt: endedAt + FREE_TABLE_RECONNECT_MERGE_MS,
  });
  const afterBoundary = establishedSeat({
    establishedAt: endedAt + FREE_TABLE_RECONNECT_MERGE_MS + 1,
  });

  assert.equal(shouldMergeFreeTableReconnect(previousSeat, atBoundary), true);
  assert.equal(shouldMergeFreeTableReconnect(previousSeat, afterBoundary), false);
  assert.equal(shouldMergeFreeTableReconnect(previousSeat, {
    ...atBoundary,
    visitorUid: "visitor-b",
  }), false);

  assert.deepEqual(resolveFreeTableGrowth({
    seat: atBoundary,
    previousSeat,
    currentSeatCount: 7,
  }), {
    established: true,
    merged: true,
    growthEligible: false,
    reason: "reconnect_merge",
    previousSeatCount: 7,
    nextSeatCount: 7,
    crossedMilestones: [],
    currentMilestone: 7,
    nextMilestone: 15,
  });
});

test("same-pair growth uses a rolling twelve-hour cap", async () => {
  const {
    FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS,
    isFreeTablePairGrowthEligible,
    resolveFreeTableGrowth,
  } = await freeTableModule;
  const establishedAt = 1_800_000_000_000;
  const justInside = establishedAt - FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS + 1;
  const atBoundary = establishedAt - FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS;

  assert.equal(isFreeTablePairGrowthEligible({
    establishedAt,
    lastPairGrowthAt: justInside,
  }), false);
  assert.equal(isFreeTablePairGrowthEligible({
    establishedAt,
    lastPairGrowthAt: atBoundary,
  }), true);

  const blocked = resolveFreeTableGrowth({
    seat: establishedSeat({ establishedAt }),
    lastPairGrowthAt: justInside,
    currentSeatCount: 3,
  });
  assert.equal(blocked.reason, "pair_cooldown");
  assert.equal(blocked.nextSeatCount, 3);
  assert.deepEqual(blocked.crossedMilestones, []);

  const eligible = resolveFreeTableGrowth({
    seat: establishedSeat({ establishedAt }),
    lastPairGrowthAt: atBoundary,
    currentSeatCount: 3,
  });
  assert.equal(eligible.reason, "counted");
  assert.equal(eligible.nextSeatCount, 4);
});

test("place growth crosses only the fixed one, three, seven, fifteen, and thirty seat marks", async () => {
  const {
    FREE_TABLE_GROWTH_MILESTONES,
    getFreeTableGrowthMilestone,
    getFreeTableMilestonesCrossed,
    getNextFreeTableGrowthMilestone,
  } = await freeTableModule;

  assert.deepEqual(FREE_TABLE_GROWTH_MILESTONES, [1, 3, 7, 15, 30]);
  assert.deepEqual(getFreeTableMilestonesCrossed(0, 30), [1, 3, 7, 15, 30]);
  assert.deepEqual(getFreeTableMilestonesCrossed(7, 14), []);
  assert.deepEqual(getFreeTableMilestonesCrossed(14, 15), [15]);
  assert.equal(getFreeTableGrowthMilestone(29), 15);
  assert.equal(getFreeTableGrowthMilestone(30), 30);
  assert.equal(getNextFreeTableGrowthMilestone(15), 30);
  assert.equal(getNextFreeTableGrowthMilestone(30), null);
});

test("shelf order is fair, deterministic, and unaffected by public popularity-like fields", async () => {
  const { orderFreeTableShelf } = await freeTableModule;
  const entries = [
    {
      roomId: "often-shown",
      hostUid: "host-c",
      openedAt: 100,
      fairness: { shownCount: 4, lastShownAt: 700 },
      popularity: 0,
      publicPosition: 99,
    },
    {
      roomId: "never-shown-new",
      hostUid: "host-b",
      openedAt: 300,
      fairness: { shownCount: 0, lastShownAt: 0 },
      popularity: 1,
      publicPosition: 100,
    },
    {
      roomId: "never-shown-old",
      hostUid: "host-a",
      openedAt: 200,
      fairness: { shownCount: 0, lastShownAt: 0 },
      popularity: 999999,
      publicPosition: 1,
    },
    {
      roomId: "shown-once",
      hostUid: "host-d",
      openedAt: 50,
      fairness: { shownCount: 1, lastShownAt: 10 },
      popularity: 500,
      publicPosition: 2,
    },
  ];
  const snapshot = structuredClone(entries);
  const ordered = orderFreeTableShelf(entries, { rotationKey: "rotation-a" });
  const ids = ordered.map(({ roomId }) => roomId);

  assert.deepEqual(ids, [
    "never-shown-old",
    "never-shown-new",
    "shown-once",
    "often-shown",
  ]);
  assert.deepEqual(entries, snapshot);
  assert.deepEqual(
    orderFreeTableShelf(entries, { rotationKey: "rotation-a" }).map(({ roomId }) => roomId),
    ids,
  );

  const rewritten = entries.map((entry, index) => ({
    ...entry,
    popularity: index % 2 ? 1_000_000 : 0,
    publicPosition: 500 - index,
    paymentBoost: index * 100,
    resultRecord: { value: index * 10 },
  }));
  assert.deepEqual(
    orderFreeTableShelf(rewritten, { rotationKey: "rotation-a" }).map(({ roomId }) => roomId),
    ids,
  );

  const tied = ["a", "b", "c", "d", "e"].map((roomId) => ({
    roomId,
    hostUid: `host-${roomId}`,
    openedAt: 0,
    fairness: { shownCount: 0, lastShownAt: 0 },
  }));
  const firstRotation = orderFreeTableShelf(tied, {
    rotationKey: "rotation-a",
  }).map(({ roomId }) => roomId);
  const secondRotation = orderFreeTableShelf(tied, {
    rotationKey: "rotation-b",
  }).map(({ roomId }) => roomId);
  assert.notDeepEqual(firstRotation, secondRotation);
});
