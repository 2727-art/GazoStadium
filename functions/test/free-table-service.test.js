"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  FREE_TABLE_ACTIONS,
  FREE_TABLE_CONNECTING_TTL_MS,
  FREE_TABLE_DISCONNECT_GRACE_MS,
  FREE_TABLE_LIST_SCAN_LIMIT,
  FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS,
  FREE_TABLE_PUBLIC_STATS_CACHE_TTL_MS,
  FREE_TABLE_RECONNECT_MERGE_MS,
  FREE_TABLE_REQUEST_LIMIT,
  FREE_TABLE_REQUEST_TTL_MS,
  acceptedSessionValue,
  blockedInEitherDirection,
  createFreeTablePublicStatsLoader,
  createFreeTableService,
  fairShelfCursor,
  freeTablePublicStatsProjection,
  growthStage,
  nextAdmissionState,
  internalReportId,
  nextArrivalState,
  nextEngagementClaim,
  nextExpiredRoomCleanupClaim,
  nextFinalHostAdmissionClaim,
  nextHostAdmissionClaim,
  nextHostOpenClaim,
  nextRoomRequests,
  nextVisitorAdmissionClaim,
  nextVisitorPendingClaim,
  normalizeDepartureLine,
  ownerGrowthProjection,
  pairGrowthDecision,
  publicRoomProjection,
  publicRequestProjection,
  publicSessionProjection,
  randomPublicId,
  restoredAcceptedHostOpenClaim,
  restoredHostOpenClaim,
  restoredVisitorPendingClaim,
  selectReportEvidence,
  validateCard,
  validateRoomSettings,
} = require("../free-table");

const NOW = 1_800_000_000_000;
const ID_A = "A".repeat(24);
const ID_B = "B".repeat(24);
const ID_C = "C".repeat(24);

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

function card(name = "夜道の旅人") {
  return {
    name,
    activityTag: "文字でのんびり",
    message: "温かい麺を一枚持ってきました",
    roleplayLevel: "light",
    media: {
      text: true,
      image: true,
      audio: false,
      video: false,
    },
  };
}

function openRoom() {
  return {
    roomId: ID_A,
    publicRoomId: ID_B,
    publicMemberId: ID_C,
    hostUid: "host",
    state: "open",
    space: roomSettings(),
    hostCard: card("夜更かし店主"),
    requests: {
      [ID_A]: {
        requestId: ID_A,
        visitorUid: "visitor-a",
        publicMemberId: ID_B,
        visitorCard: card("旅人A"),
        expiresAt: NOW + FREE_TABLE_REQUEST_TTL_MS,
      },
      [ID_B]: {
        requestId: ID_B,
        visitorUid: "visitor-b",
        publicMemberId: ID_C,
        visitorCard: card("旅人B"),
        expiresAt: NOW + FREE_TABLE_REQUEST_TTL_MS,
      },
    },
    expiresAt: NOW + 120_000,
  };
}

function publicStatsRoot() {
  const hostUid = "stats-host";
  const generation = 7;
  const expiresAt = NOW + 120_000;
  return {
    hostActive: {
      [hostUid]: {
        roomId: ID_A,
        publicRoomId: ID_B,
        state: "open",
        generation,
        heartbeatAt: NOW,
        expiresAt,
      },
    },
    publicRooms: {
      [ID_B]: {
        protocolVersion: 1,
        roomId: ID_A,
        publicRoomId: ID_B,
        publicMemberId: ID_C,
        hostUid,
        state: "open",
        generation,
        space: roomSettings(),
        hostCard: card("夜更かし店主"),
        openedAt: NOW,
        heartbeatAt: NOW,
        expiresAt,
      },
    },
    roomStates: {
      [ID_A]: {
        roomId: ID_A,
        publicRoomId: ID_B,
        publicMemberId: ID_C,
        hostUid,
        state: "open",
        generation,
        space: roomSettings(),
        hostCard: card("夜更かし店主"),
        heartbeatAt: NOW,
        expiresAt,
      },
    },
    roomOwners: {
      [ID_A]: {
        roomId: ID_A,
        publicRoomId: ID_B,
        uid: hostUid,
        generation,
        heartbeatAt: NOW,
        expiresAt,
      },
    },
    engagements: {
      [hostUid]: {
        roomId: ID_A,
        publicRoomId: ID_B,
        state: "host_open",
        generation,
        heartbeatAt: NOW,
        expiresAt,
      },
    },
    sessions: {},
    active: {},
    presence: {},
  };
}

