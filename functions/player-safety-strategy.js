"use strict";

const { freezeMatchImagePreferences } = require("./match-image-preferences");
const { randomBytes } = require("node:crypto");

const ROOM_ID = /^[-A-Za-z0-9_]{20}$/;
const FRESH_MS = 45000;
const OFFER_MS = 20000;
const PRESTART_MS = 5 * 60 * 1000;
const SEARCH_STOP_GUARD_MS = 2 * 60 * 1000;
const SEARCH_STOP_GUARD = /^idle:(\d{13}):[a-f0-9]{12}$/;
// 戦略型1on1「貼り合い本式」。ID一覧はクライアントの strategy-hariai-core.mjs と一致させる。
const PROTOCOL_VERSION = 3;
const QUEUE_WAITING = "waiting-v3";
const QUEUE_OFFERING = "offering-v3";
const PERSONA_TYPES = ["tsuyotsuyo", "yowayowa", "koakuma", "oneesan", "amaenbo", "seiso"];
const FIRST_PERSONS = ["watashi", "atashi", "uchi", "watakushi"];
const CALL_STYLES = ["chan", "san", "oneesan", "anata"];
const COMMIT = /^[a-f0-9]{64}$/;
const listOfThree = (value) => (Array.isArray(value) ? value : [0, 1, 2].map((index) => value?.[index] ?? value?.[String(index)]))
  .slice(0, 3);
