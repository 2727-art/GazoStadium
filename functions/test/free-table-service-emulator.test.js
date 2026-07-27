"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");

const RUN_FLAG = "RUN_FREE_TABLE_SERVICE_EMULATOR_TESTS";
const PROJECT_ID_ENV = "FREE_TABLE_SERVICE_TEST_PROJECT_ID";
const RUN_REQUESTED = process.env[RUN_FLAG] === "1";
const PROJECT_ID = String(process.env[PROJECT_ID_ENV] || "");

function requireLoopbackTarget(rawValue, label) {
  const value = String(rawValue || "").trim();
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(value)) {
    throw new Error(`${label} must be an explicit loopback host and port.`);
  }
  return value;
}

function requireDemoProjectId(value) {
  if (!/^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(value)) {
    throw new Error(`${PROJECT_ID_ENV} must be an explicit demo-* project ID.`);
  }
  return value;
}

if (!RUN_REQUESTED) {
  test("free table service emulator test is opt-in and never uses production", {
    skip: `set ${RUN_FLAG}=1 and ${PROJECT_ID_ENV}=demo-* inside Firebase emulators`,
  }, () => {});
} else {
  const projectId = requireDemoProjectId(PROJECT_ID);
  requireLoopbackTarget(
    process.env.FIREBASE_DATABASE_EMULATOR_HOST,
    "FIREBASE_DATABASE_EMULATOR_HOST",
  );
  requireLoopbackTarget(
    process.env.FIRESTORE_EMULATOR_HOST,
    "FIRESTORE_EMULATOR_HOST",
  );

  const {
    deleteApp,
    initializeApp,
  } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const {
    Timestamp,
    getFirestore,
  } = require("firebase-admin/firestore");
  const { HttpsError } = require("firebase-functions/v2/https");
  const {
    FREE_TABLE_DISCONNECT_GRACE_MS,
    FREE_TABLE_ENDED_RETENTION_MS,
    FREE_TABLE_INVITE_TTL_MS,
    FREE_TABLE_REQUEST_LIMIT,
    createFreeTableService,
  } = require("../free-table");

  const suffix = crypto.randomUUID().replaceAll("-", "");
  const hostUid = `free-table-host-${suffix}`;
  const visitorUid = `free-table-visitor-${suffix}`;
  let clock = 1_900_000_000_000;
  let app;
  let firestore;
  let realtime;
  let service;

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
  const visitorCard = Object.freeze({
    name: "夜道の旅人",
    activityTag: "言葉でひと休み",
    message: "今日の一品を持ってきました。",
    roleplayLevel: "light",
    media: {
      text: true,
      image: true,
      audio: false,
      video: false,
    },
  });

  before(async () => {
    app = initializeApp({
      projectId,
      databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
    }, `free-table-service-${suffix}`);
    firestore = getFirestore(app);
    realtime = getDatabase(app);
    service = createFreeTableService({
      firestore,
      realtime,
      HttpsError,
      Timestamp,
      now: () => clock,
    });
    await realtime.ref("freeTables").remove();
  });

  after(async () => {
    if (app) await deleteApp(app);
  });

  async function perform(uid, action, fields = {}) {
    return service.performAction(uid, { action, ...fields });
  }

  function createBlockCommitPause(blockDocumentPath) {
    let releasePause = () => {};
    let signalCommit = () => {};
    let delayed = false;
    const committed = new Promise((resolve) => {
      signalCommit = resolve;
    });
    const released = new Promise((resolve) => {
      releasePause = resolve;
    });
    const pausingFirestore = {
      collection: firestore.collection.bind(firestore),
      getAll: firestore.getAll.bind(firestore),
      async runTransaction(updateFunction, ...options) {
        let wroteTargetBlock = false;
        const result = await firestore.runTransaction(
          async (transaction) => updateFunction(new Proxy(transaction, {
            get(target, property) {
              if (property === "set") {
                return (reference, ...argumentsList) => {
                  if (reference?.path === blockDocumentPath) wroteTargetBlock = true;
                  return target.set(reference, ...argumentsList);
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          })),
          ...options,
        );
        if (wroteTargetBlock && !delayed) {
          delayed = true;
          signalCommit();
          await released;
        }
        return result;
      },
    };
    const pausingService = createFreeTableService({
      firestore: pausingFirestore,
      realtime,
      HttpsError,
      Timestamp,
      now: () => clock,
    });
    return {
      committed,
      perform: (uid, action, fields = {}) => (
        pausingService.performAction(uid, { action, ...fields })
      ),
      release: () => releasePause(),
    };
  }

  async function completeSeat() {
    const opened = await perform(hostUid, "open", { active: true });
    assert.equal(opened.opened, true);
    const listed = await perform(visitorUid, "list");
    const room = listed.rooms.find((candidate) => (
      candidate.publicRoomId === opened.room.publicRoomId
    ));
    assert.ok(room);
    assert.equal("hostUid" in room, false);
    assert.equal("roomId" in room, false);

    const requested = await perform(visitorUid, "request", {
      publicRoomId: room.publicRoomId,
      visitorCard,
    });
    const hostState = await perform(hostUid, "get_my_state");
    assert.equal(hostState.requests.length, 1);
    assert.equal("visitorUid" in hostState.requests[0], false);

    const accepted = await perform(hostUid, "respond", {
      requestId: requested.request.requestId,
      accept: true,
    });
    const sessionId = accepted.session.sessionId;
    assert.ok(sessionId);
    assert.equal("hostUid" in accepted.session, false);
    assert.equal("visitorUid" in accepted.session, false);

    const hostArrival = await perform(hostUid, "arrive", { sessionId });
    assert.equal(hostArrival.established, false);
    const visitorArrival = await perform(visitorUid, "arrive", { sessionId });
    assert.equal(visitorArrival.established, true);
    assert.equal(visitorArrival.seatEstablished, true);

    const ended = await perform(visitorUid, "end", {
      sessionId,
      reason: "departure",
      message: "おなかがすきました",
    });
    assert.equal(ended.ended, true);
    assert.equal(ended.session.ending.line.endsWith("いってきます"), true);
    const paused = await perform(visitorUid, "list");
    assert.equal(
      paused.rooms.some((candidate) => candidate.publicRoomId === room.publicRoomId),
      false,
    );
    return sessionId;
  }

  test("real emulator flow keeps the shelf private, records only established seats, and pauses", async () => {
    await perform(hostUid, "save_space", { space, hostCard });

    const firstSessionId = await completeSeat();
    let saved = (await firestore.doc(`freeTableSpaces/${hostUid}`).get()).data();
    assert.deepEqual(saved.growth, {
      visitCount: 1,
      growthCount: 1,
      stage: 1,
    });
    const repeatedEnd = await perform(visitorUid, "end", {
      sessionId: firstSessionId,
      reason: "departure",
      message: "同じお開きの再送",
    });
    assert.equal(repeatedEnd.ended, true);
    saved = (await firestore.doc(`freeTableSpaces/${hostUid}`).get()).data();
    assert.deepEqual(saved.growth, {
      visitCount: 1,
      growthCount: 1,
      stage: 1,
    });

    clock += 10 * 60 * 1000;
    await completeSeat();
    saved = (await firestore.doc(`freeTableSpaces/${hostUid}`).get()).data();
    assert.deepEqual(saved.growth, {
      visitCount: 1,
      growthCount: 1,
      stage: 1,
    });

    clock += 31 * 60 * 1000;
    await completeSeat();
    saved = (await firestore.doc(`freeTableSpaces/${hostUid}`).get()).data();
    assert.deepEqual(saved.growth, {
      visitCount: 2,
      growthCount: 1,
      stage: 1,
    });

    const reopened = await perform(hostUid, "open", { active: true });
    const hostPublicMemberId = saved.publicMemberId;
    assert.ok(hostPublicMemberId);
    await perform(visitorUid, "block", {
      publicMemberId: hostPublicMemberId,
    });
    let blockedShelf = await perform(visitorUid, "list");
    assert.equal(
      blockedShelf.rooms.some((room) => room.publicRoomId === reopened.room.publicRoomId),
      false,
    );
    await perform(visitorUid, "unblock", {
      publicMemberId: hostPublicMemberId,
    });
    blockedShelf = await perform(visitorUid, "list");
    assert.equal(
      blockedShelf.rooms.some((room) => room.publicRoomId === reopened.room.publicRoomId),
      true,
    );
    const closed = await perform(hostUid, "open", { active: false });
    assert.equal(closed.closed, true);
    const closedShelf = await perform(visitorUid, "list");
    assert.equal(
      closedShelf.rooms.some((room) => room.publicRoomId === reopened.room.publicRoomId),
      false,
    );

    const active = await realtime.ref(`freeTables/active/${hostUid}`).get();
    const hostOpen = await realtime.ref(`freeTables/hostActive/${hostUid}`).get();
    assert.equal(active.exists(), false);
    assert.equal(hostOpen.exists(), false);
  });

  test("an older open generation cannot overwrite or roll back a newer shelf heartbeat", async (t) => {
    const generationHostUid = `generation-host-${suffix}`;
    await perform(generationHostUid, "save_space", { space, hostCard });
    const saved = (
      await firestore.doc(`freeTableSpaces/${generationHostUid}`).get()
    ).data();
    const publicRoomId = saved.publicRoomId;
    let releaseMaterialization = () => {};
    let signalMaterialization = () => {};
    let delayed = false;
    const materializationReached = new Promise((resolve) => {
      signalMaterialization = resolve;
    });
    const materializationReleased = new Promise((resolve) => {
      releaseMaterialization = resolve;
    });
    t.after(() => releaseMaterialization());
    const delayedRealtime = {
      ref(pathValue) {
        const reference = realtime.ref(pathValue);
        return new Proxy(reference, {
          get(target, property) {
            if (property === "transaction"
                && pathValue === `freeTables/publicRooms/${publicRoomId}`) {
              return async (...argumentsList) => {
                if (!delayed) {
                  delayed = true;
                  signalMaterialization();
                  await materializationReleased;
                }
                return target.transaction(...argumentsList);
              };
            }
            if (property === "update" && pathValue === "freeTables") {
              return async (updates) => {
                const publicWrite = updates?.[`publicRooms/${publicRoomId}`];
                if (!delayed && publicWrite) {
                  delayed = true;
                  signalMaterialization();
                  await materializationReleased;
                }
                return target.update(updates);
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    const delayedService = createFreeTableService({
      firestore,
      realtime: delayedRealtime,
      HttpsError,
      Timestamp,
      now: () => clock,
    });
    const firstOpen = delayedService.performAction(generationHostUid, {
      action: "open",
      active: true,
    });
    await materializationReached;
    const firstClaim = (
      await realtime.ref(`freeTables/hostActive/${generationHostUid}`).get()
    ).val();
    assert.ok(firstClaim?.generation);

    clock += 1;
    const secondOpen = await perform(generationHostUid, "open", { active: true });
    const secondClaim = (
      await realtime.ref(`freeTables/hostActive/${generationHostUid}`).get()
    ).val();
    assert.equal(secondClaim.roomId, firstClaim.roomId);
    assert.ok(secondClaim.generation > firstClaim.generation);
    const secondGeneration = secondClaim.generation;
    const secondHeartbeatAt = secondClaim.heartbeatAt;
    releaseMaterialization();
    await assert.rejects(
      firstOpen,
      (error) => error?.code === "aborted",
    );

    const [publicShelf, owner, roomState, engagement] = await Promise.all([
      realtime.ref(`freeTables/publicRooms/${publicRoomId}`).get(),
      realtime.ref(`freeTables/roomOwners/${secondClaim.roomId}`).get(),
      realtime.ref(`freeTables/roomStates/${secondClaim.roomId}`).get(),
      realtime.ref(`freeTables/engagements/${generationHostUid}`).get(),
    ]);
    for (const snapshot of [publicShelf, owner, roomState, engagement]) {
      assert.equal(snapshot.val()?.generation, secondGeneration);
    }
    assert.equal(publicShelf.val()?.heartbeatAt, secondHeartbeatAt);
    assert.equal(secondOpen.room.publicRoomId, publicRoomId);
    await perform(generationHostUid, "open", { active: false });
  });

  test("a stale block cleanup cannot end a session or delete bookmarks after unblock", async (t) => {
    const blockHostUid = `block-session-host-${suffix}`;
    const blockVisitorUid = `block-session-visitor-${suffix}`;
    await perform(blockHostUid, "save_space", { space, hostCard });
    await perform(blockVisitorUid, "save_space", {
      space: { ...space, name: "旅人の休憩所" },
      hostCard: visitorCard,
    });
    const [hostSpace, visitorSpace] = await Promise.all([
      firestore.doc(`freeTableSpaces/${blockHostUid}`).get(),
      firestore.doc(`freeTableSpaces/${blockVisitorUid}`).get(),
    ]);
    const hostPublicMemberId = hostSpace.data().publicMemberId;
    const hostPublicRoomId = hostSpace.data().publicRoomId;
    const visitorPublicRoomId = visitorSpace.data().publicRoomId;
    const opened = await perform(blockHostUid, "open", { active: true });
    const requested = await perform(blockVisitorUid, "request", {
      publicRoomId: opened.room.publicRoomId,
      visitorCard,
    });
    const accepted = await perform(blockHostUid, "respond", {
      requestId: requested.request.requestId,
      accept: true,
    });
    const sessionId = accepted.session.sessionId;
    const pause = createBlockCommitPause(
      `freeTableBlocks/${blockVisitorUid}/users/${hostPublicMemberId}`,
    );
    t.after(() => pause.release());
    const staleBlock = pause.perform(blockVisitorUid, "block", {
      publicMemberId: hostPublicMemberId,
    });
    await pause.committed;
    await perform(blockVisitorUid, "unblock", {
      publicMemberId: hostPublicMemberId,
    });
    await Promise.all([
      perform(blockVisitorUid, "bookmark", {
        publicRoomId: hostPublicRoomId,
        active: true,
      }),
      perform(blockHostUid, "bookmark", {
        publicRoomId: visitorPublicRoomId,
        active: true,
      }),
    ]);
    pause.release();
    await assert.rejects(
      staleBlock,
      (error) => error?.code === "aborted",
    );

    const [session, hostActive, visitorActive, visitorBookmark, hostBookmark] =
      await Promise.all([
        realtime.ref(`freeTables/sessions/${sessionId}`).get(),
        realtime.ref(`freeTables/active/${blockHostUid}`).get(),
        realtime.ref(`freeTables/active/${blockVisitorUid}`).get(),
        firestore
          .doc(`freeTableBookmarks/${blockVisitorUid}/rooms/${hostPublicRoomId}`)
          .get(),
        firestore
          .doc(`freeTableBookmarks/${blockHostUid}/rooms/${visitorPublicRoomId}`)
          .get(),
      ]);
    assert.equal(session.val()?.status, "connecting");
    assert.equal(hostActive.val()?.sessionId, sessionId);
    assert.equal(visitorActive.val()?.sessionId, sessionId);
    assert.equal(visitorBookmark.exists, true);
    assert.equal(hostBookmark.exists, true);

    await perform(blockVisitorUid, "end", {
      sessionId,
      reason: "safe_exit",
    });
    await Promise.all([
      perform(blockVisitorUid, "bookmark", {
        publicRoomId: hostPublicRoomId,
        active: false,
      }),
      perform(blockHostUid, "bookmark", {
        publicRoomId: visitorPublicRoomId,
        active: false,
      }),
    ]);
  });

  test("a stale block cleanup cannot remove a request created after unblock", async (t) => {
    const blockHostUid = `block-request-host-${suffix}`;
    const blockVisitorUid = `block-request-visitor-${suffix}`;
    await perform(blockHostUid, "save_space", { space, hostCard });
    await perform(blockVisitorUid, "save_space", {
      space: { ...space, name: "来訪者の休憩所" },
      hostCard: visitorCard,
    });
    const hostSpace = (
      await firestore.doc(`freeTableSpaces/${blockHostUid}`).get()
    ).data();
    const opened = await perform(blockHostUid, "open", { active: true });
    const pause = createBlockCommitPause(
      `freeTableBlocks/${blockVisitorUid}/users/${hostSpace.publicMemberId}`,
    );
    t.after(() => pause.release());
    const staleBlock = pause.perform(blockVisitorUid, "block", {
      publicMemberId: hostSpace.publicMemberId,
    });
    await pause.committed;
    await perform(blockVisitorUid, "unblock", {
      publicMemberId: hostSpace.publicMemberId,
    });
    const requested = await perform(blockVisitorUid, "request", {
      publicRoomId: opened.room.publicRoomId,
      visitorCard,
    });
    pause.release();
    await assert.rejects(
      staleBlock,
      (error) => error?.code === "aborted",
    );

    const roomId = (
      await realtime.ref(`freeTables/hostActive/${blockHostUid}`).get()
    ).val()?.roomId;
    const requestId = requested.request.requestId;
    const [pending, engagement, publicRequest, roomState] = await Promise.all([
      realtime.ref(`freeTables/visitorPending/${blockVisitorUid}`).get(),
      realtime.ref(`freeTables/engagements/${blockVisitorUid}`).get(),
      realtime.ref(`freeTables/requests/${roomId}/${requestId}`).get(),
      realtime.ref(`freeTables/roomStates/${roomId}`).get(),
    ]);
    assert.equal(pending.val()?.requestId, requestId);
    assert.equal(engagement.val()?.requestId, requestId);
    assert.equal(publicRequest.val()?.requestId, requestId);
    assert.equal(roomState.val()?.requests?.[requestId]?.requestId, requestId);

    await perform(blockVisitorUid, "cancel_request");
    await perform(blockHostUid, "open", { active: false });
  });

  test("one host inbox is bounded and a rejected overflow leaves no visitor claim", async () => {
    const boundedHostUid = `bounded-host-${suffix}`;
    await perform(boundedHostUid, "save_space", { space, hostCard });
    const opened = await perform(boundedHostUid, "open", { active: true });
    for (let index = 0; index < FREE_TABLE_REQUEST_LIMIT; index += 1) {
      await perform(`bounded-visitor-${index}-${suffix}`, "request", {
        publicRoomId: opened.room.publicRoomId,
        visitorCard,
      });
    }
    const overflowUid = `bounded-overflow-${suffix}`;
    await assert.rejects(
      perform(overflowUid, "request", {
        publicRoomId: opened.room.publicRoomId,
        visitorCard,
      }),
      (error) => error?.code === "resource-exhausted",
    );
    const hostState = await perform(boundedHostUid, "get_my_state");
    assert.equal(hostState.requests.length, FREE_TABLE_REQUEST_LIMIT);
    assert.equal(
      (await realtime.ref(`freeTables/visitorPending/${overflowUid}`).get()).exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/engagements/${overflowUid}`).get()).exists(),
      false,
    );
    await perform(boundedHostUid, "open", { active: false });
  });

  test("two-phase admission is idempotent and rollback never erases a competing visitor claim", async () => {
    const concurrentHostUid = `admission-host-${suffix}`;
    const concurrentVisitorUid = `admission-visitor-${suffix}`;
    await perform(concurrentHostUid, "save_space", { space, hostCard });
    const opened = await perform(concurrentHostUid, "open", { active: true });
    const requested = await perform(concurrentVisitorUid, "request", {
      publicRoomId: opened.room.publicRoomId,
      visitorCard,
    });
    const concurrentResponses = await Promise.all([
      perform(concurrentHostUid, "respond", {
        requestId: requested.request.requestId,
        accept: true,
      }),
      perform(concurrentHostUid, "respond", {
        requestId: requested.request.requestId,
        accept: true,
      }),
    ]);
    assert.equal(
      concurrentResponses[0].session.sessionId,
      concurrentResponses[1].session.sessionId,
    );
    await perform(concurrentVisitorUid, "end", {
      sessionId: concurrentResponses[0].session.sessionId,
      reason: "safe_exit",
    });

    const rollbackHostUid = `rollback-host-${suffix}`;
    const rollbackVisitorUid = `rollback-visitor-${suffix}`;
    const competingSessionId = "9".repeat(24);
    await perform(rollbackHostUid, "save_space", { space, hostCard });
    const rollbackOpen = await perform(rollbackHostUid, "open", { active: true });
    const rollbackRequest = await perform(rollbackVisitorUid, "request", {
      publicRoomId: rollbackOpen.room.publicRoomId,
      visitorCard,
    });
    const rollbackHostClaim = (
      await realtime.ref(`freeTables/hostActive/${rollbackHostUid}`).get()
    ).val();
    await realtime.ref(`freeTables/engagements/${rollbackVisitorUid}`).set({
      state: "active",
      role: "visitor",
      roomId: "8".repeat(24),
      publicRoomId: "7".repeat(24),
      sessionId: competingSessionId,
      heartbeatAt: clock,
      expiresAt: clock + 180_000,
    });
    await assert.rejects(
      perform(rollbackHostUid, "respond", {
        requestId: rollbackRequest.request.requestId,
        accept: true,
      }),
      (error) => error?.code === "failed-precondition",
    );
    const [restoredHost, preservedVisitor, restoredRoom] = await Promise.all([
      realtime.ref(`freeTables/engagements/${rollbackHostUid}`).get(),
      realtime.ref(`freeTables/engagements/${rollbackVisitorUid}`).get(),
      realtime.ref(`freeTables/roomStates/${rollbackHostClaim.roomId}`).get(),
    ]);
    assert.equal(restoredHost.val()?.state, "host_open");
    assert.equal(preservedVisitor.val()?.sessionId, competingSessionId);
    assert.equal(restoredRoom.val()?.state, "open");
    assert.equal(
      restoredRoom.val()?.requests?.[rollbackRequest.request.requestId]?.visitorUid,
      rollbackVisitorUid,
    );
    await perform(rollbackHostUid, "open", { active: false });
    await realtime.ref(`freeTables/engagements/${rollbackVisitorUid}`).remove();
  });

  test("a failed canonical materialization restores both claims and remains retryable", async () => {
    const failureHostUid = `failure-host-${suffix}`;
    const failureVisitorUid = `failure-visitor-${suffix}`;
    let materializationFailureInjected = false;
    const failingRealtime = {
      ref(pathValue) {
        const reference = realtime.ref(pathValue);
        if (pathValue !== "freeTables") return reference;
        return new Proxy(reference, {
          get(target, property) {
            if (property === "update") {
              return async (updates) => {
                const materializesSession = Object.keys(updates || {})
                  .some((pathName) => pathName.startsWith("sessions/"));
                if (!materializationFailureInjected && materializesSession) {
                  materializationFailureInjected = true;
                  throw new Error("injected materialization failure");
                }
                return target.update(updates);
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    const failingService = createFreeTableService({
      firestore,
      realtime: failingRealtime,
      HttpsError,
      Timestamp,
      now: () => clock,
    });
    const failingPerform = (uid, action, fields = {}) => (
      failingService.performAction(uid, { action, ...fields })
    );
    await failingPerform(failureHostUid, "save_space", { space, hostCard });
    const opened = await failingPerform(failureHostUid, "open", { active: true });
    const requested = await failingPerform(failureVisitorUid, "request", {
      publicRoomId: opened.room.publicRoomId,
      visitorCard,
    });
    const failureRoomId = (
      await realtime.ref(`freeTables/hostActive/${failureHostUid}`).get()
    ).val()?.roomId;
    await assert.rejects(
      failingPerform(failureHostUid, "respond", {
        requestId: requested.request.requestId,
        accept: true,
      }),
      (error) => error?.code === "unavailable",
    );
    const [restoredHost, restoredVisitor, restoredRoom] = await Promise.all([
      realtime.ref(`freeTables/engagements/${failureHostUid}`).get(),
      realtime.ref(`freeTables/engagements/${failureVisitorUid}`).get(),
      realtime.ref(`freeTables/roomStates/${failureRoomId}`).get(),
    ]);
    assert.equal(restoredHost.val()?.state, "host_open");
    assert.equal(restoredVisitor.val()?.state, "visitor_pending");
    assert.equal(restoredVisitor.val()?.requestId, requested.request.requestId);
    assert.equal(restoredRoom.val()?.state, "open");
    assert.equal(restoredRoom.val()?.session, undefined);

    const retried = await perform(failureHostUid, "respond", {
      requestId: requested.request.requestId,
      accept: true,
    });
    assert.equal(retried.accepted, true);
    await perform(failureVisitorUid, "end", {
      sessionId: retried.session.sessionId,
      reason: "safe_exit",
    });
  });

  test("an acknowledged materialization with a lost response stays intact and retry converges", async () => {
    const ackHostUid = `ack-host-${suffix}`;
    const ackVisitorUid = `ack-visitor-${suffix}`;
    let ackFailureInjected = false;
    let verificationReadsToFail = 0;
    const ackLostRealtime = {
      ref(pathValue) {
        const reference = realtime.ref(pathValue);
        return new Proxy(reference, {
          get(target, property) {
            if (property === "update" && pathValue === "freeTables") {
              return async (updates) => {
                const materializesSession = Object.keys(updates || {})
                  .some((pathName) => pathName.startsWith("sessions/"));
                if (!ackFailureInjected && materializesSession) {
                  ackFailureInjected = true;
                  await target.update(updates);
                  verificationReadsToFail = 7;
                  throw new Error("injected acknowledgement loss");
                }
                return target.update(updates);
              };
            }
            if (property === "get") {
              return async (...argumentsList) => {
                if (verificationReadsToFail > 0) {
                  verificationReadsToFail -= 1;
                  throw new Error("injected verification read failure");
                }
                return target.get(...argumentsList);
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    const ackLostService = createFreeTableService({
      firestore,
      realtime: ackLostRealtime,
      HttpsError,
      Timestamp,
      now: () => clock,
    });
    const ackPerform = (uid, action, fields = {}) => (
      ackLostService.performAction(uid, { action, ...fields })
    );
    await ackPerform(ackHostUid, "save_space", { space, hostCard });
    const opened = await ackPerform(ackHostUid, "open", { active: true });
    const requested = await ackPerform(ackVisitorUid, "request", {
      publicRoomId: opened.room.publicRoomId,
      visitorCard,
    });
    await assert.rejects(
      ackPerform(ackHostUid, "respond", {
        requestId: requested.request.requestId,
        accept: true,
      }),
      (error) => error?.code === "unavailable",
    );
    const activeHost = (
      await realtime.ref(`freeTables/hostActive/${ackHostUid}`).get()
    ).val();
    assert.equal(activeHost?.state, "active");
    assert.ok(activeHost?.sessionId);
    assert.equal(
      (await realtime.ref(`freeTables/sessions/${activeHost.sessionId}`).get())
        .val()?.sessionId,
      activeHost.sessionId,
    );
    const retried = await perform(ackHostUid, "respond", {
      requestId: requested.request.requestId,
      accept: true,
    });
    assert.equal(retried.session.sessionId, activeHost.sessionId);
    assert.equal(
      (await realtime.ref(`freeTables/visitorPending/${ackVisitorUid}`).get()).exists(),
      false,
    );
    await perform(ackVisitorUid, "end", {
      sessionId: retried.session.sessionId,
      reason: "safe_exit",
    });
  });

  test("get_my_state releases only the caller's orphaned active claims", async () => {
    const orphanedUid = `state-orphan-${suffix}`;
    const missingSessionId = "6".repeat(24);
    await perform(orphanedUid, "get_my_state");
    await realtime.ref("freeTables").update({
      [`active/${orphanedUid}`]: {
        sessionId: missingSessionId,
        role: "host",
        heartbeatAt: clock,
        expiresAt: clock + 180_000,
      },
      [`hostActive/${orphanedUid}`]: {
        roomId: "5".repeat(24),
        publicRoomId: "4".repeat(24),
        sessionId: missingSessionId,
        state: "active",
        heartbeatAt: clock,
        expiresAt: clock + 180_000,
      },
      [`engagements/${orphanedUid}`]: {
        state: "active",
        role: "host",
        roomId: "5".repeat(24),
        publicRoomId: "4".repeat(24),
        sessionId: missingSessionId,
        heartbeatAt: clock,
        expiresAt: clock + 180_000,
      },
      [`presence/${missingSessionId}/${orphanedUid}`]: {
        online: true,
        lastSeen: clock,
        expiresAt: clock + 45_000,
      },
    });
    const missingState = await perform(orphanedUid, "get_my_state");
    assert.equal(missingState.session, null);
    for (const claimPath of [
      `active/${orphanedUid}`,
      `hostActive/${orphanedUid}`,
      `engagements/${orphanedUid}`,
      `presence/${missingSessionId}/${orphanedUid}`,
    ]) {
      assert.equal(
        (await realtime.ref(`freeTables/${claimPath}`).get()).exists(),
        false,
      );
    }

    const foreignSessionId = "3".repeat(24);
    const foreignHostUid = `foreign-host-${suffix}`;
    const foreignVisitorUid = `foreign-visitor-${suffix}`;
    await realtime.ref("freeTables").update({
      [`sessions/${foreignSessionId}`]: {
        sessionId: foreignSessionId,
        hostUid: foreignHostUid,
        visitorUid: foreignVisitorUid,
        participants: {
          [foreignHostUid]: true,
          [foreignVisitorUid]: true,
        },
        status: "active",
        expiresAt: clock + 180_000,
      },
      [`active/${orphanedUid}`]: {
        sessionId: foreignSessionId,
        role: "visitor",
        heartbeatAt: clock,
        expiresAt: clock + 180_000,
      },
      [`engagements/${orphanedUid}`]: {
        state: "active",
        role: "visitor",
        sessionId: foreignSessionId,
        heartbeatAt: clock,
        expiresAt: clock + 180_000,
      },
    });
    await perform(orphanedUid, "get_my_state");
    assert.equal(
      (await realtime.ref(`freeTables/active/${orphanedUid}`).get()).exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/sessions/${foreignSessionId}`).get())
        .val()?.hostUid,
      foreignHostUid,
    );
    await realtime.ref(`freeTables/sessions/${foreignSessionId}`).remove();

    const endedSessionId = "2".repeat(24);
    const endedPeerUid = `ended-peer-${suffix}`;
    const oldHeartbeat = clock - 10_000;
    await realtime.ref("freeTables").update({
      [`sessions/${endedSessionId}`]: {
        protocolVersion: 1,
        sessionId: endedSessionId,
        roomId: "1".repeat(24),
        publicRoomId: "0".repeat(24),
        hostUid: orphanedUid,
        visitorUid: endedPeerUid,
        participants: {
          [orphanedUid]: true,
          [endedPeerUid]: true,
        },
        publicMembers: {
          [orphanedUid]: "A".repeat(24),
          [endedPeerUid]: "B".repeat(24),
        },
        cards: {
          [orphanedUid]: hostCard,
          [endedPeerUid]: visitorCard,
        },
        space,
        status: "ended",
        endedAt: clock - 1,
        ending: { kind: "safe_exit", line: "", sendoffLine: "" },
        expiresAt: clock + 180_000,
      },
      [`active/${orphanedUid}`]: {
        sessionId: endedSessionId,
        role: "host",
        heartbeatAt: oldHeartbeat,
        expiresAt: clock + 180_000,
      },
    });
    const endedState = await perform(orphanedUid, "get_my_state");
    assert.equal(endedState.session?.status, "ended");
    assert.equal(
      (await realtime.ref(`freeTables/active/${orphanedUid}`).get())
        .val()?.heartbeatAt,
      oldHeartbeat,
    );
    await realtime.ref(`freeTables/sessions/${endedSessionId}`).remove();
    await realtime.ref(`freeTables/active/${orphanedUid}`).remove();
  });

  test("a revoke completed after invite request insertion rolls the card back", async () => {
    await realtime.ref("freeTables").remove();
    const raceHostUid = `invite-race-host-${suffix}`;
    const raceVisitorUid = `invite-race-visitor-${suffix}`;
    await perform(raceHostUid, "save_space", { space, hostCard });
    const opened = await perform(raceHostUid, "open", { active: true });
    assert.equal(opened.opened, true);
    const roomId = (
      await realtime.ref(`freeTables/hostActive/${raceHostUid}`).get()
    ).val()?.roomId;
    assert.match(String(roomId || ""), /^[A-Za-z0-9_-]{24}$/);
    const issued = await service.performInviteAction(raceHostUid, {
      action: "issue",
    });
    let signalInserted = () => {};
    let releaseInserted = () => {};
    let paused = false;
    const inserted = new Promise((resolve) => {
      signalInserted = resolve;
    });
    const released = new Promise((resolve) => {
      releaseInserted = resolve;
    });
    const pausingRealtime = {
      ref(pathValue) {
        const reference = realtime.ref(pathValue);
        return new Proxy(reference, {
          get(target, property) {
            if (property === "set"
                && String(pathValue).startsWith("freeTables/requests/")) {
              return async (...argumentsList) => {
                const result = await target.set(...argumentsList);
                if (!paused) {
                  paused = true;
                  signalInserted();
                  await released;
                }
                return result;
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    const pausingService = createFreeTableService({
      firestore,
      realtime: pausingRealtime,
      HttpsError,
      Timestamp,
      now: () => clock,
    });
    const pendingRequest = pausingService.performAction(raceVisitorUid, {
      action: "request_from_invite",
      inviteId: issued.invite.inviteId,
      visitorCard,
    });
    await inserted;
    assert.equal(
      (await realtime.ref(`freeTables/requests/${roomId}`).get()).exists(),
      true,
    );
    let revoked;
    try {
      revoked = await service.performInviteAction(raceHostUid, {
        action: "revoke",
        inviteId: issued.invite.inviteId,
      });
    } finally {
      releaseInserted();
    }
    assert.equal(revoked.revoked, true);
    await assert.rejects(
      pendingRequest,
      (error) => (
        error.code === "not-found"
        && error.message === "この灯り札は、いま一息ついています。"
      ),
    );
    const [
      visitorPending,
      visitorEngagement,
      publicRequests,
      internalRoom,
    ] = await Promise.all([
      realtime.ref(`freeTables/visitorPending/${raceVisitorUid}`).get(),
      realtime.ref(`freeTables/engagements/${raceVisitorUid}`).get(),
      realtime.ref(`freeTables/requests/${roomId}`).get(),
      realtime.ref(`freeTables/roomStates/${roomId}`).get(),
    ]);
    assert.equal(visitorPending.exists(), false);
    assert.equal(visitorEngagement.exists(), false);
    assert.equal(publicRequests.exists(), false);
    assert.deepEqual(internalRoom.val()?.requests || {}, {});
    assert.deepEqual(
      (await perform(raceHostUid, "get_my_state")).requests,
      [],
    );
    assert.equal(
      (await service.getInvitePreview({
        inviteId: issued.invite.inviteId,
      })).state,
      "inactive",
    );
    await perform(raceHostUid, "open", { active: false });
  });

  test("a public lamp card can be reported before entry without creating a session", async () => {
    await realtime.ref("freeTables").remove();
    const reportHostUid = `invite-report-host-${suffix}`;
    const reportVisitorUid = `invite-report-visitor-${suffix}`;
    await perform(reportHostUid, "save_space", { space, hostCard });
    await perform(reportHostUid, "open", { active: true });
    const issued = await service.performInviteAction(reportHostUid, {
      action: "issue",
    });
    const preview = await service.getInvitePreview({
      inviteId: issued.invite.inviteId,
    });
    assert.equal(preview.active, true);
    assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
    const submitted = await service.performInviteAction(reportVisitorUid, {
      action: "report_public_card",
      inviteId: issued.invite.inviteId,
      previewHash: preview.previewHash,
      reason: "privacy",
      details: "公開札に個人情報が含まれています。",
    });
    const repeated = await service.performInviteAction(reportVisitorUid, {
      action: "report_public_card",
      inviteId: issued.invite.inviteId,
      previewHash: preview.previewHash,
      reason: "other",
    });
    assert.equal(repeated.reportId, submitted.reportId);
    const reportReference = firestore
      .collection("freeTablePublicCardReports")
      .doc(submitted.reportId);
    const stored = (await reportReference.get()).data();
    assert.equal(stored.reportType, "public_card");
    assert.equal(stored.reporterUid, reportVisitorUid);
    assert.equal(stored.targetUid, reportHostUid);
    assert.equal(stored.reason, "privacy");
    assert.equal(stored.previewHash, preview.previewHash);
    assert.deepEqual(stored.snapshot, preview.preview);
    assert.deepEqual(Object.keys(stored.snapshot).sort(), [
      "hostDisplayName",
      "space",
    ]);
    assert.equal(Object.hasOwn(stored, "sessionId"), false);
    assert.equal(Object.hasOwn(stored, "messageIds"), false);
    assert.equal(Object.hasOwn(stored.snapshot, "hostUid"), false);
    assert.equal(
      (await firestore.collection("freeTableReports").doc(submitted.reportId).get()).exists,
      false,
    );
    assert.equal(
      (await firestore.collection("freeTableProfiles").doc(reportVisitorUid).get()).exists,
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/visitorPending/${reportVisitorUid}`).get()).exists(),
      false,
    );
    assert.equal(
      (await realtime.ref("freeTables/sessions").get()).exists(),
      false,
    );
    assert.equal(
      (await firestore
        .collection("freeTablePublicCardReportLimits")
        .doc(reportVisitorUid)
        .get()).data()?.count,
      1,
    );
    await assert.rejects(
      () => service.performInviteAction(reportHostUid, {
        action: "report_public_card",
        inviteId: issued.invite.inviteId,
        previewHash: preview.previewHash,
        reason: "other",
      }),
      (error) => error.code === "failed-precondition",
    );
    await assert.rejects(
      () => service.performInviteAction(reportVisitorUid, {
        action: "report_public_card",
        inviteId: issued.invite.inviteId,
        previewHash: "0".repeat(64),
        reason: "other",
      }),
      (error) => error.code === "failed-precondition",
    );
    await assert.rejects(
      () => service.performInviteAction(reportVisitorUid, {
        action: "report_public_card",
        inviteId: issued.invite.inviteId,
        previewHash: preview.previewHash,
        reason: "other",
        targetUid: reportHostUid,
      }),
      (error) => error.code === "invalid-argument",
    );
    await reportReference.update({ expireAt: Timestamp.fromMillis(clock - 1) });
    await firestore
      .collection("freeTablePublicCardReportLimits")
      .doc(reportVisitorUid)
      .update({ expireAt: Timestamp.fromMillis(clock - 1) });
    const cleaned = await service.cleanupExpired(clock);
    assert.equal(cleaned.publicCardReports, 1);
    assert.equal(cleaned.publicCardReportLimits, 1);
    assert.equal((await reportReference.get()).exists, false);
    await perform(reportHostUid, "open", { active: false });
  });

  test("cleanup fences fresh heartbeats, in-flight admission, reconnect grace, and replacement rooms", async () => {
    await realtime.ref("freeTables").remove();
    const id = (character) => character.repeat(24);
    const heartbeatHostUid = `heartbeat-host-${suffix}`;
    const heartbeatRoomId = id("H");
    const heartbeatPublicRoomId = id("I");
    const staleExpiry = clock - 1;
    const freshExpiry = clock + 120_000;
    await realtime.ref("freeTables").update({
      [`publicRooms/${heartbeatPublicRoomId}`]: {
        protocolVersion: 1,
        roomId: heartbeatRoomId,
        publicRoomId: heartbeatPublicRoomId,
        publicMemberId: id("J"),
        hostUid: heartbeatHostUid,
        state: "open",
        space,
        hostCard,
        openedAt: clock - 120_000,
        heartbeatAt: clock - 120_000,
        expiresAt: staleExpiry,
      },
      [`roomStates/${heartbeatRoomId}`]: {
        protocolVersion: 1,
        roomId: heartbeatRoomId,
        publicRoomId: heartbeatPublicRoomId,
        publicMemberId: id("J"),
        hostUid: heartbeatHostUid,
        state: "open",
        space,
        hostCard,
        requests: {},
        openedAt: clock - 120_000,
        heartbeatAt: clock,
        expiresAt: freshExpiry,
      },
      [`roomOwners/${heartbeatRoomId}`]: {
        uid: heartbeatHostUid,
        publicRoomId: heartbeatPublicRoomId,
        expiresAt: freshExpiry,
      },
      [`hostActive/${heartbeatHostUid}`]: {
        roomId: heartbeatRoomId,
        publicRoomId: heartbeatPublicRoomId,
        state: "open",
        heartbeatAt: clock,
        expiresAt: freshExpiry,
      },
      [`engagements/${heartbeatHostUid}`]: {
        state: "host_open",
        roomId: heartbeatRoomId,
        publicRoomId: heartbeatPublicRoomId,
        heartbeatAt: clock,
        expiresAt: freshExpiry,
      },
    });
    const expiredInviteId = "e".repeat(32);
    const orphanInviteId = "o".repeat(32);
    const canonicalInviteId = "n".repeat(32);
    const stalePointerInviteId = "s".repeat(32);
    const expiredInviteHost = `expired-invite-host-${suffix}`;
    const rotatedInviteHost = `rotated-invite-host-${suffix}`;
    const stalePointerHost = `stale-pointer-host-${suffix}`;
    const inviteRecord = (
      inviteId,
      inviteHostUid,
      createdAt,
      expiresAt,
    ) => ({
      protocolVersion: 1,
      inviteId,
      hostUid: inviteHostUid,
      roomId: heartbeatRoomId,
      publicRoomId: heartbeatPublicRoomId,
      generation: 1,
      createdAt,
      expiresAt,
    });
    const expiredInvite = inviteRecord(
      expiredInviteId,
      expiredInviteHost,
      clock - FREE_TABLE_INVITE_TTL_MS,
      clock - 1,
    );
    const orphanInvite = inviteRecord(
      orphanInviteId,
      rotatedInviteHost,
      clock - 120_000,
      clock + FREE_TABLE_INVITE_TTL_MS - 120_000,
    );
    const canonicalInvite = inviteRecord(
      canonicalInviteId,
      rotatedInviteHost,
      clock - 60_000,
      clock + FREE_TABLE_INVITE_TTL_MS - 60_000,
    );
    const stalePointer = inviteRecord(
      stalePointerInviteId,
      stalePointerHost,
      clock - 120_000,
      clock + FREE_TABLE_INVITE_TTL_MS - 120_000,
    );
    await realtime.ref("freeTables").update({
      [`invites/${expiredInviteId}`]: expiredInvite,
      "invites/malformed": { broken: true },
      [`invites/${orphanInviteId}`]: orphanInvite,
      [`invites/${canonicalInviteId}`]: canonicalInvite,
      [`hostInvites/${expiredInviteHost}`]: expiredInvite,
      [`hostInvites/malformed-pointer-${suffix}`]: { inviteId: "bad" },
      [`hostInvites/${rotatedInviteHost}`]: canonicalInvite,
      [`hostInvites/${stalePointerHost}`]: stalePointer,
    });
    let cleaned = await service.cleanupExpired(clock);
    assert.equal(cleaned.rooms, 0);
    assert.equal(cleaned.invites, 3);
    assert.equal(cleaned.invitePointers, 3);
    assert.equal(
      (await realtime.ref(`freeTables/invites/${canonicalInviteId}`).get()).exists(),
      true,
    );
    assert.equal(
      (await realtime.ref(`freeTables/hostInvites/${rotatedInviteHost}`).get())
        .val()?.inviteId,
      canonicalInviteId,
    );
    assert.equal(
      (await realtime.ref(`freeTables/invites/${orphanInviteId}`).get()).exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/hostInvites/${stalePointerHost}`).get()).exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/roomStates/${heartbeatRoomId}`).get())
        .val()?.expiresAt,
      freshExpiry,
    );
    assert.equal(
      (await realtime.ref(`freeTables/hostActive/${heartbeatHostUid}`).get())
        .val()?.roomId,
      heartbeatRoomId,
    );

    const admissionHostUid = `admission-host-${suffix}`;
    const admissionVisitorUid = `admission-visitor-${suffix}`;
    const admissionRoomId = id("K");
    const admissionPublicRoomId = id("L");
    const admissionSessionId = id("M");
    const admissionExpiry = clock + 180_000;
    const admissionSession = {
      protocolVersion: 1,
      sessionId: admissionSessionId,
      roomId: admissionRoomId,
      publicRoomId: admissionPublicRoomId,
      hostUid: admissionHostUid,
      visitorUid: admissionVisitorUid,
      participants: {
        [admissionHostUid]: true,
        [admissionVisitorUid]: true,
      },
      publicMembers: {
        [admissionHostUid]: id("N"),
        [admissionVisitorUid]: id("O"),
      },
      cards: {
        [admissionHostUid]: hostCard,
        [admissionVisitorUid]: visitorCard,
      },
      space,
      status: "connecting",
      admissionAccepted: true,
      p2pConnected: false,
      arrivals: { host: false, visitor: false },
      createdAt: clock,
      startedAt: 0,
      endedAt: 0,
      hardExpiresAt: clock + 7_200_000,
      expiresAt: admissionExpiry,
    };
    await realtime.ref("freeTables").update({
      [`publicRooms/${admissionPublicRoomId}`]: {
        protocolVersion: 1,
        roomId: admissionRoomId,
        publicRoomId: admissionPublicRoomId,
        publicMemberId: id("N"),
        hostUid: admissionHostUid,
        state: "open",
        space,
        hostCard,
        openedAt: clock - 120_000,
        heartbeatAt: clock - 120_000,
        expiresAt: staleExpiry,
      },
      [`roomStates/${admissionRoomId}`]: {
        protocolVersion: 1,
        roomId: admissionRoomId,
        publicRoomId: admissionPublicRoomId,
        publicMemberId: id("N"),
        hostUid: admissionHostUid,
        state: "active",
        space,
        hostCard,
        requests: {},
        acceptedRequestId: id("P"),
        session: admissionSession,
        openedAt: clock - 120_000,
        heartbeatAt: clock - 120_000,
        expiresAt: staleExpiry,
      },
      [`engagements/${admissionHostUid}`]: {
        state: "active",
        role: "host",
        roomId: admissionRoomId,
        publicRoomId: admissionPublicRoomId,
        sessionId: admissionSessionId,
        heartbeatAt: clock,
        expiresAt: admissionExpiry,
      },
      [`engagements/${admissionVisitorUid}`]: {
        state: "active",
        role: "visitor",
        roomId: admissionRoomId,
        publicRoomId: admissionPublicRoomId,
        sessionId: admissionSessionId,
        heartbeatAt: clock,
        expiresAt: admissionExpiry,
      },
    });
    cleaned = await service.cleanupExpired(clock);
    assert.equal(
      (await realtime.ref(`freeTables/publicRooms/${admissionPublicRoomId}`).get())
        .exists(),
      true,
    );
    assert.equal(
      (await realtime.ref(`freeTables/roomStates/${admissionRoomId}`).get())
        .val()?.state,
      "active",
    );
    assert.equal(
      (await realtime.ref(`freeTables/engagements/${admissionVisitorUid}`).get())
        .val()?.sessionId,
      admissionSessionId,
    );

    await realtime.ref("freeTables").update({
      [`sessions/${admissionSessionId}`]: admissionSession,
      [`active/${admissionHostUid}`]: {
        sessionId: admissionSessionId,
        role: "host",
        heartbeatAt: clock,
        expiresAt: admissionExpiry,
      },
      [`active/${admissionVisitorUid}`]: {
        sessionId: admissionSessionId,
        role: "visitor",
        heartbeatAt: clock,
        expiresAt: admissionExpiry,
      },
      [`hostActive/${admissionHostUid}`]: {
        roomId: admissionRoomId,
        publicRoomId: admissionPublicRoomId,
        sessionId: admissionSessionId,
        state: "active",
        heartbeatAt: clock,
        expiresAt: admissionExpiry,
      },
      [`publicRooms/${admissionPublicRoomId}`]: null,
    });
    cleaned = await service.cleanupExpired(clock);
    assert.equal(
      (await realtime.ref(`freeTables/sessions/${admissionSessionId}`).get())
        .val()?.status,
      "connecting",
    );

    const orphanHostUid = `orphan-host-${suffix}`;
    const orphanVisitorUid = `orphan-visitor-${suffix}`;
    const orphanRoomId = id("Q");
    const orphanPublicRoomId = id("R");
    const orphanSessionId = id("S");
    const orphanExpiry = clock + 7_200_000;
    const orphanSession = {
      ...admissionSession,
      sessionId: orphanSessionId,
      roomId: orphanRoomId,
      publicRoomId: orphanPublicRoomId,
      hostUid: orphanHostUid,
      visitorUid: orphanVisitorUid,
      participants: {
        [orphanHostUid]: true,
        [orphanVisitorUid]: true,
      },
      publicMembers: {
        [orphanHostUid]: id("T"),
        [orphanVisitorUid]: id("U"),
      },
      cards: {
        [orphanHostUid]: hostCard,
        [orphanVisitorUid]: visitorCard,
      },
      status: "active",
      p2pConnected: true,
      arrivals: { host: true, visitor: true },
      startedAt: clock,
      hardExpiresAt: orphanExpiry,
      expiresAt: orphanExpiry,
    };
    await realtime.ref("freeTables").update({
      [`sessions/${orphanSessionId}`]: orphanSession,
      [`active/${orphanHostUid}`]: {
        sessionId: orphanSessionId,
        role: "host",
        heartbeatAt: clock,
        expiresAt: orphanExpiry,
      },
      [`active/${orphanVisitorUid}`]: {
        sessionId: orphanSessionId,
        role: "visitor",
        heartbeatAt: clock,
        expiresAt: orphanExpiry,
      },
      [`hostActive/${orphanHostUid}`]: {
        roomId: orphanRoomId,
        publicRoomId: orphanPublicRoomId,
        sessionId: orphanSessionId,
        state: "active",
        heartbeatAt: clock,
        expiresAt: orphanExpiry,
      },
      [`engagements/${orphanHostUid}`]: {
        state: "active",
        role: "host",
        roomId: orphanRoomId,
        publicRoomId: orphanPublicRoomId,
        sessionId: orphanSessionId,
        heartbeatAt: clock,
        expiresAt: orphanExpiry,
      },
      [`engagements/${orphanVisitorUid}`]: {
        state: "active",
        role: "visitor",
        roomId: orphanRoomId,
        publicRoomId: orphanPublicRoomId,
        sessionId: orphanSessionId,
        heartbeatAt: clock,
        expiresAt: orphanExpiry,
      },
      [`chat/${orphanSessionId}/${id("V")}`]: {
        authorUid: orphanHostUid,
        authorRole: "host",
        type: "text",
        text: "再接続を待つ会話",
        createdAt: clock,
        expiresAt: clock + 1_800_000,
      },
    });
    cleaned = await service.cleanupExpired(clock);
    assert.equal(cleaned.disconnectProbes, 1);
    assert.equal(
      (await realtime.ref(`freeTables/sessions/${orphanSessionId}`).get())
        .val()?.status,
      "active",
    );
    assert.equal(
      (await realtime.ref(`freeTables/presence/${orphanSessionId}/_disconnect`).get())
        .val()?.state,
      "probe",
    );
    const freshPresence = () => ({
      online: true,
      lastSeen: clock,
      expiresAt: clock + 45_000,
    });
    await realtime.ref(`freeTables/presence/${orphanSessionId}`).set({
      [orphanHostUid]: freshPresence(),
      [orphanVisitorUid]: freshPresence(),
    });
    await service.cleanupExpired(clock);
    assert.equal(
      (await realtime.ref(`freeTables/presence/${orphanSessionId}/_disconnect`).get())
        .exists(),
      false,
    );
    await realtime.ref(
      `freeTables/presence/${orphanSessionId}/${orphanVisitorUid}`,
    ).remove();
    cleaned = await service.cleanupExpired(clock);
    assert.equal(cleaned.disconnectProbes, 1);
    assert.equal(
      (await realtime.ref(`freeTables/presence/${orphanSessionId}/_disconnect`).get())
        .val()?.missingVisitor,
      true,
    );
    clock += FREE_TABLE_DISCONNECT_GRACE_MS + 1;
    await realtime.ref(
      `freeTables/presence/${orphanSessionId}/${orphanHostUid}`,
    ).set(freshPresence());
    await realtime.ref(
      `freeTables/presence/${orphanSessionId}/_disconnect`,
    ).set({
      state: "locked",
      sessionId: orphanSessionId,
      missingHost: false,
      missingVisitor: true,
      observedAt: clock - FREE_TABLE_DISCONNECT_GRACE_MS - 1,
      lockedAt: clock - 1,
      lockExpiresAt: clock + 180_000,
      cleanupToken: id("0"),
    });
    cleaned = await service.cleanupExpired(clock);
    assert.equal(cleaned.disconnectedSessions, 1);
    const endedOrphan = (
      await realtime.ref(`freeTables/sessions/${orphanSessionId}`).get()
    ).val();
    assert.equal(endedOrphan.status, "ended");
    assert.equal(endedOrphan.ending.kind, "disconnected");
    assert.ok(Number(endedOrphan.cleanupFinalizedAt || 0) > 0);
    assert.equal(
      endedOrphan.expiresAt,
      clock + FREE_TABLE_ENDED_RETENTION_MS,
    );
    assert.equal(
      (await realtime.ref(`freeTables/active/${orphanHostUid}`).get()).exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/engagements/${orphanVisitorUid}`).get())
        .exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/chat/${orphanSessionId}`).get()).exists(),
      true,
    );

    const explicitHostUid = `explicit-host-${suffix}`;
    const explicitVisitorUid = `explicit-visitor-${suffix}`;
    const explicitRoomId = id("1");
    const explicitPublicRoomId = id("2");
    const explicitSessionId = id("3");
    const explicitSession = {
      ...orphanSession,
      sessionId: explicitSessionId,
      roomId: explicitRoomId,
      publicRoomId: explicitPublicRoomId,
      hostUid: explicitHostUid,
      visitorUid: explicitVisitorUid,
      participants: {
        [explicitHostUid]: true,
        [explicitVisitorUid]: true,
      },
      publicMembers: {
        [explicitHostUid]: id("4"),
        [explicitVisitorUid]: id("5"),
      },
      cards: {
        [explicitHostUid]: hostCard,
        [explicitVisitorUid]: visitorCard,
      },
      endedAt: 0,
      ending: null,
      expiresAt: clock + 7_200_000,
      hardExpiresAt: clock + 7_200_000,
    };
    const explicitChatId = id("7");
    await realtime.ref("freeTables").update({
      [`sessions/${explicitSessionId}`]: explicitSession,
      [`active/${explicitHostUid}`]: {
        sessionId: explicitSessionId,
        role: "host",
        heartbeatAt: clock,
        expiresAt: explicitSession.expiresAt,
      },
      [`active/${explicitVisitorUid}`]: {
        sessionId: explicitSessionId,
        role: "visitor",
        heartbeatAt: clock,
        expiresAt: explicitSession.expiresAt,
      },
      [`hostActive/${explicitHostUid}`]: {
        roomId: explicitRoomId,
        publicRoomId: explicitPublicRoomId,
        sessionId: explicitSessionId,
        state: "active",
        heartbeatAt: clock,
        expiresAt: explicitSession.expiresAt,
      },
      [`engagements/${explicitHostUid}`]: {
        state: "active",
        role: "host",
        roomId: explicitRoomId,
        publicRoomId: explicitPublicRoomId,
        sessionId: explicitSessionId,
        heartbeatAt: clock,
        expiresAt: explicitSession.expiresAt,
      },
      [`engagements/${explicitVisitorUid}`]: {
        state: "active",
        role: "visitor",
        roomId: explicitRoomId,
        publicRoomId: explicitPublicRoomId,
        sessionId: explicitSessionId,
        heartbeatAt: clock,
        expiresAt: explicitSession.expiresAt,
      },
      [`presence/${explicitSessionId}/_disconnect`]: {
        state: "locked",
        sessionId: explicitSessionId,
        missingHost: true,
        missingVisitor: true,
        observedAt: clock - FREE_TABLE_DISCONNECT_GRACE_MS,
        lockedAt: clock,
        lockExpiresAt: clock + 180_000,
        cleanupToken: id("6"),
      },
      [`chat/${explicitSessionId}/${explicitChatId}`]: {
        authorUid: explicitHostUid,
        authorRole: "host",
        type: "text",
        text: "通報へ残す発言",
        createdAt: clock,
        expiresAt: clock + 60_000,
      },
    });
    const explicitRace = await Promise.allSettled([
      service.cleanupExpired(clock),
      perform(explicitHostUid, "end", {
        sessionId: explicitSessionId,
        reason: "safe_exit",
      }),
      perform(explicitVisitorUid, "report", {
        sessionId: explicitSessionId,
        reason: "harassment",
      }),
      perform(explicitHostUid, "arrive", {
        sessionId: explicitSessionId,
      }),
    ]);
    assert.deepEqual(
      explicitRace.slice(0, 3).map((result) => (
        result.status === "fulfilled"
          ? "fulfilled"
          : `rejected:${result.reason?.code || "unknown"}:${result.reason?.message || ""}`
      )),
      ["fulfilled", "fulfilled", "fulfilled"],
    );
    const endedExplicit = (
      await realtime.ref(`freeTables/sessions/${explicitSessionId}`).get()
    ).val();
    assert.equal(endedExplicit?.status, "ended");
    assert.ok(Number(endedExplicit?.cleanupFinalizedAt || 0) > 0);
    assert.equal(explicitRace[2].value.evidenceCount, 1);
    const repeatedReport = await perform(explicitVisitorUid, "report", {
      sessionId: explicitSessionId,
      reason: "spam",
    });
    assert.equal(repeatedReport.reportId, explicitRace[2].value.reportId);
    assert.equal(repeatedReport.evidenceCount, 1);
    assert.equal(
      (await firestore.doc(`freeTableReports/${repeatedReport.reportId}`).get())
        .data()?.reason,
      "harassment",
    );
    assert.equal(
      (await realtime.ref(`freeTables/active/${explicitHostUid}`).get()).exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/presence/${explicitSessionId}`).get()).exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/chat/${explicitSessionId}`).get()).exists(),
      true,
    );

    const expiredSessionId = id("W");
    const replacementSessionId = id("X");
    const replacementRoomId = id("Y");
    const replacementPublicRoomId = id("Z");
    await realtime.ref("freeTables").update({
      [`sessions/${expiredSessionId}`]: {
        ...orphanSession,
        sessionId: expiredSessionId,
        roomId: replacementRoomId,
        publicRoomId: replacementPublicRoomId,
        expiresAt: clock,
      },
      [`roomStates/${replacementRoomId}`]: {
        roomId: replacementRoomId,
        publicRoomId: replacementPublicRoomId,
        hostUid: orphanHostUid,
        state: "active",
        session: {
          ...orphanSession,
          sessionId: replacementSessionId,
          roomId: replacementRoomId,
          publicRoomId: replacementPublicRoomId,
        },
        expiresAt: orphanExpiry,
      },
      [`roomOwners/${replacementRoomId}`]: {
        uid: orphanHostUid,
        publicRoomId: replacementPublicRoomId,
        expiresAt: orphanExpiry,
      },
    });
    await service.cleanupExpired(clock);
    assert.equal(
      (await realtime.ref(`freeTables/sessions/${expiredSessionId}`).get())
        .exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/roomStates/${replacementRoomId}`).get())
        .val()?.session?.sessionId,
      replacementSessionId,
    );
    assert.equal(
      (await realtime.ref(`freeTables/roomOwners/${replacementRoomId}`).get())
        .val()?.publicRoomId,
      replacementPublicRoomId,
    );
    clock += FREE_TABLE_ENDED_RETENTION_MS;
    await service.cleanupExpired(clock);
    assert.equal(
      (await realtime.ref(`freeTables/sessions/${explicitSessionId}`).get()).exists(),
      false,
    );
    assert.equal(
      (await realtime.ref(`freeTables/chat/${explicitSessionId}`).get()).exists(),
      false,
    );
  });
}