function establishedPublicStatsRoot() {
  const root = publicStatsRoot();
  const hostUid = "stats-host";
  const visitorUid = "stats-visitor";
  const sessionId = "S".repeat(24);
  const expiresAt = NOW + 3_600_000;
  root.hostActive[hostUid] = {
    roomId: ID_A,
    publicRoomId: ID_B,
    sessionId,
    state: "active",
    generation: 7,
    heartbeatAt: NOW,
    expiresAt,
  };
  root.publicRooms = {};
  root.sessions[sessionId] = {
    protocolVersion: 1,
    sessionId,
    roomId: ID_A,
    publicRoomId: ID_B,
    generation: 7,
    hostUid,
    visitorUid,
    participants: {
      [hostUid]: true,
      [visitorUid]: true,
    },
    status: "active",
    admissionAccepted: true,
    p2pConnected: true,
    arrivals: {
      host: true,
      visitor: true,
    },
    hardExpiresAt: expiresAt,
    expiresAt,
  };
  root.active = {
    [hostUid]: {
      sessionId,
      role: "host",
      expiresAt,
    },
    [visitorUid]: {
      sessionId,
      role: "visitor",
      expiresAt,
    },
  };
  root.engagements = {
    [hostUid]: {
      state: "active",
      role: "host",
      roomId: ID_A,
      publicRoomId: ID_B,
      sessionId,
      generation: 7,
      expiresAt,
    },
    [visitorUid]: {
      state: "active",
      role: "visitor",
      roomId: ID_A,
      publicRoomId: ID_B,
      sessionId,
      generation: 7,
      expiresAt,
    },
  };
  root.presence = {
    [sessionId]: {
      [hostUid]: {
        online: true,
        lastSeen: NOW,
        expiresAt: NOW + 60_000,
      },
      [visitorUid]: {
        online: true,
        lastSeen: NOW,
        expiresAt: NOW + 60_000,
      },
    },
  };
  return {
    expiresAt,
    hostUid,
    root,
    sessionId,
    visitorUid,
  };
}

test("room and card validation follows the shared v1 schema", () => {
  assert.equal(validateRoomSettings(roomSettings()), true);
  assert.equal(validateCard(card()), true);
  assert.equal(validateRoomSettings(roomSettings({ duration: "slow" })), false);
  assert.equal(validateRoomSettings(roomSettings({ duration: "leisurely" })), true);
  assert.equal(validateCard({ ...card(), name: "あ".repeat(25) }), false);
  assert.equal(FREE_TABLE_REQUEST_TTL_MS, 120_000);
});

test("random public ids are opaque and contain no uid material", () => {
  const first = randomPublicId(() => Buffer.alloc(18, 1));
  const second = randomPublicId(() => Buffer.alloc(18, 2));
  assert.match(first, /^[A-Za-z0-9_-]{24}$/);
  assert.match(second, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /host|visitor|uid/i);
  const reportId = internalReportId(ID_A, "reporter-secret-uid");
  assert.match(reportId, /^[a-f0-9]{40}$/);
  assert.equal(reportId, internalReportId(ID_A, "reporter-secret-uid"));
  assert.notEqual(reportId, internalReportId(ID_A, "another-reporter"));
  assert.doesNotMatch(reportId, /reporter|secret|uid/i);
});

test("public shelf projection excludes uid, competitive, Pay, and growth counts", () => {
  const projection = publicRoomProjection({
    protocolVersion: 1,
    roomId: ID_A,
    publicRoomId: ID_B,
    publicMemberId: ID_C,
    hostUid: "secret-host-uid",
    state: "open",
    space: roomSettings(),
    hostCard: {
      ...card(),
      victories: 99,
      rating: 3000,
      points: 500,
    },
    growth: { visitCount: 50, growthCount: 30 },
    openedAt: NOW,
    heartbeatAt: NOW,
    expiresAt: NOW + 120_000,
  }, NOW);
  const serialized = JSON.stringify(projection);
  assert.ok(projection);
  assert.equal("roomId" in projection, false);
  assert.equal("hostUid" in projection, false);
  assert.equal("growth" in projection, false);
  assert.doesNotMatch(serialized, /secret-host-uid|victories|rating|points|visitCount|growthCount/);
});

test("public stats count the valid unexpired public shelf without heartbeat joins", () => {
  const root = publicStatsRoot();
  assert.deepEqual(freeTablePublicStatsProjection(root, NOW), {
    welcomingRooms: 1,
    seatedRooms: 0,
    updatedAt: NOW,
  });
  root.hostActive["stats-host"].generation += 1;
  root.roomOwners[ID_A].expiresAt = NOW;
  assert.equal(
    freeTablePublicStatsProjection(root, NOW).welcomingRooms,
    1,
  );
  root.publicRooms[ID_B].publicRoomId = ID_C;
  assert.equal(
    freeTablePublicStatsProjection(root, NOW).welcomingRooms,
    0,
  );
  root.publicRooms[ID_B].publicRoomId = ID_B;
  root.publicRooms[ID_B].expiresAt = NOW;
  assert.equal(freeTablePublicStatsProjection(root, NOW).welcomingRooms, 0);
});

test("public stats require one canonical established seat with both fresh presences", () => {
  const {
    hostUid,
    root,
    sessionId,
    visitorUid,
  } = establishedPublicStatsRoot();

  const stats = freeTablePublicStatsProjection(root, NOW);
  assert.deepEqual(stats, {
    welcomingRooms: 0,
    seatedRooms: 1,
    updatedAt: NOW,
  });
  assert.deepEqual(Object.keys(stats), [
    "welcomingRooms",
    "seatedRooms",
    "updatedAt",
  ]);
  assert.doesNotMatch(
    JSON.stringify(stats),
    /stats-host|stats-visitor|hostUid|visitorUid|publicRoomId|sessionId|card|topic/i,
  );

  root.sessions[sessionId].status = "connecting";
  assert.equal(freeTablePublicStatsProjection(root, NOW).seatedRooms, 0);
  root.sessions[sessionId].status = "active";
  root.presence[sessionId][visitorUid].online = false;
  assert.equal(freeTablePublicStatsProjection(root, NOW).seatedRooms, 0);
  root.presence[sessionId][visitorUid].online = true;
  root.engagements[visitorUid].generation = 8;
  assert.equal(freeTablePublicStatsProjection(root, NOW).seatedRooms, 0);
});

