"use strict";

const crypto = require("node:crypto");

const SERVER_RATE_FLOOR_ENTRY_ID_BYTES = 18;
const SERVER_RATE_FLOOR_MINIMUM_MATCHES = 10;
const SERVER_RATE_FLOOR_HIDDEN_RATING = 3001;
const SERVER_RATE_FLOOR_REVISION_MAX = Number.MAX_SAFE_INTEGER;

function createServerRateFloorEntryId() {
  return crypto.randomBytes(SERVER_RATE_FLOOR_ENTRY_ID_BYTES).toString("base64url");
}

function isServerRateFloorEntryId(value) {
  return /^[A-Za-z0-9_-]{24}$/.test(String(value || ""));
}

function normalizeServerRateFloorRevision(value) {
  const revision = Math.floor(Number(value));
  if (!Number.isFinite(revision)) return 0;
  return Math.min(SERVER_RATE_FLOOR_REVISION_MAX, Math.max(0, revision));
}

function nextServerRateFloorRevision(value) {
  return Math.min(
    SERVER_RATE_FLOOR_REVISION_MAX,
    normalizeServerRateFloorRevision(value) + 1,
  );
}

function serverRateFloorMirrorDecision(currentValue, {
  publicEntry = null,
  revision = 0,
  rulesetVersion = 0,
} = {}) {
  const current = currentValue && typeof currentValue === "object"
    ? currentValue
    : null;
  const nextRevision = normalizeServerRateFloorRevision(revision);
  const currentRevision = normalizeServerRateFloorRevision(current?.syncRevision);
  const nextHidden = !publicEntry;
  const currentHidden = current?.rateFloorHidden === true;

  if (current && currentRevision > nextRevision) {
    return { committed: false, value: current };
  }
  // A participation transition always advances the Firestore revision. If two
  // same-revision deliveries disagree about visibility, retain the value that
  // won the CAS instead of allowing a stale visibility flip.
  if (current
      && currentRevision === nextRevision
      && currentHidden !== nextHidden) {
    return { committed: false, value: current };
  }
  if (publicEntry) {
    return {
      committed: true,
      value: {
        ...publicEntry,
        syncRevision: nextRevision,
      },
    };
  }
  if (!current && nextRevision === 0) {
    return { committed: false, value: null };
  }
  return {
    committed: true,
    value: {
      serverVerified: true,
      rulesetVersion,
      rateFloorHidden: true,
      rating: SERVER_RATE_FLOOR_HIDDEN_RATING,
      serverMatches: 0,
      syncRevision: nextRevision,
    },
  };
}

module.exports = {
  SERVER_RATE_FLOOR_ENTRY_ID_BYTES,
  SERVER_RATE_FLOOR_HIDDEN_RATING,
  SERVER_RATE_FLOOR_MINIMUM_MATCHES,
  SERVER_RATE_FLOOR_REVISION_MAX,
  createServerRateFloorEntryId,
  isServerRateFloorEntryId,
  nextServerRateFloorRevision,
  normalizeServerRateFloorRevision,
  serverRateFloorMirrorDecision,
};
