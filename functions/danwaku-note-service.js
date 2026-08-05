"use strict";

const crypto = require("node:crypto");

const {
  DANWAKU_ACTIVE_NOTE_LIMIT,
  DANWAKU_ARCHIVED_NOTE_LIMIT,
  DANWAKU_HISTORY_LIMIT,
  DANWAKU_ID_PATTERN,
  DANWAKU_RANKING_READ_LIMIT,
  DanwakuNoteError,
  continueDanwakuNote,
  createDanwakuOpaqueId,
  danwakuDayKey,
  danwakuEventId,
  danwakuMatchBadge,
  danwakuPublicEntry,
  deterministicDanwakuId,
  emptyDanwakuNote,
  normalizeDanwakuActionData,
  normalizeDanwakuNote,
  normalizeDanwakuProfile,
  normalizeDanwakuDisplayName,
  nextDanwakuBoundaryAt,
  publicDanwakuNote,
  publicDanwakuProfile,
  refreshDanwakuPublicCache,
  rankDanwakuPublicEntries,
  resetDanwakuNote,
} = require("./danwaku-note");

const REQUIRED_DEPENDENCIES = Object.freeze([
  "firestore",
  "HttpsError",
  "achievementProfileRef",
  "eligibleAchievementIds",
  "unlockAchievements",
  "normalizeAchievementProfile",
]);
const SAFE_UID_PATTERN = /^[^\u0000-\u001f\u007f.#$\[\]\/]{1,128}$/;
const DANWAKU_OPERATION_OUTCOME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const DANWAKU_EVENT_PRUNE_BATCH_LIMIT = 100;

function stableOperationPayload(value) {
  if (Array.isArray(value)) return value.map(stableOperationPayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== "operationId")
      .sort()
      .map((key) => [key, stableOperationPayload(value[key])]),
  );
}

function operationRequestHash(data) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableOperationPayload(data)))
    .digest("base64url");
}