test("public stats loader coalesces in-flight work and keeps only a short cache", async () => {
  let now = NOW;
  let loadCount = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const loader = createFreeTablePublicStatsLoader({
    load: async (startedAt) => {
      loadCount += 1;
      await gate;
      return Object.freeze({
        welcomingRooms: loadCount,
        seatedRooms: 0,
        updatedAt: startedAt,
      });
    },
    now: () => now,
  });
  const first = loader();
  const second = loader();
  await Promise.resolve();
  assert.equal(loadCount, 1);
  release();
  const [firstValue, secondValue] = await Promise.all([first, second]);
  assert.strictEqual(firstValue, secondValue);
  assert.equal((await loader()).welcomingRooms, 1);
  assert.equal(loadCount, 1);
  now += FREE_TABLE_PUBLIC_STATS_CACHE_TTL_MS;
  assert.equal((await loader()).welcomingRooms, 2);
  assert.equal(loadCount, 2);
});

test("public stats service reads indexed shelves and only targeted active-session paths", async () => {
  const {
    hostUid,
    root,
    sessionId,
    visitorUid,
  } = establishedPublicStatsRoot();
  const storedValues = {
    "freeTables/publicRooms": root.publicRooms,
    "freeTables/hostActive": root.hostActive,
    [`freeTables/sessions/${sessionId}`]: root.sessions[sessionId],
    [`freeTables/active/${hostUid}`]: root.active[hostUid],
    [`freeTables/active/${visitorUid}`]: root.active[visitorUid],
    [`freeTables/engagements/${hostUid}`]: root.engagements[hostUid],
    [`freeTables/engagements/${visitorUid}`]: root.engagements[visitorUid],
    [`freeTables/presence/${sessionId}`]: root.presence[sessionId],
  };
  const reads = [];
  const realtime = {
    ref(pathValue) {
      const query = {
        orderBy: "",
        startAt: null,
      };
      return {
        orderByChild(field) {
          query.orderBy = field;
          return this;
        },
        startAt(value) {
          query.startAt = value;
          return this;
        },
        async get() {
          reads.push({
            orderBy: query.orderBy,
            path: pathValue,
            startAt: query.startAt,
          });
          return {
            val: () => storedValues[pathValue] ?? null,
          };
        },
      };
    },
  };
  class TestHttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const service = createFreeTableService({
    firestore: {
      collection() {},
      getAll() {},
      runTransaction() {},
    },
    HttpsError: TestHttpsError,
    now: () => NOW,
    realtime,
    Timestamp: {},
  });
  const [first, second] = await Promise.all([
    service.getPublicStats({}),
    service.getPublicStats({}),
  ]);
  assert.deepEqual(first, {
    welcomingRooms: 0,
    seatedRooms: 1,
    updatedAt: NOW,
  });
  assert.strictEqual(first, second);
  assert.deepEqual(
    reads.filter((read) => read.orderBy).map((read) => read.path).sort(),
    ["freeTables/hostActive", "freeTables/publicRooms"],
  );
  assert.ok(
    reads.filter((read) => read.orderBy).every((read) => (
      read.orderBy === "expiresAt" && read.startAt === NOW + 1
    )),
  );
  assert.deepEqual(
    reads.filter((read) => !read.orderBy).map((read) => read.path).sort(),
    [
      `freeTables/active/${hostUid}`,
      `freeTables/active/${visitorUid}`,
      `freeTables/engagements/${hostUid}`,
      `freeTables/engagements/${visitorUid}`,
      `freeTables/presence/${sessionId}`,
      `freeTables/sessions/${sessionId}`,
    ].sort(),
  );
  await service.getPublicStats({});
  assert.equal(reads.length, 8);
  await assert.rejects(
    () => service.getPublicStats({ extra: true }),
    (error) => error.code === "invalid-argument",
  );
  assert.equal(reads.length, 8);
  assert.equal(reads.some((read) => read.path === "freeTables/presence"), false);
});

test("host-visible request projection contains a random member id but no uid", () => {
  const projection = publicRequestProjection({
    requestId: ID_A,
    publicMemberId: ID_B,
    hostUid: "secret-host",
    visitorUid: "secret-visitor",
    sourceInviteId: "I".repeat(32),
    visitorCard: card(),
    requestedAt: NOW,
    expiresAt: NOW + 120_000,
  });
  assert.deepEqual(Object.keys(projection), [
    "requestId",
    "publicMemberId",
    "visitorCard",
    "requestedAt",
    "expiresAt",
  ]);
  assert.doesNotMatch(JSON.stringify(projection), /secret-host|secret-visitor|Uid/);
  assert.equal(JSON.stringify(projection).includes("I".repeat(32)), false);
});