function preferenceTier(a, b) {
  const valid = (v) => ["live_action", "illustration", "both"].includes(v) ? v : "legacy";
  const first = valid(a.ratingPreference); const second = valid(b.ratingPreference);
  if (first !== "legacy" && first === second) return first === "both" ? 1 : 0;
  if (first === "both" || second === "both" || first === "legacy" && second === "legacy") return 1;
  return (first === "legacy" || a.allowPreferenceMismatch === true)
    && (second === "legacy" || b.allowPreferenceMismatch === true) ? 2 : Infinity;
}
function createPlayerSafetyStrategy({ realtime, HttpsError, playerSafety, now = Date.now }) {
  const get = async (path) => (await realtime.ref(`online/${path}`).get()).val();
  const fail = () => { throw new HttpsError("failed-precondition", "この対戦は終了しました。改めて相手を探してください。"); };
  const requireCurrentProtocol = (data) => {
    if (data?.protocolVersion !== PROTOCOL_VERSION) {
      throw new HttpsError("failed-precondition", "戦略型1on1が新しいルールになりました。ページを再読み込みしてください。");
    }
  };
  const queueFresh = (uid, row, at, states = [QUEUE_WAITING]) => row?.uid === uid
    && row.protocolVersion === PROTOCOL_VERSION && states.includes(row.state)
    && Number.isSafeInteger(row.joinedAt) && row.joinedAt > 0 && row.joinedAt <= at
    && Number.isSafeInteger(row.lastSeen) && row.lastSeen >= at - FRESH_MS && row.lastSeen <= at + 5000;
  const args = (roomId, room) => ({ ...room, roomId, mode: "strategy", firstUid: room.hostUid, secondUid: room.guestUid });
  const guardUntil = (value) => Number(typeof value === "string" ? SEARCH_STOP_GUARD.exec(value)?.[1] || 0 : 0);
  const battleHasStarted = (room) => room.battleReady?.[room.hostUid] === true && room.battleReady?.[room.guestUid] === true
    || Boolean(room.moves || room.resultClaims || room.finished || room.serverFinalized);
  const prestartIndexRef = (roomId) => realtime.ref(`online/strategyPrestartExpirations/${roomId}`);
  const prestartIndexMatches = (value, room) => value?.hostUid === room.hostUid && value?.guestUid === room.guestUid
    && value?.safetyGrantId === room.safetyGrantId;
  async function removePrestartIndex(roomId, room) {
    await prestartIndexRef(roomId).transaction((value) => value == null || prestartIndexMatches(value, room) ? null : undefined);
  }
  async function releasePrestart(roomId, room) {
    // A delayed expiry may finish after either participant has started a new
    // search. Never delete a queue or active pointer without its exact fence.
    await Promise.all([room.hostUid, room.guestUid].map(async (uid) => {
      await realtime.ref(`online/strategyActive/${uid}`).transaction((value) => value == null || value === roomId ? null : undefined);
      await realtime.ref(`online/strategyQueue/${uid}`).transaction((value) => value == null
        || value.uid === uid && value.joinedAt === room.queueJoinedAt?.[uid]
          && (!value.roomId || value.roomId === roomId) ? null : undefined);
      await realtime.ref(`online/strategyOffers/${uid}/${roomId}`).transaction((value) => value == null
        || value.roomId === roomId && value.fromUid === room.hostUid && value.toUid === room.guestUid ? null : undefined);
    }));
    await playerSafety.revokeContact(args(roomId, room));
    await realtime.ref(`online/strategySafetyReservations/${roomId}`).transaction((value) => value == null
      || value.hostUid === room.hostUid && value.guestUid === room.guestUid
        && value.createdAt === room.createdAt ? null : undefined);
    // Retain this durable retry record until every resource was released.
    await removePrestartIndex(roomId, room);
  }
  async function expirePrestart(uid, data, { force = false } = {}) {
    if (!force) requireCurrentProtocol(data);
    const roomId = String(data.roomId || ""); if (!ROOM_ID.test(roomId)) fail();
    let status = "missing";
    const result = await realtime.ref(`online/strategyRooms/${roomId}`).transaction((room) => {
      if (room == null) { status = "missing"; return null; }
      if (!force && ![room.hostUid, room.guestUid].includes(uid)) {
        throw new HttpsError("permission-denied", "この対戦を確認できません。");
      }
      if (room.destroyed?.reason === "prestart-timeout" && room.status === "expired") {
        status = "expired"; return room;
      }
      if (battleHasStarted(room)) { status = "protected"; return; }
      if (room.destroyed || !["active", "offered"].includes(room.status)) { status = "ended"; return; }
      if (!Number.isSafeInteger(room.prestartDeadlineAt) || room.prestartDeadlineAt <= 0) { status = "legacy"; return; }
      if (room.prestartDeadlineAt > now() || room.status !== "active") { status = "pending"; return; }
      status = "expired";
      return { ...room, status: "expired", destroyed: { by: room.hostUid, at: now(), reason: "prestart-timeout" } };
    });
    const room = result.snapshot.val();
    const expired = result.committed && room?.status === "expired" && room.destroyed?.reason === "prestart-timeout";
    if (expired) await releasePrestart(roomId, room);
    else if (room && ["protected", "ended"].includes(status)) await removePrestartIndex(roomId, room);
    return { expired: Boolean(expired), status: expired ? "expired" : status, roomId,
      ...(room?.prestartDeadlineAt ? { prestartDeadlineAt: room.prestartDeadlineAt } : {}),
      ...(expired ? { reason: "prestart-timeout" } : {}) };
  }
  async function stopWaiting(uid, data) {
    requireCurrentProtocol(data);
    if (!Number.isSafeInteger(data.joinedAt) || data.joinedAt <= 0 || data.joinedAt > now() + 5000) {
      throw new HttpsError("invalid-argument", "検索の開始時刻を確認できません。");
    }
    const activeRef = realtime.ref(`online/strategyActive/${uid}`);
    const guard = `idle:${now() + SEARCH_STOP_GUARD_MS}:${randomBytes(6).toString("hex")}`;
    const locked = await activeRef.transaction((value) => value == null || guardUntil(value) > 0 && guardUntil(value) <= now() ? guard : undefined);
    if (!locked.committed) {
      const activeId = locked.snapshot.val();
      if (guardUntil(activeId)) return { stopped: false, status: "occupied" };
      const room = ROOM_ID.test(String(activeId || "")) ? await get(`strategyRooms/${activeId}`) : null;
      if (room && Number.isSafeInteger(room.queueJoinedAt?.[uid]) && room.queueJoinedAt[uid] !== data.joinedAt) {
        return { stopped: false, status: "resource-changed" };
      }
      return { stopped: false, status: "match-in-progress", ...(activeId ? { roomId: activeId } : {}),
        ...(room ? { roomStatus: room.status, opponentUid: room.hostUid === uid ? room.guestUid : room.hostUid } : {}) };
    }
    try {
      // Admin transactions may first receive null on a cold cache even though
      // the previous transaction committed the guard. Probe null harmlessly so
      // the server supplies the current value instead of aborting locally.
      const owned = await activeRef.transaction((value) => value == null ? null
        : value === guard && guardUntil(value) > now() ? value : undefined);
      if (!owned.committed || owned.snapshot.val() !== guard) return { stopped: false, status: "occupied" };
      const stopped = await realtime.ref(`online/strategyQueue/${uid}`).transaction((value) => {
        if (guardUntil(guard) <= now()) return;
        return value == null ? null
          : value.uid === uid && value.protocolVersion === PROTOCOL_VERSION && value.joinedAt === data.joinedAt
            && value.state === QUEUE_WAITING && !value.roomId ? null : undefined;
      });
      return { stopped: stopped.committed, status: stopped.committed ? "stopped"
        : guardUntil(guard) <= now() ? "occupied" : "resource-changed" };
    } finally {
      await activeRef.transaction((value) => value == null || value === guard ? null : undefined);
    }
  }
  async function playerRecord(uid, value) {
    const clues = listOfThree(value?.clues);
    const commits = listOfThree(value?.weaknessCommits);
    const persona = value?.persona;
    if (!value || value.uid !== uid || !Array.isArray(value.clues) || value.clues.length !== 3
        || clues.some((clue) => typeof clue !== "string" || !clue.trim() || clue.length > 80 || /[\r\n]/.test(clue))
        || commits.length !== 3 || commits.some((commit) => !COMMIT.test(String(commit || "")))
        || new Set(commits).size !== 3
        || !PERSONA_TYPES.includes(persona?.type) || !FIRST_PERSONS.includes(persona?.firstPerson)
        || !CALL_STYLES.includes(persona?.callStyle)) {
      throw new HttpsError("invalid-argument", "戦略型のプレイヤー情報を確認できません。");
    }
    const profile = await get(`strategyProfiles/${uid}`) || {};
    return { uid, name: String(value.name || "プレイヤー").replace(/[\r\n]/g, " ").trim().slice(0, 16) || "プレイヤー",
      persona: { type: persona.type, firstPerson: persona.firstPerson, callStyle: persona.callStyle },
      clues, weaknessCommits: commits,
      penalties: { call: value.penalties?.call === true, tribute: value.penalties?.tribute === true },
      rating: Number(profile.rating || 1000), streak: Number(profile.streak || 0) };
  }
  async function release(roomId, room) {
    await Promise.all([room.hostUid, room.guestUid].map(async (uid) => {
      await realtime.ref(`online/strategyActive/${uid}`).transaction((value) => value == null || value === roomId ? null : undefined);
      await realtime.ref(`online/strategyQueue/${uid}`).transaction((value) => value?.roomId === roomId
        && value.joinedAt === room.queueJoinedAt?.[uid] ? { ...value, state: QUEUE_WAITING, roomId: null } : value == null ? null : undefined);
    }));
    await realtime.ref(`online/strategyOffers/${room.guestUid}/${roomId}`).transaction((value) =>
      value == null || value.fromUid === room.hostUid && value.toUid === room.guestUid && value.roomId === roomId ? null : undefined);
    await playerSafety.revokeContact(args(roomId, room));
    await realtime.ref(`online/strategySafetyReservations/${roomId}`).remove();
  }
  async function expire(uid, data, { force = false } = {}) {
    const roomId = String(data.roomId || ""); if (!ROOM_ID.test(roomId)) fail();
    let captured;
    const result = await realtime.ref(`online/strategyRooms/${roomId}`).transaction((room) => {
      if (room == null) return null;
      if (!force && ![room.hostUid, room.guestUid].includes(uid)) return;
      if (room.status !== "offered" && room.status !== "expired") return;
      captured = room;
      return { ...room, status: "expired" };
    });
    if (captured && result.committed) await release(roomId, captured);
    const current = result.snapshot.val();
    return { expired: Boolean(captured && result.committed), status: current?.status || "expired",
      roomId, opponentUid: current?.hostUid === uid ? current?.guestUid : current?.hostUid };
  }
  async function match(uid, data) {
    requireCurrentProtocol(data);
    const roomId = String(data.roomId || ""); if (!ROOM_ID.test(roomId)) fail();
    const ownPlayer = await playerRecord(uid, data.player);
    const activeId = await get(`strategyActive/${uid}`);
    if (activeId) {
      if (guardUntil(activeId) > now()) return { status: "waiting" };
      const previous = await get(`strategyRooms/${activeId}`);
      if (previous && !previous.destroyed && ["offered", "active"].includes(previous.status)) {
        if (await playerSafety.checkContact(args(activeId, previous))) {
          return { status: previous.status === "active" ? "active" : previous.hostUid === uid ? "hosted" : "joined",
            roomId: activeId, opponentUid: previous.hostUid === uid ? previous.guestUid : previous.hostUid };
        }
        if (previous.status === "offered") await expire(uid, { roomId: activeId });
        else fail();
      } else {
        const reservation = await get(`strategySafetyReservations/${activeId}`);
        if (reservation && reservation.createdAt > now() - OFFER_MS) return { status: "waiting" };
        await realtime.ref(`online/strategyActive/${uid}`).transaction((value) => value == null || value === activeId ? null : undefined);
      }
    }
    if (await get(`strategyRooms/${roomId}`)) return { status: "waiting" };
    const [queue, active] = await Promise.all([
      realtime.ref("online/strategyQueue").orderByChild("lastSeen").startAt(now() - FRESH_MS).limitToLast(500).get().then((s) => s.val() || {}),
      get("strategyActive"),
    ]);
    const own = queue[uid]; if (!queueFresh(uid, own, now())) return { status: "waiting" };
    const candidates = Object.entries(queue).filter(([other, row]) => other !== uid && !active?.[other]
      && queueFresh(other, row, now()) && Number.isFinite(preferenceTier(own, row)))
      .map(([other, row]) => ({ ...row, uid: other }))
      .sort((a, b) => preferenceTier(own, a) - preferenceTier(own, b) || a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
    const visible = await playerSafety.filterVisible(uid, candidates, (row) => row.uid);
    for (const other of visible.slice(0, 10)) {
      const createdAt = now();
      const base = { hostUid: uid, guestUid: other.uid, createdAt,
        queueJoinedAt: { [uid]: own.joinedAt, [other.uid]: other.joinedAt } };
      const reserved = await realtime.ref(`online/strategySafetyReservations/${roomId}`).transaction((value) => value == null ? base : undefined);
      if (!reserved.committed) return { status: "waiting" };
      const lock = await realtime.ref("online/strategyActive").transaction((value) => {
        if (value?.[uid] || value?.[other.uid]) return;
        return { ...value, [uid]: roomId, [other.uid]: roomId };
      });
      if (!lock.committed) { await realtime.ref(`online/strategySafetyReservations/${roomId}`).remove(); continue; }
      let room = base;
      try {
        const [hostQueue, guestQueue] = await Promise.all([get(`strategyQueue/${uid}`), get(`strategyQueue/${other.uid}`)]);
        if (!queueFresh(uid, hostQueue, now()) || !queueFresh(other.uid, guestQueue, now())
            || hostQueue.joinedAt !== own.joinedAt || guestQueue.joinedAt !== other.joinedAt
            || !Number.isFinite(preferenceTier(hostQueue, guestQueue))) { await release(roomId, room); continue; }
        const safety = await playerSafety.ensureContact({ firstUid: uid, secondUid: other.uid, mode: "strategy",
          roomId, attemptId: roomId, startedAt: Math.min(hostQueue.joinedAt, guestQueue.joinedAt), active: false });
        room = { ...base, ...safety, protocolVersion: PROTOCOL_VERSION, status: "offered",
          members: { [uid]: true, [other.uid]: true }, players: { [uid]: ownPlayer } };
        const stored = await realtime.ref(`online/strategyRooms/${roomId}`).transaction((value) => value == null ? room : undefined);
        if (!stored.committed) { await release(roomId, room); return { status: "waiting" }; }
        const state = await realtime.ref(`online/strategyQueue/${uid}`).transaction((value) => value?.joinedAt === own.joinedAt
          && value.state === QUEUE_WAITING ? { ...value, state: QUEUE_OFFERING, roomId } : value == null ? null : undefined);
        if (!state.committed) { await expire(uid, { roomId }); return { status: "waiting" }; }
        await realtime.ref(`online/strategyOffers/${other.uid}/${roomId}`).set({ protocolVersion: PROTOCOL_VERSION,
          roomId, fromUid: uid, toUid: other.uid, createdAt });
        if (!await playerSafety.checkContact(args(roomId, room))) { await expire(uid, { roomId }); return { status: "waiting" }; }
        return { status: "hosted", roomId, opponentUid: other.uid };
      } catch (error) {
        await expire(uid, { roomId }).catch(() => {});
        await release(roomId, room);
        if (error.code === "failed-precondition") return { status: "waiting" };
        throw error;
      }
    }
    return { status: "waiting" };
  }
  async function accept(uid, data) {
    requireCurrentProtocol(data);
    const roomId = String(data.roomId || ""); if (!ROOM_ID.test(roomId)) fail();
    const room = await get(`strategyRooms/${roomId}`);
    if (!room || room.guestUid !== uid || room.destroyed || !await playerSafety.checkContact(args(roomId, room))) fail();
    if (room.status === "active") return { status: "active", roomId, opponentUid: room.hostUid };
    const [hostQueue, guestQueue, active] = await Promise.all([get(`strategyQueue/${room.hostUid}`), get(`strategyQueue/${uid}`), get("strategyActive")]);
    if (room.status !== "offered" || room.createdAt < now() - OFFER_MS
        || !queueFresh(room.hostUid, hostQueue, now(), [QUEUE_OFFERING])
        || !queueFresh(uid, guestQueue, now()) || hostQueue.roomId !== roomId
        || hostQueue.joinedAt !== room.queueJoinedAt[room.hostUid] || guestQueue.joinedAt !== room.queueJoinedAt[uid]
        || active?.[uid] !== roomId || active?.[room.hostUid] !== roomId
        || !Number.isFinite(preferenceTier(hostQueue, guestQueue))) { await expire(uid, { roomId }); fail(); }
    const player = await playerRecord(uid, data.player);
    if (!await playerSafety.activateContact(args(roomId, room))) fail();
    // Capture both choices at acceptance, after the queue/session checks. A
    // retry keeps the first private record and never reads the queue at finish.
    await freezeMatchImagePreferences(realtime, {
      mode: "strategy", roomId, room,
      preferences: {
        [room.hostUid]: hostQueue.ratingPreference,
        [uid]: guestQueue.ratingPreference,
      },
    }, now());
    // Persist a server-only deadline/retry index before activation. Concurrent
    // acceptance and retries reuse the first deadline rather than extending it.
    const expiry = await prestartIndexRef(roomId).transaction((value) => value == null ? {
      expiresAt: now() + PRESTART_MS, hostUid: room.hostUid, guestUid: room.guestUid, safetyGrantId: room.safetyGrantId,
    } : prestartIndexMatches(value, room) ? value : undefined);
    const deadline = expiry.snapshot.val()?.expiresAt;
    if (!expiry.committed || !Number.isSafeInteger(deadline) || deadline <= now()) { await expire(uid, { roomId }); fail(); }
    const activated = await realtime.ref(`online/strategyRooms/${roomId}`).transaction((value) => {
      if (value == null) return null;
      if (value?.status !== "offered" || value.destroyed || value.safetyGrantId !== room.safetyGrantId) return;
      if (deadline <= now()) return;
      return { ...value, status: "active", prestartDeadlineAt: deadline, players: { ...value.players, [uid]: player } };
    });
    if (!activated.committed || !await playerSafety.checkContact(args(roomId, room))) fail();
    await realtime.ref(`online/strategyOffers/${uid}/${roomId}`).remove();
    await Promise.all([uid, room.hostUid].map((participant) => realtime.ref(`online/strategyQueue/${participant}`)
      .transaction((value) => value == null || value.joinedAt === room.queueJoinedAt[participant] ? null : undefined)));
    return { status: "active", roomId, opponentUid: room.hostUid };
  }
  async function cleanup() {
    const rows = (await realtime.ref("online/strategySafetyReservations").orderByChild("createdAt")
      .endAt(now() - OFFER_MS).limitToFirst(100).get()).val() || {};
    for (const [roomId, reservation] of Object.entries(rows)) {
      const room = await get(`strategyRooms/${roomId}`);
      if (!room || room.destroyed || room.status === "expired") await release(roomId, room || reservation);
      else if (room.status === "offered") await expire(reservation.hostUid, { roomId }, { force: true });
      else await realtime.ref(`online/strategySafetyReservations/${roomId}`).remove();
    }
    const expirations = (await realtime.ref("online/strategyPrestartExpirations").orderByChild("expiresAt")
      .endAt(now()).limitToFirst(100).get()).val() || {};
    for (const [roomId, expiration] of Object.entries(expirations)) {
      const outcome = await expirePrestart(expiration.hostUid, { roomId }, { force: true });
      if (outcome.status === "missing") await removePrestartIndex(roomId, expiration);
      if (outcome.status === "legacy") {
        const room = await get(`strategyRooms/${roomId}`);
        // An interrupted acceptance can leave only its durable index. Ordinary
        // legacy active rooms are untouched; a still-offered room is expired.
        if (room?.status === "offered") await expire(expiration.hostUid, { roomId }, { force: true });
        const current = await get(`strategyRooms/${roomId}`);
        if (!current?.prestartDeadlineAt) await removePrestartIndex(roomId, expiration);
      }
    }
    return { examined: Object.keys(rows).length, prestartExamined: Object.keys(expirations).length };
  }
  return { match, accept, expire, stopWaiting, expirePrestart, cleanup };
}
module.exports = {
  createPlayerSafetyStrategy,
  preferenceTier,
  STRATEGY_HARIAI_IDS: Object.freeze({ PROTOCOL_VERSION, PERSONA_TYPES, FIRST_PERSONS, CALL_STYLES }),
};
