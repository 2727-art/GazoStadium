"use strict";

const FREE_TABLE_P2P_DIAGNOSTIC_ID_PATTERN = /^[A-Za-z0-9_-]{20,40}$/;
const FREE_TABLE_P2P_DIAGNOSTIC_UID_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const FREE_TABLE_P2P_DIAGNOSTIC_RTDB_KEY_FORBIDDEN_PATTERN = /[.#$\[\]\/]/u;
const FREE_TABLE_P2P_DIAGNOSTIC_SESSION_STATUSES = new Set([
  "connecting",
  "active",
]);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function freeTableP2pDiagnosticIdIsSafe(value) {
  return typeof value === "string"
    && FREE_TABLE_P2P_DIAGNOSTIC_ID_PATTERN.test(value);
}

function freeTableP2pDiagnosticUidIsSafe(value) {
  return typeof value === "string"
    && Boolean(value)
    && value.length <= 128
    && !FREE_TABLE_P2P_DIAGNOSTIC_UID_CONTROL_PATTERN.test(value)
    && !FREE_TABLE_P2P_DIAGNOSTIC_RTDB_KEY_FORBIDDEN_PATTERN.test(value);
}

function currentFreeTableP2pDiagnosticContext({
  uid,
  sessionId,
  sessionValue,
  activeValue,
  now = Date.now(),
} = {}) {
  const timestamp = Number(now);
  if (typeof uid !== "string"
      || !uid
      || !freeTableP2pDiagnosticIdIsSafe(sessionId)
      || !Number.isFinite(timestamp)
      || timestamp < 0
      || !isPlainObject(sessionValue)
      || !isPlainObject(activeValue)) return null;

  const session = sessionValue;
  const active = activeValue;
  const role = session.hostUid === uid
    ? "host"
    : session.visitorUid === uid
      ? "visitor"
      : "";
  const participants = isPlainObject(session.participants)
    ? session.participants
    : {};
  const sessionExpiresAt = Number(session.expiresAt);
  const hardExpiresAt = Number(session.hardExpiresAt || session.expiresAt);
  const activeExpiresAt = Number(active.expiresAt);
  const sessionHasGeneration = Object.hasOwn(session, "generation");
  const activeHasGeneration = Object.hasOwn(active, "generation");
  const generationsMatch = sessionHasGeneration === activeHasGeneration
    && (!sessionHasGeneration || (
      Number.isSafeInteger(session.generation)
      && session.generation > 0
      && session.generation === active.generation
    ));

  if (!role
      || session.protocolVersion !== 1
      || session.sessionId !== sessionId
      || !freeTableP2pDiagnosticIdIsSafe(session.roomId)
      || !freeTableP2pDiagnosticUidIsSafe(session.hostUid)
      || !freeTableP2pDiagnosticUidIsSafe(session.visitorUid)
      || session.hostUid === session.visitorUid
      || !FREE_TABLE_P2P_DIAGNOSTIC_SESSION_STATUSES.has(session.status)
      || participants[uid] !== true
      || participants[session.hostUid] !== true
      || participants[session.visitorUid] !== true
      || !Number.isFinite(sessionExpiresAt)
      || sessionExpiresAt <= timestamp
      || !Number.isFinite(hardExpiresAt)
      || hardExpiresAt <= timestamp
      || active.state !== "active"
      || active.sessionId !== sessionId
      || active.roomId !== session.roomId
      || active.role !== role
      || !Number.isFinite(activeExpiresAt)
      || activeExpiresAt <= timestamp
      || !generationsMatch) return null;

  return Object.freeze({
    sessionId,
    roomId: session.roomId,
    role,
  });
}

module.exports = Object.freeze({
  FREE_TABLE_P2P_DIAGNOSTIC_ID_PATTERN,
  currentFreeTableP2pDiagnosticContext,
  freeTableP2pDiagnosticIdIsSafe,
});