test("one host claim and one visitor pending claim stay unique while fresh", () => {
  const hostClaim = {
    roomId: ID_A,
    publicRoomId: ID_B,
    state: "open",
    generation: 1,
    heartbeatAt: NOW,
    expiresAt: NOW + 120_000,
  };
  const sameOpen = nextHostOpenClaim(hostClaim, {
    ...hostClaim,
    generation: 2,
    heartbeatAt: NOW + 1,
  }, NOW + 1);
  assert.equal(sameOpen.roomId, ID_A);
  assert.equal(sameOpen.generation, 2);
  assert.equal(nextHostOpenClaim({
    ...hostClaim,
    generation: 3,
  }, {
    ...hostClaim,
    generation: 2,
  }, NOW + 1), null);
  assert.equal(nextHostOpenClaim(hostClaim, {
    ...hostClaim,
    publicRoomId: ID_C,
  }, NOW + 1), null);
  assert.equal(nextHostOpenClaim({
    ...hostClaim,
    state: "active",
  }, hostClaim, NOW + 1), null);
  assert.equal(nextHostOpenClaim({
    ...hostClaim,
    state: "closing",
  }, hostClaim, NOW + 1), null);

  const pending = {
    requestId: ID_A,
    publicRoomId: ID_B,
    expiresAt: NOW + 120_000,
  };
  assert.equal(nextVisitorPendingClaim(pending, {
    requestId: ID_C,
    publicRoomId: ID_C,
    expiresAt: NOW + 120_000,
  }, NOW + 1), null);
  assert.equal(nextVisitorPendingClaim(pending, {
    requestId: ID_C,
    publicRoomId: ID_B,
    expiresAt: NOW + 120_000,
  }, NOW + 1).requestId, ID_A);
});

test("one room keeps at most sixteen live requests and prunes expired entries", () => {
  const liveRequests = {};
  for (let index = 0; index < FREE_TABLE_REQUEST_LIMIT; index += 1) {
    const requestId = String(index).padStart(24, "0");
    liveRequests[requestId] = {
      requestId,
      visitorUid: `visitor-${index}`,
      expiresAt: NOW + 1,
    };
  }
  const overflowId = "9".repeat(24);
  const overflow = nextRoomRequests(liveRequests, {
    requestId: overflowId,
    visitorUid: "overflow",
    expiresAt: NOW + 1,
  }, NOW);
  assert.equal(FREE_TABLE_REQUEST_LIMIT, 16);
  assert.equal(overflow.accepted, false);
  assert.equal(overflow.reason, "full");
  assert.equal(Object.keys(overflow.requests).length, FREE_TABLE_REQUEST_LIMIT);

  const firstRequestId = "0".repeat(24);
  const retry = nextRoomRequests(liveRequests, {
    ...liveRequests[firstRequestId],
    expiresAt: NOW + 2,
  }, NOW);
  assert.equal(retry.accepted, true);
  assert.equal(Object.keys(retry.requests).length, FREE_TABLE_REQUEST_LIMIT);

  liveRequests[firstRequestId] = {
    ...liveRequests[firstRequestId],
    expiresAt: NOW,
  };
  const afterExpiry = nextRoomRequests(liveRequests, {
    requestId: overflowId,
    visitorUid: "overflow",
    expiresAt: NOW + 1,
  }, NOW);
  assert.equal(afterExpiry.accepted, true);
  assert.equal(afterExpiry.pruned, true);
  assert.equal(Object.keys(afterExpiry.requests).length, FREE_TABLE_REQUEST_LIMIT);
});

test("one engagement claim prevents request-to-open and open-before-accept races", () => {
  const pending = {
    state: "visitor_pending",
    requestId: ID_A,
    roomId: ID_B,
    publicRoomId: ID_B,
    expiresAt: NOW + 120_000,
  };
  assert.equal(nextEngagementClaim(pending, {
    state: "host_open",
    roomId: ID_C,
    publicRoomId: ID_A,
    expiresAt: NOW + 120_000,
  }, NOW), null);

  const open = {
    state: "host_open",
    roomId: ID_A,
    publicRoomId: ID_B,
    expiresAt: NOW + 120_000,
  };
  assert.equal(nextEngagementClaim(open, {
    state: "visitor_pending",
    requestId: ID_C,
    roomId: ID_B,
    publicRoomId: ID_C,
    expiresAt: NOW + 120_000,
  }, NOW), null);

  const proposal = {
    hostUid: "host",
    visitorUid: "visitor",
    roomId: ID_B,
    requestId: ID_A,
    sessionId: ID_C,
    publicRoomId: ID_B,
    expiresAt: NOW + 7_200_000,
    requestedAt: NOW,
    requestExpiresAt: NOW + 120_000,
    hostHeartbeatAt: NOW,
    hostExpiresAt: NOW + 120_000,
  };
  const hostAdmission = nextHostAdmissionClaim(
    { ...open, roomId: ID_B },
    proposal,
    NOW,
  );
  const visitorAdmission = nextVisitorAdmissionClaim(
    { ...pending, hostUid: "host" },
    proposal,
    NOW,
  );
  const acceptedHost = nextFinalHostAdmissionClaim(
    hostAdmission,
    proposal,
    NOW,
  );
  assert.equal(hostAdmission.state, "host_admitting");
  assert.equal(visitorAdmission.state, "active");
  assert.equal(visitorAdmission.role, "visitor");
  assert.equal(acceptedHost.state, "active");
  assert.equal(acceptedHost.role, "host");
  assert.equal(acceptedHost.sessionId, ID_C);
  assert.equal(visitorAdmission.expiresAt, NOW + 7_200_000);
  assert.equal(nextEngagementClaim(visitorAdmission, {
    state: "host_open",
    roomId: ID_A,
    publicRoomId: ID_A,
    expiresAt: NOW + 120_000,
  }, NOW + 121_000), null);
  assert.equal(
    restoredHostOpenClaim(hostAdmission, proposal).state,
    "host_open",
  );
  assert.equal(
    restoredVisitorPendingClaim(visitorAdmission, proposal).state,
    "visitor_pending",
  );
  assert.equal(
    restoredHostOpenClaim(acceptedHost, proposal).state,
    "active",
  );
  assert.equal(
    restoredAcceptedHostOpenClaim(acceptedHost, proposal).state,
    "host_open",
  );
  assert.equal(
    restoredVisitorPendingClaim({
      ...visitorAdmission,
      sessionId: ID_A,
    }, proposal).sessionId,
    ID_A,
  );
});

