"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FREE_TABLE_INVITE_ID_PATTERN,
  FREE_TABLE_INVITE_TTL_MS,
  FREE_TABLE_PROTOCOL_VERSION,
  FREE_TABLE_PUBLIC_CARD_REPORT_RATE_LIMIT,
  FREE_TABLE_PUBLIC_CARD_REPORT_RATE_WINDOW_MS,
  freeTableInvitePreviewProjection,
  freeTablePublicCardSnapshotHash,
  internalPublicCardReportId,
  nextPublicCardReportRateLimit,
  randomFreeTableInviteId,
} = require("../free-table");

const NOW = 1_900_000_000_000;
const INVITE_ID = "I".repeat(32);
const PUBLIC_ROOM_ID = "R".repeat(24);
const PUBLIC_MEMBER_ID = "M".repeat(24);
const ROOM_ID = "O".repeat(24);
const REOPENED_ROOM_ID = "N".repeat(24);
const HOST_UID = "private-host-uid";

const space = Object.freeze({
  name: "夜更かし食堂",
  description: "勝ち負けを置いて、温かい一品を貼る部屋です。",
  topic: "深夜の飯テロ",
  introduction: "いま食べたいものを、言葉や一枚でゆっくり貼ります。",
  journeyCue: "おなかと心が少し満ちたら",
  roleplayLevel: "light",
  duration: "15m",
  media: {
    text: true,
    image: true,
    audio: true,
    video: false,
  },
  avoid: "個人情報",
  welcome: "おかえり。温かい席へどうぞ。",
  themeId: "midnight-diner",
  ambience: {
    metronomeBpm: 88,
    lightingId: "indirect",
  },
});

const hostCard = Object.freeze({
  name: "夜更かし店主",
  activityTag: "のんびりお迎え",
  message: "湯気の立つ話を用意しています。",
  roleplayLevel: "light",
  media: {
    text: true,
    image: true,
    audio: true,
    video: false,
  },
});

function invitation(overrides = {}) {
  return {
    protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
    inviteId: INVITE_ID,
    hostUid: HOST_UID,
    roomId: ROOM_ID,
    publicRoomId: PUBLIC_ROOM_ID,
    generation: 3,
    createdAt: NOW,
    expiresAt: NOW + FREE_TABLE_INVITE_TTL_MS,
    ...overrides,
  };
}

function publicRoom(overrides = {}) {
  return {
    protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
    hostUid: HOST_UID,
    roomId: ROOM_ID,
    generation: 4,
    publicRoomId: PUBLIC_ROOM_ID,
    publicMemberId: PUBLIC_MEMBER_ID,
    state: "open",
    space,
    hostCard,
    openedAt: NOW,
    heartbeatAt: NOW + 20_000,
    expiresAt: NOW + 120_000,
    ...overrides,
  };
}

function hostActive(overrides = {}) {
  return {
    state: "open",
    roomId: ROOM_ID,
    publicRoomId: PUBLIC_ROOM_ID,
    generation: 4,
    heartbeatAt: NOW + 20_000,
    expiresAt: NOW + 120_000,
    ...overrides,
  };
}

function roomState(overrides = {}) {
  return {
    state: "open",
    hostUid: HOST_UID,
    roomId: ROOM_ID,
    publicRoomId: PUBLIC_ROOM_ID,
    generation: 4,
    space,
    hostCard,
    heartbeatAt: NOW + 20_000,
    expiresAt: NOW + 120_000,
    ...overrides,
  };
}

test("free table invite ids contain 192 random bits in a 32-character token", () => {
  let requestedBytes = 0;
  const inviteId = randomFreeTableInviteId((size) => {
    requestedBytes = size;
    return Buffer.alloc(size, 0xa5);
  });
  assert.equal(requestedBytes, 24);
  assert.equal(inviteId.length, 32);
  assert.match(inviteId, FREE_TABLE_INVITE_ID_PATTERN);
  assert.throws(
    () => randomFreeTableInviteId(() => Buffer.alloc(18)),
    /exactly 24 random bytes/,
  );
});

test("invite preview survives a heartbeat generation advance without exposing stable ids", () => {
  const preview = freeTableInvitePreviewProjection(
    INVITE_ID,
    invitation(),
    invitation(),
    publicRoom(),
    hostActive(),
    roomState(),
    NOW + 20_000,
  );
  assert.deepEqual(Object.keys(preview).sort(), [
    "active",
    "expiresAt",
    "inviteId",
    "ok",
    "preview",
    "previewHash",
    "state",
    "updatedAt",
  ]);
  assert.equal(preview.active, true);
  assert.equal(preview.state, "open");
  assert.equal(preview.preview.hostDisplayName, hostCard.name);
  assert.deepEqual(Object.keys(preview.preview.space).sort(), [
    "ambience",
    "avoid",
    "description",
    "duration",
    "introduction",
    "journeyCue",
    "media",
    "name",
    "roleplayLevel",
    "themeId",
    "topic",
    "welcome",
  ]);
  assert.deepEqual(preview.preview.space.ambience, space.ambience);
  const serialized = JSON.stringify(preview);
  assert.equal(serialized.includes(HOST_UID), false);
  assert.equal(serialized.includes(PUBLIC_ROOM_ID), false);
  assert.equal(serialized.includes(PUBLIC_MEMBER_ID), false);
  assert.equal(serialized.includes(ROOM_ID), false);
  assert.equal(serialized.includes(hostCard.message), false);
  assert.equal(serialized.includes(space.avoid), true);
  assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
});

