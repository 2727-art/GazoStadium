import {
  TRAINING_V6_PROTOCOL_VERSION,
  TRAINING_V6_VARIANT,
} from "./training-v6-domain.mjs";
import {
  normalizeTrainingV6ServerSnapshot,
} from "./training-v6-machine.mjs";

export const TRAINING_V6_CLIENT_VERSION = "training-v6-mvp-1";

const SAFE_ACTION = /^[a-z][a-z0-9_]{1,39}$/;
const SAFE_CLIENT_VERSION = /^[-_.0-9A-Za-z]{1,64}$/;
const SAFE_TOKEN = /^[-_0-9A-Za-z]{8,128}$/;
const REQUEST_KEYS = Object.freeze([
  "protocolVersion",
  "variant",
  "clientVersion",
  "action",
  "actionId",
  "expectedRevision",
  "roomId",
  "payload",
]);

function isRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function requireValue(valid, label) {
  if (!valid) throw new TypeError(`${label} is invalid`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clonePayload(value, seen = new WeakSet()) {
  if (value === null
      || typeof value === "string"
      || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("payload number is invalid");
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new TypeError("payload must be acyclic JSON");
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((child) => clonePayload(child, seen));
  } else {
    result = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined
          || typeof child === "function"
          || typeof child === "symbol"
          || typeof child === "bigint") {
        throw new TypeError("payload must contain JSON values");
      }
      result[key] = clonePayload(child, seen);
    }
  }
  seen.delete(value);
  return result;
}

function unwrapTransportResult(value) {
  return isRecord(value) && Object.hasOwn(value, "data")
    ? value.data
    : value;
}

export function validateTrainingV6ApiRequest(value) {
  return hasExactKeys(value, REQUEST_KEYS)
    && value.protocolVersion === TRAINING_V6_PROTOCOL_VERSION
    && value.variant === TRAINING_V6_VARIANT
    && typeof value.clientVersion === "string"
    && SAFE_CLIENT_VERSION.test(value.clientVersion)
    && typeof value.action === "string"
    && SAFE_ACTION.test(value.action)
    && typeof value.actionId === "string"
    && SAFE_TOKEN.test(value.actionId)
    && Number.isSafeInteger(value.expectedRevision)
    && value.expectedRevision >= 0
    && (
      value.roomId === null
      || (typeof value.roomId === "string" && SAFE_TOKEN.test(value.roomId))
    )
    && isRecord(value.payload);
}

export function createTrainingV6ApiRequest({
  action,
  actionId,
  expectedRevision,
  roomId = null,
  payload = {},
  clientVersion = TRAINING_V6_CLIENT_VERSION,
} = {}) {
  requireValue(isRecord(payload), "payload");
  const request = {
    protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
    variant: TRAINING_V6_VARIANT,
    clientVersion,
    action,
    actionId,
    expectedRevision,
    roomId,
    payload: clonePayload(payload),
  };
  requireValue(validateTrainingV6ApiRequest(request), "request");
  return deepFreeze(request);
}

export function createTrainingV6HandshakeRequest({
  actionId,
  clientVersion = TRAINING_V6_CLIENT_VERSION,
} = {}) {
  return createTrainingV6ApiRequest({
    action: "handshake",
    actionId,
    expectedRevision: 0,
    roomId: null,
    payload: {
      supportedProtocolVersions: [TRAINING_V6_PROTOCOL_VERSION],
      requestedVariant: TRAINING_V6_VARIANT,
    },
    clientVersion,
  });
}

export function createTrainingV6SnapshotActionRequest({
  action,
  actionId,
  snapshot,
  payload = {},
  clientVersion = TRAINING_V6_CLIENT_VERSION,
} = {}) {
  const canonical = normalizeTrainingV6ServerSnapshot(snapshot);
  requireValue(Boolean(canonical), "snapshot");
  return createTrainingV6ApiRequest({
    action,
    actionId,
    expectedRevision: canonical.revision,
    roomId: canonical.roomId,
    payload,
    clientVersion,
  });
}

export function interpretTrainingV6Handshake(value) {
  const response = unwrapTransportResult(value);
  if (!isRecord(response)) {
    return deepFreeze({
      compatible: false,
      reason: "handshake-invalid",
      protocolVersion: null,
      variant: null,
    });
  }
  const protocolVersion = Number(response.protocolVersion);
  const variant = String(response.variant || "");
  if (response.compatible === false
      || response.updateRequired === true
      || protocolVersion !== TRAINING_V6_PROTOCOL_VERSION
      || variant !== TRAINING_V6_VARIANT) {
    return deepFreeze({
      compatible: false,
      reason: "update-required",
      protocolVersion: Number.isSafeInteger(protocolVersion)
        ? protocolVersion
        : null,
      variant: variant || null,
    });
  }
  return deepFreeze({
    compatible: true,
    reason: "compatible",
    protocolVersion,
    variant,
  });
}

export function createTrainingV6SessionAdapter({
  transport,
  createActionId,
  clientVersion = TRAINING_V6_CLIENT_VERSION,
} = {}) {
  requireValue(typeof transport === "function", "transport");
  requireValue(typeof createActionId === "function", "createActionId");
  requireValue(
    typeof clientVersion === "string" && SAFE_CLIENT_VERSION.test(clientVersion),
    "clientVersion",
  );

  function nextActionId() {
    const actionId = createActionId();
    requireValue(
      typeof actionId === "string" && SAFE_TOKEN.test(actionId),
      "actionId",
    );
    return actionId;
  }

  async function dispatchRequest(request) {
    const response = unwrapTransportResult(await transport(request));
    const snapshotCandidate = isRecord(response)
      ? response.snapshot ?? response.room ?? response
      : response;
    return deepFreeze({
      request,
      response,
      snapshot: normalizeTrainingV6ServerSnapshot(snapshotCandidate),
    });
  }

  async function request(actionName, {
    actionId = nextActionId(),
    roomId = null,
    expectedRevision = 0,
    payload = {},
  } = {}) {
    const apiRequest = createTrainingV6ApiRequest({
      action: actionName,
      actionId,
      expectedRevision,
      roomId,
      payload,
      clientVersion,
    });
    return dispatchRequest(apiRequest);
  }

  async function handshake() {
    const request = createTrainingV6HandshakeRequest({
      actionId: nextActionId(),
      clientVersion,
    });
    const dispatched = await dispatchRequest(request);
    return deepFreeze({
      ...dispatched,
      handshake: interpretTrainingV6Handshake(dispatched.response),
    });
  }

  async function action({ action: actionName, snapshot, payload = {} } = {}) {
    const canonical = normalizeTrainingV6ServerSnapshot(snapshot);
    requireValue(Boolean(canonical), "snapshot");
    return request(actionName, {
      roomId: canonical.roomId,
      expectedRevision: canonical.revision,
      payload,
    });
  }

  return Object.freeze({ action, handshake, request });
}