test("pending cancellation is a first-class authenticated action with fenced cleanup", () => {
  assert.ok(FREE_TABLE_ACTIONS.includes("cancel_request"));
  const source = fs.readFileSync(
    path.join(__dirname, "..", "free-table.js"),
    "utf8",
  );
  const start = source.indexOf("async function cancelEntryRequest");
  const finish = source.indexOf("function createSession", start) >= 0
    ? source.indexOf("function createSession", start)
    : source.indexOf("async function respondToRequest", start);
  const cancellation = source.slice(start, finish);
  assert.match(cancellation, /current\.state === "visitor_pending"/);
  assert.match(cancellation, /current\.requestId === pending\.requestId/);
  assert.match(cancellation, /clearPendingIfMatches\(uid, pending\.requestId\)/);
  assert.match(cancellation, /requestRef\(pending\.roomId, pending\.requestId\)\.remove\(\)/);
  assert.match(cancellation, /request\.visitorUid !== uid/);
  assert.match(cancellation, /engagement\?\.state === "active"/);
  assert.match(cancellation, /active\?\.sessionId/);
});

test("RTDB transactions retry cold nulls and stale close cannot erase a new room", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "free-table.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /return next \|\| undefined|return undefined;/);
  const closeStart = source.indexOf("async function closeOpenRoom");
  const closeEnd = source.indexOf("async function openSpace", closeStart);
  const closeSource = source.slice(closeStart, closeEnd);
  assert.match(closeSource, /state: "closing"/);
  assert.match(closeSource, /state: "host_closing"/);
  assert.match(closeSource, /closeToken/);
  assert.match(closeSource, /publicRoomRef\(publicRoomId\)\.transaction/);
  assert.match(closeSource, /current\.roomId === roomId && current\.hostUid === uid/);

  const openStart = closeEnd;
  const openEnd = source.indexOf("async function listSpaces", openStart);
  const openSource = source.slice(openStart, openEnd);
  assert.match(openSource, /issueOpenGeneration\(uid\)/);
  assert.doesNotMatch(
    openSource,
    /\[`publicRooms\/\$\{savedSpace\.publicRoomId\}`\]: publicValue/,
  );
  assert.match(openSource, /roomStateRef\(roomId\)\.transaction/);
  assert.match(openSource, /currentGeneration > generation/);
  assert.match(openSource, /value\.generation === generation/);
  assert.match(
    openSource,
    /publicRoomRef\(savedSpace\.publicRoomId\)\.transaction[\s\S]*currentGeneration > generation/,
  );
  assert.match(
    openSource,
    /roomOwnerRef\(roomId\)\.transaction[\s\S]*current\?\.generation === generation/,
  );
});

test("admission and arrival avoid global engagement transactions and speculative session events", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "free-table.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /engagementsRef\(\)\.transaction/);
  const respondStart = source.indexOf("async function respondToRequest");
  const respondEnd = source.indexOf("async function finalizeSeatGrowth", respondStart);
  const respondSource = source.slice(respondStart, respondEnd);
  assert.match(respondSource, /nextHostAdmissionClaim/);
  assert.match(source, /state: "host_admitting"/);
  assert.match(respondSource, /restoreHostAdmission/);
  assert.match(respondSource, /restoreVisitorAdmission/);
  assert.match(respondSource, /restoreAdmissionRoom/);
  assert.match(respondSource, /engagementRef\(session\.hostUid\)\.transaction/);
  assert.match(respondSource, /engagementRef\(session\.visitorUid\)\.transaction/);

  const refreshStart = source.indexOf("async function refreshEstablishedClaims");
  const refreshEnd = source.indexOf("async function arriveAtSession", refreshStart);
  const refreshSource = source.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /\[session\.hostUid, session\.visitorUid\]\.map/);
  assert.doesNotMatch(refreshSource, /engagementsRef/);

  const endStart = source.indexOf("async function endSessionInternal");
  const endEnd = source.indexOf("async function endSession(uid", endStart);
  assert.ok(
    (source.slice(endStart, endEnd).match(/undefined,\s*false/g) || []).length >= 3,
  );
  assert.doesNotMatch(source, /activeRef\(uid\)\.update\(\{ heartbeatAt: now \}\)/);
  const heartbeatStart = source.indexOf("async function refreshActiveHeartbeatIfMatches");
  const heartbeatEnd = source.indexOf(
    "async function releaseOrphanedParticipantClaims",
    heartbeatStart,
  );
  const heartbeatSource = source.slice(heartbeatStart, heartbeatEnd);
  assert.match(heartbeatSource, /current\?\.sessionId === sessionId/);
  assert.match(heartbeatSource, /Number\(current\.expiresAt \|\| 0\) > now/);
  assert.match(heartbeatSource, /undefined,\s*false/);
});

test("a block in either direction prevents contact", () => {
  assert.equal(blockedInEitherDirection(true, false), true);
  assert.equal(blockedInEitherDirection(false, true), true);
  assert.equal(blockedInEitherDirection(false, false), false);
});