function createDanwakuNoteService(deps) {
  if (!deps || typeof deps !== "object") throw new TypeError("Danwaku dependencies are required");
  for (const name of REQUIRED_DEPENDENCIES) {
    if (!deps[name] || (name !== "firestore" && typeof deps[name] !== "function")) {
      throw new TypeError(`Missing Danwaku dependency: ${name}`);
    }
  }
  const {
    firestore,
    HttpsError,
    achievementProfileRef,
    eligibleAchievementIds,
    unlockAchievements,
    normalizeAchievementProfile,
  } = deps;
  const now = typeof deps.now === "function" ? deps.now : Date.now;
  const randomBytes = typeof deps.randomBytes === "function" ? deps.randomBytes : undefined;
  const logger = deps.logger && typeof deps.logger === "object" ? deps.logger : console;

  function profileRef(uid) {
    return firestore.collection("danwakuProfiles").doc(uid);
  }

  function notesRef(uid) {
    return profileRef(uid).collection("notes");
  }

  function noteRef(uid, noteId) {
    return notesRef(uid).doc(noteId);
  }

  function eventRef(uid, noteId, eventId) {
    return noteRef(uid, noteId).collection("events").doc(eventId);
  }

  function operationRef(uid, operationId) {
    return profileRef(uid).collection("operations").doc(
      deterministicDanwakuId("operation", uid, operationId),
    );
  }

  function publicEntriesRef() {
    return firestore.collection("danwakuPublicEntries");
  }

  function publicEntryRef(entryId) {
    return publicEntriesRef().doc(entryId);
  }

  function matchBadgeRef(uid) {
    return firestore.collection("danwakuMatchBadges").doc(uid);
  }

  function serverNow() {
    const timestamp = Math.floor(Number(now()));
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new TypeError("Invalid Danwaku server clock");
    }
    return timestamp;
  }

  function storedArchivedCount(value) {
    const count = value?.archivedCount;
    return Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000
      ? count
      : null;
  }

  function serviceProfile(profileValue, timestamp, archivedCountFallback = null) {
    const archivedCount = storedArchivedCount(profileValue);
    const fallback = archivedCountFallback === null ? 0 : archivedCountFallback;
    return {
      ...normalizeDanwakuProfile(profileValue, timestamp),
      archivedCount: archivedCount === null
        || (archivedCount > DANWAKU_ARCHIVED_NOTE_LIMIT && archivedCountFallback !== null)
        ? fallback
        : archivedCount,
    };
  }

  async function prepareArchivedCount(uid) {
    const snapshot = await profileRef(uid).get();
    const existing = storedArchivedCount(snapshot.data());
    if (existing !== null && existing <= DANWAKU_ARCHIVED_NOTE_LIMIT) return existing;
    const archived = await notesRef(uid)
      .where("status", "==", "archived")
      .limit(DANWAKU_ARCHIVED_NOTE_LIMIT + 1)
      .get();
    return archived.docs.length;
  }

  async function reconcileArchivedOverflow(uid) {
    const archived = await notesRef(uid)
      .where("status", "==", "archived")
      .limit(DANWAKU_ARCHIVED_NOTE_LIMIT + 1)
      .get();
    if (archived.docs.length > DANWAKU_ARCHIVED_NOTE_LIMIT) return;
    const timestamp = serverNow();
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(profileRef(uid));
      const stored = storedArchivedCount(snapshot.data());
      if (stored === null || stored <= DANWAKU_ARCHIVED_NOTE_LIMIT) return;
      transaction.set(
        profileRef(uid),
        serviceProfile(snapshot.data(), timestamp, archived.docs.length),
      );
    });
  }

  function inspectOperationReceipt(snapshot, data, noteId) {
    const requestHash = operationRequestHash(data);
    if (!snapshot.exists) return { replayed: false, requestHash, outcome: "" };
    const receipt = snapshot.data() || {};
    if (receipt.action !== data.action
        || receipt.noteId !== noteId
        || receipt.requestHash !== requestHash) {
      throw new DanwakuNoteError(
        "already-exists",
        "同じ操作情報が別の断惑NOTE操作で使用されています。",
      );
    }
    if (!DANWAKU_OPERATION_OUTCOME_PATTERN.test(String(receipt.outcome || ""))) {
      throw new DanwakuNoteError("aborted", "断惑NOTEの操作履歴を確認できませんでした。");
    }
    return { replayed: true, requestHash, outcome: String(receipt.outcome) };
  }

  function createOperationReceipt(
    transaction,
    ref,
    data,
    noteId,
    requestHash,
    outcome,
    timestamp,
  ) {
    transaction.create(ref, {
      action: data.action,
      noteId,
      requestHash,
      outcome,
      createdAt: timestamp,
    });
  }

  async function serverDisplayName(uid) {
    if (typeof deps.resolveDisplayName !== "function") return "PLAYER";
    try {
      return normalizeDanwakuDisplayName(await deps.resolveDisplayName(uid));
    } catch (error) {
      logger.warn?.("Danwaku display name resolution failed", {
        category: typeof error?.code === "string" ? error.code : "invalid-profile",
      });
      return "PLAYER";
    }
  }

  function requireUid(uidValue) {
    const uid = String(uidValue || "");
    if (!SAFE_UID_PATTERN.test(uid)) {
      throw new HttpsError("unauthenticated", "匿名ログインが必要です。");
    }
    return uid;
  }

  function asHttpsError(error) {
    if (error instanceof HttpsError) return error;
    if (error instanceof DanwakuNoteError) {
      return new HttpsError(error.code, error.message, error.details);
    }
    return error;
  }

  function bumpProfile(profileValue, timestamp) {
    const profile = serviceProfile(profileValue, timestamp);
    return {
      ...profile,
      revision: Math.min(Number.MAX_SAFE_INTEGER, profile.revision + 1),
      updatedAt: timestamp,
    };
  }

  function clearPublicSettings(profileValue, timestamp) {
    return {
      ...bumpProfile(profileValue, timestamp),
      publicNoteId: "",
      rankingVisible: false,
      matchVisible: false,
      shareTitle: false,
      displayName: "",
      publicEntryId: "",
      publicDays: 0,
      publicTitle: "",
      publicLastContinuedAt: 0,
      rankingExpiresAt: 0,
    };
  }

  function storedEvent(value, fallbackId = "") {
    if (!value || typeof value !== "object") return null;
    const noteId = DANWAKU_ID_PATTERN.test(String(value.noteId || ""))
      ? String(value.noteId)
      : "";
    if (!noteId) return null;
    return {
      eventId: String(fallbackId || value.eventId || ""),
      type: String(value.type || ""),
      noteId,
      dayKey: /^\d{4}-\d{2}-\d{2}$/.test(String(value.dayKey || ""))
        ? String(value.dayKey)
        : "",
      beforeDays: Math.max(0, Math.floor(Number(value.beforeDays) || 0)),
      afterDays: Math.max(0, Math.floor(Number(value.afterDays) || 0)),
      createdAt: Math.max(0, Math.floor(Number(value.createdAt) || 0)),
      ...(typeof value.rankingVisible === "boolean"
        ? { rankingVisible: value.rankingVisible }
        : {}),
      ...(typeof value.matchVisible === "boolean"
        ? { matchVisible: value.matchVisible }
        : {}),
    };
  }

  function mutationEvent(type, note, timestamp, overrides = {}) {
    return {
      type,
      noteId: note.noteId,
      dayKey: danwakuDayKey(timestamp),
      beforeDays: note.currentDays,
      afterDays: note.currentDays,
      createdAt: timestamp,
      ...overrides,
    };
  }

  async function pruneNoteEvents(uid, noteId) {
    try {
      const extras = await noteRef(uid, noteId)
        .collection("events")
        .orderBy("createdAt", "desc")
        .offset(DANWAKU_HISTORY_LIMIT)
        .limit(DANWAKU_EVENT_PRUNE_BATCH_LIMIT)
        .get();
      await Promise.all(extras.docs.map((snapshot) => snapshot.ref.delete()));
    } catch (error) {
      logger.warn?.("Danwaku event pruning failed", {
        category: typeof error?.code === "string" ? error.code : "internal",
      });
    }
  }

  function writeProjectionChanges(transaction, uid, previousProfileValue, profileValue, noteValue, timestamp) {
    const previousProfile = normalizeDanwakuProfile(previousProfileValue, timestamp);
    const profile = normalizeDanwakuProfile(profileValue, timestamp);
    const note = normalizeDanwakuNote(noteValue);
    const publicEntry = danwakuPublicEntry(profile, note, timestamp);
    const matchBadge = danwakuMatchBadge(profile, note);

    if (previousProfile.publicEntryId
        && (!publicEntry || previousProfile.publicEntryId !== profile.publicEntryId)) {
      transaction.delete(publicEntryRef(previousProfile.publicEntryId));
    }
    if (profile.publicEntryId) {
      if (publicEntry) transaction.set(publicEntryRef(profile.publicEntryId), publicEntry);
      else transaction.delete(publicEntryRef(profile.publicEntryId));
    }
    if (matchBadge) transaction.set(matchBadgeRef(uid), matchBadge);
    else transaction.delete(matchBadgeRef(uid));
  }

  async function getState(uidValue) {
    const uid = requireUid(uidValue);
    const timestamp = serverNow();
    const [profileSnapshot, activeSnapshots, recentSnapshots, archivedCountSnapshots] = await Promise.all([
      profileRef(uid).get(),
      notesRef(uid).where("status", "==", "active").limit(DANWAKU_ACTIVE_NOTE_LIMIT).get(),
      notesRef(uid)
        .orderBy("updatedAt", "desc")
        .limit(DANWAKU_ACTIVE_NOTE_LIMIT + DANWAKU_ARCHIVED_NOTE_LIMIT)
        .get(),
      notesRef(uid)
        .where("status", "==", "archived")
        .limit(DANWAKU_ARCHIVED_NOTE_LIMIT + 1)
        .get(),
    ]);
    const profile = serviceProfile(
      profileSnapshot.data(),
      timestamp,
      archivedCountSnapshots.docs.length,
    );
    const byId = new Map();
    for (const snapshot of activeSnapshots.docs) {
      const note = publicDanwakuNote({ ...(snapshot.data() || {}), noteId: snapshot.id });
      if (note?.status === "active") byId.set(note.noteId, note);
    }
    let archivedCount = 0;
    for (const snapshot of recentSnapshots.docs) {
      const note = publicDanwakuNote({ ...(snapshot.data() || {}), noteId: snapshot.id });
      if (!note) continue;
      if (note.status === "archived" && archivedCount < DANWAKU_ARCHIVED_NOTE_LIMIT) {
        byId.set(note.noteId, note);
        archivedCount += 1;
      }
    }
    const dayKey = danwakuDayKey(timestamp);
    const notes = Array.from(byId.values())
      .sort((left, right) => right.updatedAt - left.updatedAt || left.noteId.localeCompare(right.noteId))
      .map((note) => ({
        ...note,
        canContinueToday: note.status === "active"
          && note.lastContinueDayKey !== dayKey
          && note.lastResetDayKey !== dayKey,
        canResetToday: note.status === "active" && note.currentDays > 0,
      }));
    return {
      profile: { ...publicDanwakuProfile(profile), archivedCount: profile.archivedCount },
      notes,
      dayKey,
      nextBoundaryAt: nextDanwakuBoundaryAt(timestamp),
      serverNow: timestamp,
    };
  }

  async function getRanking(uidValue) {
    const uid = requireUid(uidValue);
    const timestamp = serverNow();
    const [profileSnapshot, entriesSnapshot] = await Promise.all([
      profileRef(uid).get(),
      publicEntriesRef()
        .where("expiresAt", ">", timestamp)
        .orderBy("expiresAt", "desc")
        .limit(DANWAKU_RANKING_READ_LIMIT + 1)
        .get(),
    ]);
    if (entriesSnapshot.docs.length > DANWAKU_RANKING_READ_LIMIT) {
      throw new DanwakuNoteError(
        "resource-exhausted",
        "断惑ランキングの参加者が多いため、時間をおいて再度お試しください。",
      );
    }
    const profile = normalizeDanwakuProfile(profileSnapshot.data(), timestamp);
    return {
      ranking: rankDanwakuPublicEntries(
        entriesSnapshot.docs.map((snapshot) => ({
          ...(snapshot.data() || {}),
          entryId: snapshot.id,
        })),
        { viewerEntryId: profile.publicEntryId, timestamp },
      ),
      dayKey: danwakuDayKey(timestamp),
      nextBoundaryAt: nextDanwakuBoundaryAt(timestamp),
      serverNow: timestamp,
    };
  }

  async function getHistory(uidValue, data) {
    const uid = requireUid(uidValue);
    const noteSnapshot = await noteRef(uid, data.noteId).get();
    const note = normalizeDanwakuNote(noteSnapshot.data(), data.noteId);
    if (!note || note.status === "deleted") {
      throw new DanwakuNoteError("not-found", "断惑NOTEが見つかりません。");
    }
    const snapshot = await noteRef(uid, data.noteId)
      .collection("events")
      .orderBy("createdAt", "desc")
      .limit(data.limit)
      .get();
    return {
      noteId: data.noteId,
      events: snapshot.docs.map((eventSnapshot) => (
        storedEvent(eventSnapshot.data(), eventSnapshot.id)
      )).filter(Boolean),
    };
  }

  async function createNote(uidValue, data) {
    const uid = requireUid(uidValue);
    const timestamp = serverNow();
    const archivedCountFallback = await prepareArchivedCount(uid);
    const noteId = deterministicDanwakuId("note", uid, data.operationId);
    const targetNoteRef = noteRef(uid, noteId);
    const targetOperationRef = operationRef(uid, data.operationId);
    const targetEventRef = eventRef(
      uid,
      noteId,
      danwakuEventId("create", noteId, data.operationId),
    );
    let outcome = "created";
    await firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, noteSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(targetNoteRef),
        transaction.get(targetOperationRef),
      ]);
      const receipt = inspectOperationReceipt(operationSnapshot, data, noteId);
      if (receipt.replayed) {
        outcome = receipt.outcome;
        return;
      }
      if (noteSnapshot.exists) {
        throw new DanwakuNoteError("aborted", "断惑NOTEの作成状態を確認できませんでした。");
      }
      const previousProfile = serviceProfile(
        profileSnapshot.data(),
        timestamp,
        archivedCountFallback,
      );
      if (previousProfile.activeNoteCount >= DANWAKU_ACTIVE_NOTE_LIMIT) {
        throw new DanwakuNoteError(
          "resource-exhausted",
          `進行中の断惑NOTEは${DANWAKU_ACTIVE_NOTE_LIMIT}件までです。`,
        );
      }
      const note = emptyDanwakuNote({
        noteId,
        title: data.title,
        commitment: data.commitment,
        timestamp,
      });
      const profile = {
        ...bumpProfile(previousProfile, timestamp),
        activeNoteCount: previousProfile.activeNoteCount + 1,
        noteCount: previousProfile.noteCount + 1,
      };
      transaction.set(profileRef(uid), profile);
      transaction.create(targetNoteRef, note);
      transaction.create(targetEventRef, mutationEvent("create", note, timestamp));
      createOperationReceipt(
        transaction,
        targetOperationRef,
        data,
        noteId,
        receipt.requestHash,
        outcome,
        timestamp,
      );
    });
    await pruneNoteEvents(uid, noteId);
    return {
      outcome,
      noteId,
      state: await getState(uid),
      newlyUnlocked: [],
    };
  }

  async function updateNote(uidValue, data) {
    const uid = requireUid(uidValue);
    const timestamp = serverNow();
    const archivedCountFallback = await prepareArchivedCount(uid);
    const targetNoteRef = noteRef(uid, data.noteId);
    const targetOperationRef = operationRef(uid, data.operationId);
    const targetEventRef = eventRef(
      uid,
      data.noteId,
      danwakuEventId("update", data.noteId, data.operationId),
    );
    let outcome = "updated";
    await firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, noteSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(targetNoteRef),
        transaction.get(targetOperationRef),
      ]);
      const receipt = inspectOperationReceipt(operationSnapshot, data, data.noteId);
      if (receipt.replayed) {
        outcome = receipt.outcome;
        return;
      }
      const note = normalizeDanwakuNote(noteSnapshot.data(), data.noteId);
      if (!note || note.status === "deleted") {
        throw new DanwakuNoteError("not-found", "断惑NOTEが見つかりません。");
      }
      if (note.status !== "active") {
        throw new DanwakuNoteError("failed-precondition", "終了した断惑NOTEは編集できません。");
      }
      const previousProfile = serviceProfile(
        profileSnapshot.data(),
        timestamp,
        archivedCountFallback,
      );
      if (note.title === data.title && note.commitment === data.commitment) {
        outcome = "unchanged";
        if (storedArchivedCount(profileSnapshot.data()) === null) {
          transaction.set(profileRef(uid), previousProfile);
        }
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          outcome,
          timestamp,
        );
        return;
      }
      const nextNote = {
        ...note,
        title: data.title,
        commitment: data.commitment,
        revision: Math.min(Number.MAX_SAFE_INTEGER, note.revision + 1),
        updatedAt: timestamp,
      };
      const nextProfileValue = previousProfile.publicNoteId === data.noteId
        ? refreshDanwakuPublicCache(previousProfile, nextNote, timestamp)
        : bumpProfile(previousProfile, timestamp);
      const nextProfile = {
        ...nextProfileValue,
        archivedCount: previousProfile.archivedCount,
      };
      transaction.set(targetNoteRef, nextNote);
      transaction.set(profileRef(uid), nextProfile);
      transaction.create(targetEventRef, mutationEvent("update", note, timestamp));
      createOperationReceipt(
        transaction,
        targetOperationRef,
        data,
        data.noteId,
        receipt.requestHash,
        outcome,
        timestamp,
      );
      writeProjectionChanges(
        transaction,
        uid,
        previousProfile,
        nextProfile,
        nextNote,
        timestamp,
      );
    });
    await pruneNoteEvents(uid, data.noteId);
    return { outcome, noteId: data.noteId, state: await getState(uid), newlyUnlocked: [] };
  }

  async function continueNote(uidValue, data) {
    const uid = requireUid(uidValue);
    const timestamp = serverNow();
    const archivedCountFallback = await prepareArchivedCount(uid);
    const dayKey = danwakuDayKey(timestamp);
    const targetNoteRef = noteRef(uid, data.noteId);
    const targetOperationRef = operationRef(uid, data.operationId);
    const targetEventRef = eventRef(
      uid,
      data.noteId,
      danwakuEventId("continue", data.noteId, dayKey),
    );
    let result = null;
    let achievementProfile = null;
    await firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, noteSnapshot, eventSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(targetNoteRef),
        transaction.get(targetEventRef),
        transaction.get(targetOperationRef),
      ]);
      const receipt = inspectOperationReceipt(operationSnapshot, data, data.noteId);
      if (receipt.replayed) {
        result = { outcome: receipt.outcome, changed: false, newlyUnlocked: [] };
        return;
      }
      const note = normalizeDanwakuNote(noteSnapshot.data(), data.noteId);
      if (!note || note.status === "deleted") {
        throw new DanwakuNoteError("not-found", "断惑NOTEが見つかりません。");
      }
      const previousProfile = serviceProfile(
        profileSnapshot.data(),
        timestamp,
        archivedCountFallback,
      );
      result = continueDanwakuNote(note, previousProfile, timestamp);
      if (!result.changed) {
        if (storedArchivedCount(profileSnapshot.data()) === null) {
          transaction.set(profileRef(uid), previousProfile);
        }
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          result.outcome,
          timestamp,
        );
        return;
      }
      if (eventSnapshot.exists) {
        result = { outcome: "already-recorded", changed: false, note, profile: previousProfile };
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          result.outcome,
          timestamp,
        );
        return;
      }
      result.profile = { ...result.profile, archivedCount: previousProfile.archivedCount };
      const achievementSnapshot = await transaction.get(achievementProfileRef(uid));
      const normalizedAchievementProfile = normalizeAchievementProfile(achievementSnapshot.data());
      const eligibleIds = eligibleAchievementIds({
        danwakuStats: { highestEverDays: result.profile.highestEverDays },
        scope: "danwaku",
      });
      const unlockResult = unlockAchievements(
        normalizedAchievementProfile,
        eligibleIds,
        timestamp,
      );
      achievementProfile = unlockResult.profile;
      result.newlyUnlocked = unlockResult.newlyUnlocked;
      transaction.set(targetNoteRef, result.note);
      transaction.set(profileRef(uid), result.profile);
      transaction.create(targetEventRef, result.event);
      createOperationReceipt(
        transaction,
        targetOperationRef,
        data,
        data.noteId,
        receipt.requestHash,
        result.outcome,
        timestamp,
      );
      if (!achievementSnapshot.exists || unlockResult.newlyUnlocked.length) {
        transaction.set(achievementProfileRef(uid), unlockResult.profile);
      }
      writeProjectionChanges(
        transaction,
        uid,
        previousProfile,
        result.profile,
        result.note,
        timestamp,
      );
    });
    await pruneNoteEvents(uid, data.noteId);
    if (result?.newlyUnlocked?.length
        && typeof deps.syncAchievementPublicSurfaces === "function") {
      try {
        await deps.syncAchievementPublicSurfaces(uid, achievementProfile);
      } catch (error) {
        logger.warn?.("Danwaku achievement public sync failed", {
          category: typeof error?.code === "string" ? error.code : "internal",
        });
      }
    }
    return {
      outcome: result?.outcome || "already-recorded",
      noteId: data.noteId,
      dayKey,
      newlyUnlocked: result?.newlyUnlocked || [],
      state: await getState(uid),
    };
  }

  async function resetNote(uidValue, data) {
    const uid = requireUid(uidValue);
    const timestamp = serverNow();
    const archivedCountFallback = await prepareArchivedCount(uid);
    const targetNoteRef = noteRef(uid, data.noteId);
    const targetOperationRef = operationRef(uid, data.operationId);
    const targetEventRef = eventRef(
      uid,
      data.noteId,
      danwakuEventId("reset", data.noteId, data.operationId),
    );
    let result = null;
    await firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, noteSnapshot, eventSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(targetNoteRef),
        transaction.get(targetEventRef),
        transaction.get(targetOperationRef),
      ]);
      const receipt = inspectOperationReceipt(operationSnapshot, data, data.noteId);
      if (receipt.replayed) {
        result = { outcome: receipt.outcome, changed: false };
        return;
      }
      const note = normalizeDanwakuNote(noteSnapshot.data(), data.noteId);
      if (!note || note.status === "deleted") {
        throw new DanwakuNoteError("not-found", "断惑NOTEが見つかりません。");
      }
      const previousProfile = serviceProfile(
        profileSnapshot.data(),
        timestamp,
        archivedCountFallback,
      );
      if (eventSnapshot.exists) {
        result = { outcome: "reset", changed: false, note, profile: previousProfile };
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          result.outcome,
          timestamp,
        );
        return;
      }
      result = resetDanwakuNote(note, previousProfile, timestamp);
      if (!result.changed) {
        if (storedArchivedCount(profileSnapshot.data()) === null) {
          transaction.set(profileRef(uid), previousProfile);
        }
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          result.outcome,
          timestamp,
        );
        return;
      }
      result.profile = { ...result.profile, archivedCount: previousProfile.archivedCount };
      transaction.set(targetNoteRef, result.note);
      transaction.set(profileRef(uid), result.profile);
      transaction.create(targetEventRef, result.event);
      createOperationReceipt(
        transaction,
        targetOperationRef,
        data,
        data.noteId,
        receipt.requestHash,
        result.outcome,
        timestamp,
      );
      writeProjectionChanges(
        transaction,
        uid,
        previousProfile,
        result.profile,
        result.note,
        timestamp,
      );
    });
    await pruneNoteEvents(uid, data.noteId);
    return {
      outcome: result?.outcome || "already-zero",
      noteId: data.noteId,
      dayKey: danwakuDayKey(timestamp),
      newlyUnlocked: [],
      state: await getState(uid),
    };
  }

  async function changeNoteStatus(uidValue, data) {
    const uid = requireUid(uidValue);
    const timestamp = serverNow();
    const archivedCountFallback = await prepareArchivedCount(uid);
    const targetNoteRef = noteRef(uid, data.noteId);
    const targetOperationRef = operationRef(uid, data.operationId);
    const targetEventRef = eventRef(
      uid,
      data.noteId,
      danwakuEventId(data.action, data.noteId, data.operationId),
    );
    let outcome = data.action;
    await firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, noteSnapshot, eventSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(targetNoteRef),
        transaction.get(targetEventRef),
        transaction.get(targetOperationRef),
      ]);
      const receipt = inspectOperationReceipt(operationSnapshot, data, data.noteId);
      if (receipt.replayed) {
        outcome = receipt.outcome;
        return;
      }
      const note = normalizeDanwakuNote(noteSnapshot.data(), data.noteId);
      if (!note || note.status === "deleted") {
        throw new DanwakuNoteError("not-found", "断惑NOTEが見つかりません。");
      }
      if (eventSnapshot.exists) {
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          outcome,
          timestamp,
        );
        return;
      }
      const previousProfile = serviceProfile(
        profileSnapshot.data(),
        timestamp,
        archivedCountFallback,
      );
      if (data.action === "archive" && note.status === "archived") {
        outcome = "already-archived";
        if (storedArchivedCount(profileSnapshot.data()) === null) {
          transaction.set(profileRef(uid), previousProfile);
        }
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          outcome,
          timestamp,
        );
        return;
      }
      if (data.action === "restore" && note.status === "active") {
        outcome = "already-active";
        if (storedArchivedCount(profileSnapshot.data()) === null) {
          transaction.set(profileRef(uid), previousProfile);
        }
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          outcome,
          timestamp,
        );
        return;
      }
      if (data.action === "archive"
          && previousProfile.archivedCount >= DANWAKU_ARCHIVED_NOTE_LIMIT) {
        throw new DanwakuNoteError(
          "resource-exhausted",
          `終了済みの断惑NOTEは${DANWAKU_ARCHIVED_NOTE_LIMIT}件までです。`,
        );
      }
      if (data.action === "restore" && previousProfile.activeNoteCount >= DANWAKU_ACTIVE_NOTE_LIMIT) {
        throw new DanwakuNoteError(
          "resource-exhausted",
          `進行中の断惑NOTEは${DANWAKU_ACTIVE_NOTE_LIMIT}件までです。`,
        );
      }
      let nextNote = { ...note };
      let nextProfile = bumpProfile(previousProfile, timestamp);
      if (data.action === "archive") {
        if (note.status !== "active") {
          throw new DanwakuNoteError("failed-precondition", "この断惑NOTEは終了できません。");
        }
        nextNote = {
          ...note,
          status: "archived",
          archivedAt: timestamp,
          updatedAt: timestamp,
          revision: Math.min(Number.MAX_SAFE_INTEGER, note.revision + 1),
        };
        nextProfile.activeNoteCount = Math.max(0, previousProfile.activeNoteCount - 1);
        nextProfile.archivedCount = previousProfile.archivedCount + 1;
      } else if (data.action === "restore") {
        if (note.status !== "archived") {
          throw new DanwakuNoteError("failed-precondition", "この断惑NOTEは再開できません。");
        }
        nextNote = {
          ...note,
          status: "active",
          archivedAt: 0,
          updatedAt: timestamp,
          revision: Math.min(Number.MAX_SAFE_INTEGER, note.revision + 1),
        };
        nextProfile.activeNoteCount = previousProfile.activeNoteCount + 1;
        if (previousProfile.archivedCount > DANWAKU_ARCHIVED_NOTE_LIMIT) {
          nextProfile.archivedCount = previousProfile.archivedCount;
        } else {
          nextProfile.archivedCount = Math.max(0, previousProfile.archivedCount - 1);
        }
      }
      if (previousProfile.publicNoteId === data.noteId) {
        nextProfile = clearPublicSettings({
          ...nextProfile,
          revision: Math.max(0, nextProfile.revision - 1),
        }, timestamp);
      }
      transaction.set(targetNoteRef, nextNote);
      transaction.set(profileRef(uid), nextProfile);
      transaction.create(targetEventRef, mutationEvent(data.action, note, timestamp, {
        afterDays: nextNote.currentDays,
      }));
      createOperationReceipt(
        transaction,
        targetOperationRef,
        data,
        data.noteId,
        receipt.requestHash,
        outcome,
        timestamp,
      );
      writeProjectionChanges(
        transaction,
        uid,
        previousProfile,
        nextProfile,
        nextNote,
        timestamp,
      );
    });
    await pruneNoteEvents(uid, data.noteId);
    if (data.action === "restore") await reconcileArchivedOverflow(uid);
    return { outcome, noteId: data.noteId, newlyUnlocked: [], state: await getState(uid) };
  }

  async function deleteNote(uidValue, data) {
    const uid = requireUid(uidValue);
    const timestamp = serverNow();
    const archivedCountFallback = await prepareArchivedCount(uid);
    const targetNoteRef = noteRef(uid, data.noteId);
    const targetOperationRef = operationRef(uid, data.operationId);
    let outcome = "deleted";
    await firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, noteSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(targetNoteRef),
        transaction.get(targetOperationRef),
      ]);
      const receipt = inspectOperationReceipt(operationSnapshot, data, data.noteId);
      if (receipt.replayed) {
        outcome = receipt.outcome;
        return;
      }
      const note = normalizeDanwakuNote(noteSnapshot.data(), data.noteId);
      if (!note || note.status === "deleted") {
        throw new DanwakuNoteError("not-found", "断惑NOTEが見つかりません。");
      }
      const previousProfile = serviceProfile(
        profileSnapshot.data(),
        timestamp,
        archivedCountFallback,
      );
      let nextProfile = bumpProfile(previousProfile, timestamp);
      if (note.status === "active") {
        nextProfile.activeNoteCount = Math.max(0, previousProfile.activeNoteCount - 1);
      } else if (note.status === "archived") {
        if (previousProfile.archivedCount > DANWAKU_ARCHIVED_NOTE_LIMIT) {
          nextProfile.archivedCount = previousProfile.archivedCount;
        } else {
          nextProfile.archivedCount = Math.max(0, previousProfile.archivedCount - 1);
        }
      }
      nextProfile.noteCount = Math.max(0, previousProfile.noteCount - 1);
      if (previousProfile.publicNoteId === data.noteId) {
        nextProfile = clearPublicSettings({
          ...nextProfile,
          revision: Math.max(0, nextProfile.revision - 1),
        }, timestamp);
      }
      const redactedNote = {
        ...note,
        title: "",
        commitment: "",
        status: "deleted",
        currentDays: 0,
        currentRunStartedDayKey: "",
        deletedAt: timestamp,
        updatedAt: timestamp,
        revision: Math.min(Number.MAX_SAFE_INTEGER, note.revision + 1),
      };
      transaction.set(targetNoteRef, redactedNote);
      transaction.set(profileRef(uid), nextProfile);
      createOperationReceipt(
        transaction,
        targetOperationRef,
        data,
        data.noteId,
        receipt.requestHash,
        outcome,
        timestamp,
      );
      writeProjectionChanges(
        transaction,
        uid,
        previousProfile,
        nextProfile,
        redactedNote,
        timestamp,
      );
    });
    if (typeof firestore.recursiveDelete !== "function") {
      throw new TypeError("Danwaku delete requires Firestore recursiveDelete");
    }
    await firestore.recursiveDelete(targetNoteRef);
    await reconcileArchivedOverflow(uid);
    return { outcome, noteId: data.noteId, newlyUnlocked: [], state: await getState(uid) };
  }

  async function setPublic(uidValue, data) {
    const uid = requireUid(uidValue);
    const timestamp = serverNow();
    const targetOperationRef = operationRef(uid, data.operationId);
    const existingReceipt = inspectOperationReceipt(
      await targetOperationRef.get(),
      data,
      data.noteId,
    );
    if (existingReceipt.replayed) {
      return {
        outcome: existingReceipt.outcome,
        noteId: data.noteId,
        newlyUnlocked: [],
        state: await getState(uid),
      };
    }
    const archivedCountFallback = await prepareArchivedCount(uid);
    const resolvedDisplayName = data.rankingVisible
      ? await serverDisplayName(uid)
      : "";
    const proposedEntryId = data.rankingVisible
      ? createDanwakuOpaqueId(randomBytes)
      : "";
    let outcome = "saved";
    let historyNoteId = data.noteId;
    await firestore.runTransaction(async (transaction) => {
      const [initialProfileSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(profileRef(uid)),
        transaction.get(targetOperationRef),
      ]);
      const receipt = inspectOperationReceipt(operationSnapshot, data, data.noteId);
      if (receipt.replayed) {
        outcome = receipt.outcome;
        return;
      }
      const previousProfile = serviceProfile(
        initialProfileSnapshot.data(),
        timestamp,
        archivedCountFallback,
      );
      const eventNoteId = data.noteId || previousProfile.publicNoteId;
      historyNoteId = eventNoteId;
      if (!eventNoteId) {
        outcome = "unchanged";
        if (storedArchivedCount(initialProfileSnapshot.data()) === null) {
          transaction.set(profileRef(uid), previousProfile);
        }
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          outcome,
          timestamp,
        );
        return;
      }
      const targetNoteRef = noteRef(uid, eventNoteId);
      const targetEventRef = eventRef(
        uid,
        eventNoteId,
        danwakuEventId("set_public", eventNoteId, data.operationId),
      );
      const [noteSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(targetNoteRef),
        transaction.get(targetEventRef),
      ]);
      const note = normalizeDanwakuNote(noteSnapshot.data(), eventNoteId);
      if (!note || note.status === "deleted") {
        throw new DanwakuNoteError("not-found", "断惑NOTEが見つかりません。");
      }
      if (eventSnapshot.exists) {
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          outcome,
          timestamp,
        );
        return;
      }
      if ((data.rankingVisible || data.matchVisible) && note.status !== "active") {
        throw new DanwakuNoteError("failed-precondition", "終了した断惑NOTEは公開できません。");
      }
      const unchanged = previousProfile.publicNoteId === data.noteId
        && previousProfile.rankingVisible === data.rankingVisible
        && previousProfile.matchVisible === data.matchVisible
        && previousProfile.shareTitle === data.shareTitle
        && previousProfile.displayName === resolvedDisplayName;
      if (unchanged) {
        outcome = "unchanged";
        if (storedArchivedCount(initialProfileSnapshot.data()) === null) {
          transaction.set(profileRef(uid), previousProfile);
        }
        createOperationReceipt(
          transaction,
          targetOperationRef,
          data,
          data.noteId,
          receipt.requestHash,
          outcome,
          timestamp,
        );
        return;
      }
      let nextProfile = null;
      if (!data.rankingVisible && !data.matchVisible) {
        nextProfile = clearPublicSettings(previousProfile, timestamp);
      } else {
        const settings = {
          ...previousProfile,
          publicNoteId: data.noteId,
          rankingVisible: data.rankingVisible,
          matchVisible: data.matchVisible,
          shareTitle: data.shareTitle,
          displayName: resolvedDisplayName,
          publicEntryId: data.rankingVisible
            ? previousProfile.publicEntryId || proposedEntryId
            : "",
        };
        nextProfile = {
          ...refreshDanwakuPublicCache(settings, note, timestamp),
          archivedCount: previousProfile.archivedCount,
        };
      }
      transaction.set(profileRef(uid), nextProfile);
      transaction.create(targetEventRef, mutationEvent("set_public", note, timestamp, {
        rankingVisible: data.rankingVisible,
        matchVisible: data.matchVisible,
      }));
      createOperationReceipt(
        transaction,
        targetOperationRef,
        data,
        data.noteId,
        receipt.requestHash,
        outcome,
        timestamp,
      );
      writeProjectionChanges(
        transaction,
        uid,
        previousProfile,
        nextProfile,
        note,
        timestamp,
      );
    });
    if (DANWAKU_ID_PATTERN.test(historyNoteId)) {
      await pruneNoteEvents(uid, historyNoteId);
    }
    return { outcome, noteId: data.noteId, newlyUnlocked: [], state: await getState(uid) };
  }

  async function dispatch(uidValue, rawData) {
    const uid = requireUid(uidValue);
    try {
      const data = normalizeDanwakuActionData(rawData);
      if (data.action === "state") return await getState(uid);
      if (data.action === "ranking") return await getRanking(uid);
      if (data.action === "history") return await getHistory(uid, data);
      if (data.action === "create") return await createNote(uid, data);
      if (data.action === "update") return await updateNote(uid, data);
      if (data.action === "continue") return await continueNote(uid, data);
      if (data.action === "reset") return await resetNote(uid, data);
      if (["archive", "restore"].includes(data.action)) {
        return await changeNoteStatus(uid, data);
      }
      if (data.action === "delete") return await deleteNote(uid, data);
      if (data.action === "set_public") return await setPublic(uid, data);
      throw new DanwakuNoteError("invalid-argument", "未対応の断惑NOTE操作です。");
    } catch (error) {
      throw asHttpsError(error);
    }
  }

  return Object.freeze({
    dispatch,
    getState,
  });
}

module.exports = Object.freeze({
  REQUIRED_DEPENDENCIES,
  createDanwakuNoteService,
});