test("public card hashes are canonical, public-only, and content sensitive", () => {
  const first = freeTableInvitePreviewProjection(
    INVITE_ID,
    invitation(),
    invitation(),
    publicRoom(),
    hostActive(),
    roomState(),
    NOW + 20_000,
  );
  const repeatedHash = freeTablePublicCardSnapshotHash(first.preview);
  const changed = freeTableInvitePreviewProjection(
    INVITE_ID,
    invitation(),
    invitation(),
    publicRoom({ space: { ...space, topic: "夜のジオゲッサー" } }),
    hostActive(),
    roomState(),
    NOW + 20_000,
  );
  assert.equal(repeatedHash, first.previewHash);
  assert.notEqual(changed.previewHash, first.previewHash);
  assert.equal(
    internalPublicCardReportId(PUBLIC_ROOM_ID, first.previewHash, "reporter"),
    internalPublicCardReportId(PUBLIC_ROOM_ID, repeatedHash, "reporter"),
  );
  assert.notEqual(
    internalPublicCardReportId(PUBLIC_ROOM_ID, first.previewHash, "reporter"),
    internalPublicCardReportId(PUBLIC_ROOM_ID, first.previewHash, "another-reporter"),
  );
  assert.equal(first.previewHash.includes(HOST_UID), false);
});

test("public card report rate limit is a fixed bounded window", () => {
  let stored = null;
  for (let count = 1; count <= FREE_TABLE_PUBLIC_CARD_REPORT_RATE_LIMIT; count += 1) {
    stored = nextPublicCardReportRateLimit(stored, "reporter", NOW);
    assert.ok(stored);
    assert.equal(stored.count, count);
    assert.equal(
      stored.windowEndsAt - stored.windowStartedAt,
      FREE_TABLE_PUBLIC_CARD_REPORT_RATE_WINDOW_MS,
    );
  }
  assert.equal(nextPublicCardReportRateLimit(stored, "reporter", NOW), null);
  const nextWindow = nextPublicCardReportRateLimit(
    stored,
    "reporter",
    stored.windowEndsAt,
  );
  assert.equal(nextWindow.count, 1);
  assert.equal(nextWindow.windowStartedAt, stored.windowEndsAt);
});

test("closed, seated, expired, revoked, and reopened links share one inactive projection", () => {
  const expectedKeys = ["active", "inviteId", "ok", "state", "updatedAt"];
  const cases = [
    {
      label: "closed",
      invite: invitation(),
      hostInvite: invitation(),
      publicRoom: null,
      host: null,
      room: null,
    },
    {
      label: "seated",
      invite: invitation(),
      hostInvite: invitation(),
      publicRoom: null,
      host: hostActive({ state: "active", sessionId: "S".repeat(24) }),
      room: roomState({ state: "accepted" }),
    },
    {
      label: "expired",
      invite: invitation({ expiresAt: NOW + 1 }),
      hostInvite: invitation({ expiresAt: NOW + 1 }),
      publicRoom: publicRoom(),
      host: hostActive(),
      room: roomState(),
      now: NOW + 2,
    },
    {
      label: "revoked",
      invite: null,
      hostInvite: null,
      publicRoom: publicRoom(),
      host: hostActive(),
      room: roomState(),
    },
    {
      label: "reopened",
      invite: invitation(),
      hostInvite: invitation(),
      publicRoom: publicRoom({
        roomId: REOPENED_ROOM_ID,
        generation: 7,
      }),
      host: hostActive({
        roomId: REOPENED_ROOM_ID,
        generation: 7,
      }),
      room: roomState({
        roomId: REOPENED_ROOM_ID,
        generation: 7,
      }),
    },
  ];
  for (const scenario of cases) {
    const preview = freeTableInvitePreviewProjection(
      INVITE_ID,
      scenario.invite,
      scenario.hostInvite,
      scenario.publicRoom,
      scenario.host,
      scenario.room,
      scenario.now || NOW + 20_000,
    );
    assert.deepEqual(Object.keys(preview).sort(), expectedKeys, scenario.label);
    assert.equal(preview.active, false, scenario.label);
    assert.equal(preview.state, "inactive", scenario.label);
  }
});

test("invite preview rejects a canonical generation older than the issued opening", () => {
  const preview = freeTableInvitePreviewProjection(
    INVITE_ID,
    invitation(),
    invitation(),
    publicRoom(),
    hostActive({ generation: 2 }),
    roomState(),
    NOW + 20_000,
  );
  assert.equal(preview.state, "inactive");
});

test("partially advanced heartbeat generations stay active for the same opening", () => {
  const preview = freeTableInvitePreviewProjection(
    INVITE_ID,
    invitation(),
    invitation(),
    publicRoom({ generation: 4 }),
    hostActive({ generation: 5 }),
    roomState({ generation: 3 }),
    NOW + 20_000,
  );
  assert.equal(preview.state, "open");
});

test("an orphaned old invite record is inactive after the canonical host pointer rotates", () => {
  const rotatedInviteId = "T".repeat(32);
  const preview = freeTableInvitePreviewProjection(
    INVITE_ID,
    invitation(),
    invitation({ inviteId: rotatedInviteId }),
    publicRoom(),
    hostActive(),
    roomState(),
    NOW + 20_000,
  );
  assert.deepEqual(Object.keys(preview).sort(), [
    "active",
    "inviteId",
    "ok",
    "state",
    "updatedAt",
  ]);
  assert.equal(preview.active, false);
  assert.equal(preview.state, "inactive");
});