test("polling block filters use bounded pair batches without per-room awaits", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "free-table.js"),
    "utf8",
  );
  const listStart = source.indexOf("async function listSpaces");
  const listEnd = source.indexOf("async function requestEntry", listStart);
  const listSource = source.slice(listStart, listEnd);
  assert.equal(FREE_TABLE_LIST_SCAN_LIMIT, 80);
  assert.match(listSource, /readBoundedPublicRoomWindow\(uid, now\)/);
  assert.doesNotMatch(listSource, /publicRoomsRef\(\)\.get\(\)/);
  assert.match(listSource, /\.slice\(0, FREE_TABLE_LIST_SCAN_LIMIT\)/);
  assert.match(listSource, /filterUnblockedCandidates/);
  assert.doesNotMatch(listSource, /pairIsBlocked|identityForPublicMember/);
  assert.match(source, /firestore\.getAll\(\s*\.\.\.chunk\.map/s);

  const stateStart = source.indexOf("async function getMyState");
  const stateEnd = source.indexOf(
    "async function cleanupExpiredFirestoreCollection",
    stateStart,
  );
  const stateSource = source.slice(stateStart, stateEnd);
  assert.match(stateSource, /peerUids\.map\(\(peerUid\) => blockPairRef/);
  assert.match(stateSource, /firestore\.getAll/);
  assert.doesNotMatch(stateSource, /pairIsBlocked/);
  assert.doesNotMatch(source, /blockedByCollection/);

  const blockStart = source.indexOf("async function setBlock");
  const blockEnd = source.indexOf("async function submitReport", blockStart);
  const blockSource = source.slice(blockStart, blockEnd);
  assert.match(blockSource, /transaction\.set\(pairReference/);
  assert.match(blockSource, /transaction\.delete\(pairReference\)/);
  assert.match(blockSource, /transaction\.set\(relationshipReference/);
  assert.match(blockSource, /blockTokens/);
  assert.match(blockSource, /blockOperationIsCurrent/);
  assert.match(blockSource, /operationToken/);
  assert.match(blockSource, /transaction\.delete\(bookmarkRef/);
  assert.doesNotMatch(
    blockSource,
    /bookmarkRef\([^)]*\)\.delete\(\)/,
  );
});

test("public shelf cursor is stable within a rotation and changes without exposing uid", () => {
  const first = fairShelfCursor("viewer-secret-uid", NOW);
  const sameRotation = fairShelfCursor(
    "viewer-secret-uid",
    NOW + (14 * 60 * 1000),
  );
  const nextRotation = fairShelfCursor(
    "viewer-secret-uid",
    NOW + (15 * 60 * 1000),
  );
  assert.match(first, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(first, sameRotation);
  assert.notEqual(first, nextRotation);
  assert.doesNotMatch(first, /viewer|secret|uid/i);

  const source = fs.readFileSync(
    path.join(__dirname, "..", "free-table.js"),
    "utf8",
  );
  const readStart = source.indexOf("async function readBoundedPublicRoomWindow");
  const readEnd = source.indexOf("async function saveSpace", readStart);
  const readSource = source.slice(readStart, readEnd);
  assert.match(readSource, /\.orderByKey\(\)/);
  assert.match(readSource, /\.startAt\(cursor\)/);
  assert.match(readSource, /\.limitToFirst\(FREE_TABLE_LIST_SCAN_LIMIT\)/);
  assert.match(
    readSource,
    /\.limitToFirst\(FREE_TABLE_LIST_SCAN_LIMIT - rooms\.size\)/,
  );
  assert.doesNotMatch(readSource, /orderByChild/);
});

test("concurrent accepts can materialize only the first accepted session", () => {
  const first = nextAdmissionState(openRoom(), {
    hostUid: "host",
    requestId: ID_A,
    accept: true,
    sessionId: ID_C,
    now: NOW,
  });
  assert.equal(first.state, "active");
  assert.equal(first.acceptedRequestId, ID_A);
  assert.equal(first.session.sessionId, ID_C);
  assert.equal(first.session.admissionAccepted, true);

  const losingConcurrentAccept = nextAdmissionState(first, {
    hostUid: "host",
    requestId: ID_B,
    accept: true,
    sessionId: "D".repeat(24),
    now: NOW,
  });
  assert.equal(losingConcurrentAccept, null);

  const idempotentRetry = nextAdmissionState(first, {
    hostUid: "host",
    requestId: ID_A,
    accept: true,
    sessionId: "E".repeat(24),
    now: NOW,
  });
  assert.equal(idempotentRetry.session.sessionId, ID_C);
});

test("expired-room cleanup claims only the same stale generation and never an in-flight admission", () => {
  const expiredOpen = {
    ...openRoom(),
    expiresAt: NOW,
  };
  const cleanupToken = "D".repeat(24);
  const claimed = nextExpiredRoomCleanupClaim(expiredOpen, {
    roomId: ID_A,
    publicRoomId: ID_B,
    hostUid: "host",
    cleanupToken,
    now: NOW,
  });
  assert.equal(claimed.state, "expiring");
  assert.equal(claimed.cleanupFromState, "open");
  assert.equal(claimed.cleanupToken, cleanupToken);
  assert.equal(
    nextExpiredRoomCleanupClaim({
      ...expiredOpen,
      expiresAt: NOW + 1,
    }, {
      roomId: ID_A,
      publicRoomId: ID_B,
      hostUid: "host",
      cleanupToken,
      now: NOW,
    }),
    null,
  );
  const admission = nextAdmissionState({
    ...expiredOpen,
    expiresAt: NOW + 1,
  }, {
    hostUid: "host",
    requestId: ID_A,
    accept: true,
    sessionId: ID_C,
    now: NOW,
  });
  assert.equal(admission.state, "active");
  assert.equal(
    nextExpiredRoomCleanupClaim(admission, {
      roomId: ID_A,
      publicRoomId: ID_B,
      hostUid: "host",
      cleanupToken,
      now: NOW + 1,
    }),
    null,
  );
  const abandonedAdmission = {
    ...admission,
    expiresAt: NOW,
    session: {
      ...admission.session,
      expiresAt: NOW,
    },
  };
  const reclaimed = nextExpiredRoomCleanupClaim(abandonedAdmission, {
    roomId: ID_A,
    publicRoomId: ID_B,
    hostUid: "host",
    cleanupToken,
    now: NOW,
  });
  assert.equal(reclaimed.state, "expiring");
  assert.equal(reclaimed.cleanupFromState, "active");
  assert.equal(
    nextExpiredRoomCleanupClaim(expiredOpen, {
      roomId: ID_A,
      publicRoomId: ID_B,
      hostUid: "another-host",
      cleanupToken,
      now: NOW,
    }),
    null,
  );
});

test("disconnect cleanup keeps an explicit grace window before releasing an established seat", () => {
  assert.equal(FREE_TABLE_DISCONNECT_GRACE_MS, 2 * 60 * 1000);
  const source = fs.readFileSync(
    path.join(__dirname, "..", "free-table.js"),
    "utf8",
  );
  const reconcileStart = source.indexOf("async function reconcileDisconnectedSession");
  const reconcileEnd = source.indexOf("async function endSession(uid", reconcileStart);
  const reconcileSource = source.slice(reconcileStart, reconcileEnd);
  assert.match(reconcileSource, /presenceRef\(sessionId\)\.transaction/);
  assert.doesNotMatch(reconcileSource, /freeTablesRoot\(\)\.transaction/);
  assert.match(reconcileSource, /recheckAt: now \+ FREE_TABLE_DISCONNECT_GRACE_MS/);
  assert.match(reconcileSource, /state: "locked"/);
  assert.match(reconcileSource, /sessionRef\(sessionId\)\.transaction/);
  assert.match(source, /clearActiveIfMatches\(session\.hostUid, session\.sessionId\)/);
  assert.match(reconcileSource, /status: "ended"/);
  assert.match(reconcileSource, /normalizedEnding\("disconnected"/);
});

test("growth waits for both authenticated role arrivals and arrival retries are idempotent", () => {
  const session = acceptedSessionValue(
    openRoom(),
    openRoom().requests[ID_A],
    ID_C,
    NOW,
  );
  assert.equal(session.expiresAt, NOW + FREE_TABLE_CONNECTING_TTL_MS);
  assert.equal(session.hardExpiresAt, NOW + (2 * 60 * 60 * 1000));
  const hostOnly = nextArrivalState(session, "host", NOW + 1);
  assert.deepEqual(hostOnly.arrivals, { host: true, visitor: false });
  assert.equal(hostOnly.p2pConnected, false);
  assert.equal(hostOnly.status, "connecting");

  const hostRetry = nextArrivalState(hostOnly, "host", NOW + 2);
  assert.deepEqual(hostRetry.arrivals, { host: true, visitor: false });
  assert.equal(hostRetry.p2pConnected, false);

  const established = nextArrivalState(hostRetry, "visitor-a", NOW + 3);
  assert.deepEqual(established.arrivals, { host: true, visitor: true });
  assert.equal(established.p2pConnected, true);
  assert.equal(established.status, "active");
  assert.equal(established.expiresAt, established.hardExpiresAt);
  assert.equal(nextArrivalState(established, "outsider", NOW + 4), null);

  const publicSession = publicSessionProjection("host", established);
  assert.equal(publicSession.seatEstablished, true);
  assert.deepEqual(publicSession.negotiatedMedia, {
    text: true,
    image: true,
    audio: false,
    video: false,
  });
  assert.equal(publicSession.you.card.name, "夜更かし店主");
  assert.equal(publicSession.peer.card.name, "旅人A");
  assert.equal("hostUid" in publicSession, false);
  assert.equal("visitorUid" in publicSession, false);
});

test("pair growth merges reconnects through exactly 30 minutes and caps growth for 12 hours", () => {
  const initial = pairGrowthDecision({}, {}, ID_A, NOW);
  assert.deepEqual(initial, {
    visitId: ID_A,
    integrated: false,
    grew: true,
    growth: { visitCount: 1, growthCount: 1, stage: 1 },
  });

  const pair = {
    lastVisitId: ID_A,
    lastVisitAt: NOW,
    lastEndedAt: NOW + 10_000,
    lastGrowthAt: NOW,
  };
  const exactBoundary = pairGrowthDecision(
    pair,
    initial.growth,
    ID_B,
    NOW + 10_000 + FREE_TABLE_RECONNECT_MERGE_MS,
  );
  assert.equal(exactBoundary.integrated, true);
  assert.equal(exactBoundary.visitId, ID_A);
  assert.equal(exactBoundary.growth.visitCount, 1);

  const outsideMergeInsideCooldown = pairGrowthDecision(
    pair,
    initial.growth,
    ID_B,
    NOW + 10_001 + FREE_TABLE_RECONNECT_MERGE_MS,
  );
  assert.equal(outsideMergeInsideCooldown.integrated, false);
  assert.equal(outsideMergeInsideCooldown.grew, false);
  assert.deepEqual(outsideMergeInsideCooldown.growth, {
    visitCount: 2,
    growthCount: 1,
    stage: 1,
  });

  const cooldownComplete = pairGrowthDecision(
    pair,
    initial.growth,
    ID_B,
    NOW + FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS,
  );
  assert.equal(cooldownComplete.grew, true);
  assert.equal(cooldownComplete.growth.growthCount, 2);
  assert.equal(growthStage(0), 0);
  assert.equal(growthStage(30), 5);
  assert.deepEqual(ownerGrowthProjection({ growthCount: 0 }).topicToolbox, []);
  assert.deepEqual(ownerGrowthProjection({ growthCount: 3 }).topicToolbox, [
    "いま食べたい一品",
    "最近見つけた小さな景色",
  ]);
  assert.equal(ownerGrowthProjection({ growthCount: 30 }).stageId, "sendoff");
});

test("report evidence includes only selected, bounded, participant-authored recent chat", () => {
  const session = {
    hostUid: "host",
    visitorUid: "visitor",
    participants: { host: true, visitor: true },
  };
  const entries = [
    {
      messageId: ID_A,
      message: {
        authorUid: "visitor",
        authorRole: "visitor",
        type: "text",
        text: "選択された発言",
        createdAt: NOW - 1_000,
      },
    },
    {
      messageId: ID_B,
      message: {
        authorUid: "visitor",
        authorRole: "visitor",
        type: "text",
        text: "選択されていない発言",
        createdAt: NOW - 1_000,
      },
    },
    {
      messageId: ID_C,
      message: {
        authorUid: "outsider",
        authorRole: "visitor",
        type: "text",
        text: "部外者",
        createdAt: NOW - 1_000,
      },
    },
    {
      messageId: "D".repeat(24),
      message: {
        authorUid: "host",
        authorRole: "host",
        type: "text",
        text: "古すぎる発言",
        createdAt: NOW - (31 * 60 * 1000),
      },
    },
  ];
  const evidence = selectReportEvidence(
    entries,
    [ID_A, ID_C, "D".repeat(24)],
    session,
    NOW,
  );
  assert.deepEqual(evidence, [{
    messageId: ID_A,
    authorUid: "visitor",
    authorRole: "visitor",
    text: "選択された発言",
    createdAt: NOW - 1_000,
  }]);
  const source = fs.readFileSync(
    path.join(__dirname, "..", "free-table.js"),
    "utf8",
  );
  const reportStart = source.indexOf("async function submitReport");
  const reportEnd = source.indexOf("function publicBookmark", reportStart);
  const reportSource = source.slice(reportStart, reportEnd);
  assert.match(reportSource, /\.filter\(\(id\) => typeof id === "string"/);
  assert.match(reportSource, /\.orderByChild\("createdAt"\)/);
  assert.match(reportSource, /\.limitToLast\(FREE_TABLE_REPORT_CHAT_SCAN_LIMIT\)/);
  assert.match(reportSource, /message\?\.authorUid !== targetUid/);
  assert.match(reportSource, /\.filter\(\(entry\) => entry\.authorUid === targetUid\)/);
  assert.match(reportSource, /internalReportId\(sessionId, uid\)/);
  assert.match(reportSource, /firestore\.runTransaction/);
  assert.match(reportSource, /transaction\.create\(reference, proposedReport\)/);
  assert.doesNotMatch(reportSource, /messageIds\.some/);
});

test("departure copy uses the canonical gentle hiragana and no result vocabulary", () => {
  assert.equal(normalizeDepartureLine("おなかがすきました"), "おなかがすきました。いってきます");
  const source = fs.readFileSync(
    path.join(__dirname, "..", "free-table.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /recordOverallResult|commitOnlineStats|AnjuPay|debitPoints|creditPoints/);
  const endStart = source.indexOf("async function endSessionInternal");
  const endFinish = source.indexOf("async function endSession(uid", endStart);
  const endingSource = source.slice(endStart, endFinish);
  assert.match(
    endingSource,
    /clearHostActiveIfMatches\(session\.hostUid, session\.sessionId\)/,
  );
  assert.match(
    endingSource,
    /clearEngagementIfMatches\(session\.hostUid, "sessionId", session\.sessionId\)/,
  );
  const finalizeStart = endingSource.indexOf(
    "async function finalizeEndedSessionResources",
  );
  const finalizeEnd = endingSource.indexOf(
    "async function releaseDisconnectLock",
    finalizeStart,
  );
  const finalizeSource = endingSource.slice(finalizeStart, finalizeEnd);
  assert.match(finalizeSource, /presenceRef\(session\.sessionId\)\.remove\(\)/);
  assert.match(finalizeSource, /signalsRef\(session\.sessionId\)\.remove\(\)/);
  assert.doesNotMatch(finalizeSource, /chatRef\(session\.sessionId\)\.remove\(\)/);
  assert.doesNotMatch(endingSource, /reopen|publicRooms/);
  const closeStart = source.indexOf("async function closeOpenRoom");
  const closeFinish = source.indexOf("async function openSpace", closeStart);
  assert.match(
    source.slice(closeStart, closeFinish),
    /clearEngagementIfMatches\(request\.visitorUid, "requestId", request\.requestId\)/,
  );
});
