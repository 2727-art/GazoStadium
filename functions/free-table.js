"use strict";

const crypto = require("node:crypto");

const FREE_TABLE_PROTOCOL_VERSION = 1;
const FREE_TABLE_PUBLIC_ROOM_TTL_MS = 2 * 60 * 1000;
const FREE_TABLE_REQUEST_TTL_MS = 2 * 60 * 1000;
const FREE_TABLE_CONNECTING_TTL_MS = 3 * 60 * 1000;
const FREE_TABLE_DISCONNECT_GRACE_MS = 2 * 60 * 1000;
const FREE_TABLE_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const FREE_TABLE_ENDED_RETENTION_MS = 15 * 60 * 1000;
const FREE_TABLE_RECONNECT_MERGE_MS = 30 * 60 * 1000;
const FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const FREE_TABLE_REPORT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const FREE_TABLE_VISIT_LEDGER_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const FREE_TABLE_LIST_LIMIT = 40;
const FREE_TABLE_LIST_SCAN_LIMIT = FREE_TABLE_LIST_LIMIT * 2;
const FREE_TABLE_REQUEST_LIMIT = 16;
const FREE_TABLE_BOOKMARK_LIMIT = 100;
const FREE_TABLE_BLOCK_LIMIT = 100;
const FREE_TABLE_RELATIONSHIP_LIMIT = 100;
const FREE_TABLE_REPORT_MESSAGE_LIMIT = 10;
const FREE_TABLE_REPORT_CHAT_SCAN_LIMIT = 80;
const FREE_TABLE_GROWTH_MILESTONES = Object.freeze([1, 3, 7, 15, 30]);
const FREE_TABLE_ROLEPLAY_LEVELS = Object.freeze(["none", "light", "full"]);
const FREE_TABLE_DURATIONS = Object.freeze(["5m", "15m", "30m", "leisurely"]);
const FREE_TABLE_END_KINDS = Object.freeze([
  "departure",
  "wrap_up",
  "safe_exit",
  "disconnected",
]);
const FREE_TABLE_REPORT_REASONS = Object.freeze([
  "harassment",
  "sexual",
  "hate",
  "privacy",
  "rights",
  "spam",
  "other",
]);
const FREE_TABLE_ACTIONS = Object.freeze([
  "save_space",
  "open",
  "list",
  "request",
  "cancel_request",
  "respond",
  "arrive",
  "end",
  "bookmark",
  "relationship",
  "block",
  "unblock",
  "report",
  "get_my_state",
]);
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const CHILD_ID_PATTERN = /^[A-Za-z0-9_-]{20,40}$/;
const THEME_ID_PATTERN = /^[A-Za-z0-9_-]{0,48}$/;
const UID_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const ROOM_LIMITS = Object.freeze({
  name: 24,
  description: 80,
  topic: 60,
  introduction: 160,
  journeyCue: 60,
  avoid: 80,
  welcome: 80,
  themeId: 48,
});
const CARD_LIMITS = Object.freeze({
  name: 24,
  activityTag: 24,
  message: 40,
});

class FreeTableCollisionError extends Error {}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function codePointLength(value) {
  return Array.from(String(value ?? "")).length;
}

function normalizeLine(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?|\n/gu, " ")
    .replace(TEXT_CONTROL_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function boundedLine(value, maximum) {
  return Array.from(normalizeLine(value)).slice(0, maximum).join("");
}

function safeMultiline(value, maximum) {
  return Array.from(String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(TEXT_CONTROL_PATTERN, "")
    .trim())
    .slice(0, maximum)
    .join("");
}

function normalizeMedia(value) {
  const source = objectValue(value);
  return Object.freeze({
    text: true,
    image: source.image === true,
    audio: source.audio === true,
    video: source.video === true,
  });
}

function validateMedia(value) {
  const source = objectValue(value);
  if (value != null && (value !== source || Array.isArray(value))) return false;
  if (source.text === false) return false;
  return ["text", "image", "audio", "video"].every((key) => (
    source[key] === undefined || typeof source[key] === "boolean"
  ));
}

function normalizeRoomSettings(value) {
  const source = objectValue(value);
  return Object.freeze({
    name: boundedLine(source.name, ROOM_LIMITS.name),
    description: boundedLine(source.description, ROOM_LIMITS.description),
    topic: boundedLine(source.topic, ROOM_LIMITS.topic),
    introduction: boundedLine(source.introduction, ROOM_LIMITS.introduction),
    journeyCue: boundedLine(source.journeyCue, ROOM_LIMITS.journeyCue),
    roleplayLevel: FREE_TABLE_ROLEPLAY_LEVELS.includes(source.roleplayLevel)
      ? source.roleplayLevel
      : "light",
    duration: FREE_TABLE_DURATIONS.includes(source.duration)
      ? source.duration
      : "15m",
    media: normalizeMedia(source.media),
    avoid: boundedLine(source.avoid, ROOM_LIMITS.avoid),
    welcome: boundedLine(source.welcome || "おかえり", ROOM_LIMITS.welcome),
    themeId: boundedLine(source.themeId, ROOM_LIMITS.themeId)
      .replace(/[^A-Za-z0-9_-]/gu, ""),
  });
}

function validateRoomSettings(value) {
  const source = objectValue(value);
  if (value !== source || !source.name || !source.topic) return false;
  for (const [field, maximum] of Object.entries(ROOM_LIMITS)) {
    if (source[field] !== undefined
        && (typeof source[field] !== "string"
          || codePointLength(normalizeLine(source[field])) > maximum)) return false;
  }
  if (source.themeId !== undefined
      && !THEME_ID_PATTERN.test(normalizeLine(source.themeId))) return false;
  if (source.roleplayLevel !== undefined
      && !FREE_TABLE_ROLEPLAY_LEVELS.includes(source.roleplayLevel)) return false;
  if (source.duration !== undefined
      && !FREE_TABLE_DURATIONS.includes(source.duration)) return false;
  if (!validateMedia(source.media)) return false;
  const normalized = normalizeRoomSettings(source);
  return Boolean(normalized.name && normalized.topic);
}

function normalizeCard(value) {
  const source = objectValue(value);
  return Object.freeze({
    name: boundedLine(source.name, CARD_LIMITS.name),
    activityTag: boundedLine(source.activityTag, CARD_LIMITS.activityTag),
    message: boundedLine(source.message, CARD_LIMITS.message),
    roleplayLevel: FREE_TABLE_ROLEPLAY_LEVELS.includes(source.roleplayLevel)
      ? source.roleplayLevel
      : "light",
    media: normalizeMedia(source.media),
  });
}

function validateCard(value) {
  const source = objectValue(value);
  if (value !== source || !source.name || !source.message) return false;
  for (const [field, maximum] of Object.entries(CARD_LIMITS)) {
    if (source[field] !== undefined
        && (typeof source[field] !== "string"
          || codePointLength(normalizeLine(source[field])) > maximum)) return false;
  }
  if (source.roleplayLevel !== undefined
      && !FREE_TABLE_ROLEPLAY_LEVELS.includes(source.roleplayLevel)) return false;
  return validateMedia(source.media)
    && Boolean(normalizeLine(source.name))
    && Boolean(normalizeLine(source.message));
}

function randomPublicId(randomBytes = crypto.randomBytes) {
  const value = randomBytes(18);
  if (!Buffer.isBuffer(value) || value.length !== 18) {
    throw new TypeError("free table ids require exactly 18 random bytes");
  }
  return value.toString("base64url");
}

function internalPairId(firstUid, secondUid) {
  return crypto
    .createHash("sha256")
    .update(["free-table-pair", ...[String(firstUid), String(secondUid)].sort()].join(":"))
    .digest("hex")
    .slice(0, 40);
}

function internalReportId(sessionId, reporterUid) {
  return crypto
    .createHash("sha256")
    .update(`free-table-report:${String(sessionId)}:${String(reporterUid)}`)
    .digest("hex")
    .slice(0, 40);
}

function fairShelfKey(uid, publicRoomId, now) {
  const rotation = Math.floor(Number(now) / (15 * 60 * 1000));
  return crypto
    .createHash("sha256")
    .update(`free-table-shelf:${uid}:${rotation}:${publicRoomId}`)
    .digest("hex");
}

function fairShelfCursor(uid, now) {
  const rotation = Math.floor(Number(now) / (15 * 60 * 1000));
  return crypto
    .createHash("sha256")
    .update(`free-table-shelf-cursor:${uid}:${rotation}`)
    .digest("base64url")
    .slice(0, 24);
}

function blockedInEitherDirection(firstBlockExists, secondBlockExists) {
  return firstBlockExists === true || secondBlockExists === true;
}

function growthStage(count) {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  let stage = 0;
  for (let index = 0; index < FREE_TABLE_GROWTH_MILESTONES.length; index += 1) {
    if (value >= FREE_TABLE_GROWTH_MILESTONES[index]) stage = index + 1;
  }
  return stage;
}

function normalizeGrowth(value) {
  const source = objectValue(value);
  const visitCount = Math.max(0, Math.floor(Number(source.visitCount) || 0));
  const growthCount = Math.max(0, Math.floor(Number(source.growthCount) || 0));
  return Object.freeze({
    visitCount,
    growthCount,
    stage: growthStage(growthCount),
  });
}

function topicToolboxForStage(stageValue) {
  const stage = Math.max(0, Math.min(5, Math.floor(Number(stageValue) || 0)));
  return Object.freeze([
    "いま食べたい一品",
    "最近見つけた小さな景色",
    "思わず笑った動物のしぐさ",
    "音だけで伝えるなら",
    "次の旅に持っていきたいもの",
  ].slice(0, stage));
}

function ownerGrowthProjection(value) {
  const growth = normalizeGrowth(value);
  const stageIds = ["", "light", "seat", "shelf", "window", "sendoff"];
  return Object.freeze({
    ...growth,
    stageId: stageIds[growth.stage] || "",
    topicToolbox: topicToolboxForStage(growth.stage),
  });
}

function normalizeEndKind(value) {
  if (value === "ittekimasu") return "departure";
  if (value === "closed") return "wrap_up";
  return FREE_TABLE_END_KINDS.includes(value) ? value : "";
}

function normalizeDepartureLine(value) {
  const greeting = "いってきます";
  const line = boundedLine(value, 80)
    .replace(new RegExp(`${greeting}[。.!！?？]*$`, "u"), "")
    .trim()
    .replace(/[。.!！?？]+$/u, "");
  if (!line) return greeting;
  const prefixMaximum = 80 - codePointLength(greeting) - 1;
  const prefix = Array.from(line).slice(0, prefixMaximum).join("");
  return `${prefix}。${greeting}`;
}

function publicRoomProjection(value, now = Date.now()) {
  const source = objectValue(value);
  if (!PUBLIC_ID_PATTERN.test(String(source.publicRoomId || ""))
      || !PUBLIC_ID_PATTERN.test(String(source.publicMemberId || ""))
      || source.state !== "open"
      || Number(source.expiresAt || 0) <= Number(now)
      || !validateRoomSettings(source.space)
      || !validateCard(source.hostCard)) return null;
  return Object.freeze({
    protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
    publicRoomId: source.publicRoomId,
    publicMemberId: source.publicMemberId,
    state: "open",
    space: normalizeRoomSettings(source.space),
    hostCard: normalizeCard(source.hostCard),
    openedAt: Math.max(0, Number(source.openedAt || 0)),
    heartbeatAt: Math.max(0, Number(source.heartbeatAt || 0)),
    expiresAt: Math.max(0, Number(source.expiresAt || 0)),
  });
}

function publicRequestProjection(value) {
  const source = objectValue(value);
  if (!CHILD_ID_PATTERN.test(String(source.requestId || ""))
      || !PUBLIC_ID_PATTERN.test(String(source.publicMemberId || ""))
      || !validateCard(source.visitorCard)) return null;
  return Object.freeze({
    requestId: source.requestId,
    publicMemberId: source.publicMemberId,
    visitorCard: normalizeCard(source.visitorCard),
    requestedAt: Math.max(0, Number(source.requestedAt || 0)),
    expiresAt: Math.max(0, Number(source.expiresAt || 0)),
  });
}

function publicSessionProjection(uid, value) {
  const source = objectValue(value);
  const role = source.hostUid === uid ? "host" : source.visitorUid === uid ? "visitor" : "";
  if (!role || !CHILD_ID_PATTERN.test(String(source.sessionId || ""))) return null;
  const peerRole = role === "host" ? "visitor" : "host";
  const peerUid = role === "host" ? source.visitorUid : source.hostUid;
  const cards = objectValue(source.cards);
  const publicMembers = objectValue(source.publicMembers);
  const arrivals = objectValue(source.arrivals);
  const ending = objectValue(source.ending);
  const roomMedia = normalizeMedia(objectValue(source.space).media);
  const visitorMedia = normalizeMedia(objectValue(cards[source.visitorUid]).media);
  return Object.freeze({
    protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
    sessionId: source.sessionId,
    publicRoomId: String(source.publicRoomId || ""),
    status: String(source.status || ""),
    role,
    you: Object.freeze({
      role,
      card: normalizeCard(cards[uid]),
    }),
    peer: Object.freeze({
      role: peerRole,
      publicMemberId: String(publicMembers[peerUid] || ""),
      card: normalizeCard(cards[peerUid]),
    }),
    negotiatedMedia: Object.freeze({
      text: true,
      image: roomMedia.image && visitorMedia.image,
      audio: roomMedia.audio && visitorMedia.audio,
      video: roomMedia.video && visitorMedia.video,
    }),
    space: normalizeRoomSettings(source.space),
    admissionAccepted: source.admissionAccepted === true,
    p2pConnected: source.p2pConnected === true,
    seatEstablished: source.admissionAccepted === true
      && source.p2pConnected === true
      && arrivals.host === true
      && arrivals.visitor === true,
    arrivals: Object.freeze({
      you: arrivals[role] === true,
      peer: arrivals[peerRole] === true,
      host: arrivals.host === true,
      visitor: arrivals.visitor === true,
    }),
    createdAt: Math.max(0, Number(source.createdAt || 0)),
    startedAt: Math.max(0, Number(source.startedAt || 0)),
    endedAt: Math.max(0, Number(source.endedAt || 0)),
    expiresAt: Math.max(0, Number(source.expiresAt || 0)),
    ...(ending.kind ? {
      ending: Object.freeze({
        kind: String(ending.kind),
        line: boundedLine(ending.line, 80),
        sendoffLine: boundedLine(ending.sendoffLine, 80),
      }),
    } : {}),
  });
}

function publicSpaceState(value) {
  const source = objectValue(value);
  if (!source.space || !source.hostCard) return null;
  return Object.freeze({
    protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
    publicRoomId: String(source.publicRoomId || ""),
    publicMemberId: String(source.publicMemberId || ""),
    space: normalizeRoomSettings(source.space),
    hostCard: normalizeCard(source.hostCard),
    growth: ownerGrowthProjection(source.growth),
    updatedAt: Math.max(0, Number(source.updatedAt || 0)),
  });
}

function exactPayload(data, requiredKeys, optionalKeys = []) {
  const source = objectValue(data);
  const allowed = new Set(["action", ...requiredKeys, ...optionalKeys]);
  if (data !== source
      || Reflect.ownKeys(source).some((key) => (
        typeof key !== "string" || !allowed.has(key)
      ))
      || requiredKeys.some((key) => !Object.hasOwn(source, key))) return null;
  return source;
}

function nextHostOpenClaim(currentValue, proposal, now) {
  const current = objectValue(currentValue);
  const proposalGeneration = Number(proposal?.generation || 0);
  if (!Number.isSafeInteger(proposalGeneration) || proposalGeneration <= 0) return null;
  if (current.state === "active" && Number(current.expiresAt || 0) > now) return null;
  if (current.state === "open"
      && Number(current.expiresAt || 0) > now
      && current.publicRoomId === proposal.publicRoomId
      && CHILD_ID_PATTERN.test(String(current.roomId || ""))) {
    const currentGeneration = Number(current.generation || 0);
    if (current.roomId !== proposal.roomId
        || (Number.isSafeInteger(currentGeneration)
          && currentGeneration > proposalGeneration)) return null;
    return {
      ...current,
      generation: proposalGeneration,
      heartbeatAt: proposal.heartbeatAt,
      expiresAt: proposal.expiresAt,
    };
  }
  if (current.state === "open" && Number(current.expiresAt || 0) > now) return null;
  if (current.state && Number(current.expiresAt || 0) > now) return null;
  return { ...proposal };
}

function nextVisitorPendingClaim(currentValue, proposal, now) {
  const current = objectValue(currentValue);
  if (current.requestId
      && Number(current.expiresAt || 0) > now
      && current.publicRoomId !== proposal.publicRoomId) return null;
  if (current.requestId
      && Number(current.expiresAt || 0) > now
      && current.publicRoomId === proposal.publicRoomId) return { ...current };
  return { ...proposal };
}

function nextRoomRequests(currentValue, requestValue, now, limit = FREE_TABLE_REQUEST_LIMIT) {
  const current = objectValue(currentValue);
  const request = objectValue(requestValue);
  const requestId = String(request.requestId || "");
  const requests = {};
  let pruned = false;
  for (const [storedRequestId, storedRequest] of Object.entries(current)) {
    if (Number(storedRequest?.expiresAt || 0) <= now) {
      pruned = true;
      continue;
    }
    requests[storedRequestId] = storedRequest;
  }
  const existing = objectValue(requests[requestId]);
  if (Object.keys(existing).length > 0
      && (existing.requestId !== requestId
        || existing.visitorUid !== request.visitorUid)) {
    return { accepted: false, reason: "collision", pruned, requests };
  }
  if (Object.keys(existing).length === 0
      && Object.keys(requests).length >= Math.max(1, Number(limit) || 1)) {
    return { accepted: false, reason: "full", pruned, requests };
  }
  requests[requestId] = request;
  return { accepted: true, reason: "accepted", pruned, requests };
}

function nextEngagementClaim(currentValue, proposal, now) {
  const current = objectValue(currentValue);
  const proposalGeneration = Number(proposal?.generation || 0);
  if (proposal?.state === "host_open"
      && (!Number.isSafeInteger(proposalGeneration) || proposalGeneration <= 0)) return null;
  if (current.state && Number(current.expiresAt || 0) > now) {
    if (current.state === "host_open"
        && proposal.state === "host_open"
        && current.publicRoomId === proposal.publicRoomId) {
      const currentGeneration = Number(current.generation || 0);
      if (Number.isSafeInteger(currentGeneration)
          && currentGeneration > proposalGeneration) return null;
      return {
        ...current,
        generation: proposalGeneration,
        heartbeatAt: proposal.heartbeatAt,
        expiresAt: proposal.expiresAt,
      };
    }
    if (current.state === "visitor_pending"
        && proposal.state === "visitor_pending"
        && current.publicRoomId === proposal.publicRoomId) {
      return { ...current };
    }
    return null;
  }
  return { ...proposal };
}

function activeEngagementValue(role, {
  roomId,
  sessionId,
  publicRoomId,
  generation,
  expiresAt,
  now,
}) {
  return {
    state: "active",
    role,
    roomId,
    publicRoomId,
    sessionId,
    ...(Number.isSafeInteger(Number(generation)) && Number(generation) > 0
      ? { generation: Number(generation) }
      : {}),
    heartbeatAt: now,
    expiresAt,
  };
}

function nextHostAdmissionClaim(currentValue, proposal, now) {
  const current = objectValue(currentValue);
  if (current.state === "active"
      && current.role === "host"
      && current.sessionId === proposal.sessionId) return { ...current };
  if (current.state === "host_admitting"
      && current.sessionId === proposal.sessionId
      && current.roomId === proposal.roomId
      && current.requestId === proposal.requestId) return { ...current };
  if (current.state !== "host_open"
      || current.roomId !== proposal.roomId
      || current.publicRoomId !== proposal.publicRoomId
      || Number(current.expiresAt || 0) <= now) return null;
  return {
    state: "host_admitting",
    role: "host",
    roomId: proposal.roomId,
    publicRoomId: proposal.publicRoomId,
    requestId: proposal.requestId,
    sessionId: proposal.sessionId,
    ...(Number.isSafeInteger(Number(current.generation))
      && Number(current.generation) > 0
      ? { generation: Number(current.generation) }
      : {}),
    heartbeatAt: now,
    expiresAt: proposal.expiresAt,
    previousHeartbeatAt: Number(current.heartbeatAt || 0),
    previousExpiresAt: Number(current.expiresAt || 0),
    previousGeneration: Number(current.generation || 0),
  };
}

function nextVisitorAdmissionClaim(currentValue, proposal, now) {
  const current = objectValue(currentValue);
  if (current.state === "active"
      && current.role === "visitor"
      && current.sessionId === proposal.sessionId) return { ...current };
  if (current.state !== "visitor_pending"
      || current.roomId !== proposal.roomId
      || current.publicRoomId !== proposal.publicRoomId
      || current.hostUid !== proposal.hostUid
      || current.requestId !== proposal.requestId
      || Number(current.expiresAt || 0) <= now) return null;
  return activeEngagementValue("visitor", {
    ...proposal,
    now,
  });
}

function nextFinalHostAdmissionClaim(currentValue, proposal, now) {
  const current = objectValue(currentValue);
  if (current.state === "active"
      && current.role === "host"
      && current.sessionId === proposal.sessionId) return { ...current };
  if (current.state !== "host_admitting"
      || current.roomId !== proposal.roomId
      || current.publicRoomId !== proposal.publicRoomId
      || current.requestId !== proposal.requestId
      || current.sessionId !== proposal.sessionId
      || Number(current.expiresAt || 0) <= now) return null;
  return activeEngagementValue("host", {
    ...proposal,
    now,
  });
}

function restoredHostOpenClaim(currentValue, proposal) {
  const current = objectValue(currentValue);
  if (current.state !== "host_admitting"
      || current.roomId !== proposal.roomId
      || current.requestId !== proposal.requestId
      || current.sessionId !== proposal.sessionId) return currentValue;
  return {
    state: "host_open",
    roomId: proposal.roomId,
    publicRoomId: proposal.publicRoomId,
    ...(Number.isSafeInteger(Number(current.previousGeneration))
      && Number(current.previousGeneration) > 0
      ? { generation: Number(current.previousGeneration) }
      : {}),
    heartbeatAt: Number(current.previousHeartbeatAt || 0),
    expiresAt: Number(current.previousExpiresAt || 0),
  };
}

function restoredVisitorPendingClaim(currentValue, proposal) {
  const current = objectValue(currentValue);
  if (current.state !== "active"
      || current.role !== "visitor"
      || current.roomId !== proposal.roomId
      || current.sessionId !== proposal.sessionId) return currentValue;
  return {
    state: "visitor_pending",
    requestId: proposal.requestId,
    roomId: proposal.roomId,
    publicRoomId: proposal.publicRoomId,
    hostUid: proposal.hostUid,
    requestedAt: Number(proposal.requestedAt || 0),
    expiresAt: Number(proposal.requestExpiresAt || 0),
  };
}

function restoredAcceptedHostOpenClaim(currentValue, proposal) {
  const current = objectValue(currentValue);
  if (current.state !== "active"
      || current.role !== "host"
      || current.roomId !== proposal.roomId
      || current.sessionId !== proposal.sessionId) return currentValue;
  return {
    state: "host_open",
    roomId: proposal.roomId,
    publicRoomId: proposal.publicRoomId,
    ...(Number.isSafeInteger(Number(proposal.generation))
      && Number(proposal.generation) > 0
      ? { generation: Number(proposal.generation) }
      : {}),
    heartbeatAt: Number(proposal.hostHeartbeatAt || 0),
    expiresAt: Number(proposal.hostExpiresAt || 0),
  };
}

function acceptedSessionValue(roomValue, requestValue, sessionId, now) {
  const room = objectValue(roomValue);
  const request = objectValue(requestValue);
  const hardExpiresAt = now + FREE_TABLE_SESSION_TTL_MS;
  const expiresAt = now + FREE_TABLE_CONNECTING_TTL_MS;
  return {
    protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
    sessionId,
    roomId: room.roomId,
    ...(Number.isSafeInteger(Number(room.generation))
      && Number(room.generation) > 0
      ? { generation: Number(room.generation) }
      : {}),
    publicRoomId: room.publicRoomId,
    hostUid: room.hostUid,
    visitorUid: request.visitorUid,
    participants: {
      [room.hostUid]: true,
      [request.visitorUid]: true,
    },
    publicMembers: {
      [room.hostUid]: room.publicMemberId,
      [request.visitorUid]: request.publicMemberId,
    },
    cards: {
      [room.hostUid]: normalizeCard(room.hostCard),
      [request.visitorUid]: normalizeCard(request.visitorCard),
    },
    space: normalizeRoomSettings(room.space),
    status: "connecting",
    admissionAccepted: true,
    p2pConnected: false,
    arrivals: {
      host: false,
      visitor: false,
    },
    createdAt: now,
    startedAt: 0,
    endedAt: 0,
    hardExpiresAt,
    expiresAt,
  };
}

function nextAdmissionState(currentValue, {
  hostUid,
  requestId,
  accept,
  sessionId,
  now,
}) {
  const current = objectValue(currentValue);
  if (accept
      && current.state === "active"
      && current.acceptedRequestId === requestId
      && current.session?.sessionId) return { ...current };
  if (current.state !== "open"
      || current.hostUid !== hostUid
      || Number(current.expiresAt || 0) <= now) return null;
  const request = objectValue(current.requests)[requestId];
  if (!request || Number(request.expiresAt || 0) <= now) return null;
  if (!accept) {
    const requests = { ...objectValue(current.requests) };
    delete requests[requestId];
    return { ...current, requests };
  }
  return {
    ...current,
    state: "active",
    acceptedRequestId: requestId,
    session: acceptedSessionValue(current, request, sessionId, now),
  };
}

function nextExpiredRoomCleanupClaim(currentValue, {
  roomId,
  publicRoomId,
  hostUid,
  cleanupToken,
  now,
}) {
  const current = objectValue(currentValue);
  if (current.roomId !== roomId
      || current.publicRoomId !== publicRoomId
      || current.hostUid !== hostUid
      || Number(current.expiresAt || 0) > now) return null;
  if (current.state === "expiring"
      && Number(current.cleanupExpiresAt || 0) > now) return null;
  if (current.state === "active") {
    const incompleteSession = objectValue(current.session);
    if (!CHILD_ID_PATTERN.test(String(incompleteSession.sessionId || ""))
        || incompleteSession.roomId !== roomId
        || Number(incompleteSession.expiresAt || 0) > now) return null;
  } else if (!["open", "closing", "expiring"].includes(current.state)) {
    return null;
  }
  return {
    ...current,
    state: "expiring",
    cleanupFromState: current.state === "expiring"
      ? String(current.cleanupFromState || "open")
      : current.state,
    cleanupToken,
    cleanupAt: now,
    cleanupExpiresAt: now + FREE_TABLE_CONNECTING_TTL_MS,
  };
}

function nextArrivalState(currentValue, uid, now) {
  const current = objectValue(currentValue);
  if (!current.sessionId
      || current.participants?.[uid] !== true
      || !["connecting", "active"].includes(current.status)
      || Number(current.expiresAt || 0) <= now
      || Number(current.hardExpiresAt || current.expiresAt || 0) <= now) return null;
  const role = current.hostUid === uid
    ? "host"
    : current.visitorUid === uid
      ? "visitor"
      : "";
  if (!role) return null;
  const arrivals = {
    host: current.arrivals?.host === true,
    visitor: current.arrivals?.visitor === true,
    [role]: true,
  };
  const bothArrived = arrivals.host && arrivals.visitor;
  return {
    ...current,
    arrivals,
    heartbeats: {
      ...objectValue(current.heartbeats),
      [uid]: now,
    },
    p2pConnected: bothArrived,
    status: bothArrived ? "active" : "connecting",
    expiresAt: bothArrived
      ? Number(current.hardExpiresAt || current.expiresAt)
      : Number(current.expiresAt || 0),
    startedAt: bothArrived
      ? Math.max(1, Number(current.startedAt || now))
      : Math.max(0, Number(current.startedAt || 0)),
  };
}

function pairGrowthDecision(pairValue, previousGrowthValue, sessionId, now) {
  const pair = objectValue(pairValue);
  const previousGrowth = normalizeGrowth(previousGrowthValue);
  const previousVisitAt = Math.max(
    0,
    Number(pair.lastEndedAt || pair.lastVisitAt || 0),
  );
  const previousGrowthAt = Math.max(0, Number(pair.lastGrowthAt || 0));
  const integrated = previousVisitAt > 0
    && now - previousVisitAt <= FREE_TABLE_RECONNECT_MERGE_MS;
  const visitId = integrated && typeof pair.lastVisitId === "string"
    ? pair.lastVisitId
    : sessionId;
  const grew = !integrated
    && (previousGrowthAt === 0
      || now - previousGrowthAt >= FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS);
  const growth = {
    visitCount: previousGrowth.visitCount + (integrated ? 0 : 1),
    growthCount: previousGrowth.growthCount + (grew ? 1 : 0),
  };
  growth.stage = growthStage(growth.growthCount);
  return { visitId, integrated, grew, growth };
}

function selectReportEvidence(messageEntries, selectedIds, sessionValue, now) {
  const session = objectValue(sessionValue);
  const selected = new Set(
    (Array.isArray(selectedIds) ? selectedIds : [])
      .filter((id) => CHILD_ID_PATTERN.test(String(id || "")))
      .slice(0, FREE_TABLE_REPORT_MESSAGE_LIMIT),
  );
  const evidence = [];
  for (const entry of Array.isArray(messageEntries) ? messageEntries : []) {
    const messageId = String(entry?.messageId || "");
    const message = objectValue(entry?.message);
    if (!selected.has(messageId)) continue;
    const createdAt = Number(message.createdAt || 0);
    if (message.type !== "text"
        || session.participants?.[message.authorUid] !== true
        || !["host", "visitor"].includes(message.authorRole)
        || message.authorRole !== (
          message.authorUid === session.hostUid ? "host" : "visitor"
        )
        || typeof message.text !== "string"
        || !message.text
        || message.text.length > 500
        || createdAt < now - (30 * 60 * 1000)
        || createdAt > now + 15_000) continue;
    evidence.push({
      messageId,
      authorUid: message.authorUid,
      authorRole: message.authorRole,
      text: message.text,
      createdAt,
    });
    if (evidence.length >= FREE_TABLE_REPORT_MESSAGE_LIMIT) break;
  }
  return evidence;
}

function createFreeTableService(deps) {
  if (!deps || typeof deps !== "object") {
    throw new TypeError("free table service dependencies are required");
  }
  for (const key of ["firestore", "realtime", "HttpsError", "Timestamp"]) {
    if (!deps[key]) throw new TypeError(`missing free table dependency: ${key}`);
  }
  const {
    firestore,
    realtime,
    HttpsError,
    Timestamp,
  } = deps;
  const currentTime = typeof deps.now === "function" ? deps.now : Date.now;
  const randomBytes = typeof deps.randomBytes === "function" ? deps.randomBytes : crypto.randomBytes;

  if (typeof firestore.collection !== "function"
      || typeof firestore.runTransaction !== "function"
      || typeof firestore.getAll !== "function"
      || typeof realtime.ref !== "function") {
    throw new TypeError("free table storage dependencies are invalid");
  }

  const profileRef = (uid) => firestore.collection("freeTableProfiles").doc(uid);
  const publicMemberRef = (publicMemberId) => firestore
    .collection("freeTablePublicMembers")
    .doc(publicMemberId);
  const spaceRef = (uid) => firestore.collection("freeTableSpaces").doc(uid);
  const publicSpaceRef = (publicRoomId) => firestore
    .collection("freeTablePublicSpaces")
    .doc(publicRoomId);
  const pairActivityRef = (pairId) => firestore
    .collection("freeTablePairActivity")
    .doc(pairId);
  const visitLedgerRef = (sessionId) => firestore
    .collection("freeTableVisitLedger")
    .doc(sessionId);
  const bookmarkCollection = (uid) => firestore
    .collection("freeTableBookmarks")
    .doc(uid)
    .collection("rooms");
  const bookmarkRef = (uid, publicRoomId) => bookmarkCollection(uid).doc(publicRoomId);
  const blockCollection = (uid) => firestore
    .collection("freeTableBlocks")
    .doc(uid)
    .collection("users");
  const blockRef = (uid, publicMemberId) => blockCollection(uid).doc(publicMemberId);
  const blockPairRef = (firstUid, secondUid) => firestore
    .collection("freeTableBlockPairs")
    .doc(internalPairId(firstUid, secondUid));
  const relationshipRef = (pairId) => firestore
    .collection("freeTableRelationships")
    .doc(pairId);
  const reportRef = (reportId) => firestore
    .collection("freeTableReports")
    .doc(reportId);
  const freeTablesRoot = () => realtime.ref("freeTables");
  const publicRoomsRef = () => realtime.ref("freeTables/publicRooms");
  const publicRoomRef = (publicRoomId) => realtime
    .ref(`freeTables/publicRooms/${publicRoomId}`);
  const roomStateRef = (roomId) => realtime.ref(`freeTables/roomStates/${roomId}`);
  const roomOwnerRef = (roomId) => realtime.ref(`freeTables/roomOwners/${roomId}`);
  const openGenerationRef = (uid) => realtime
    .ref(`freeTables/openGenerations/${uid}`);
  const engagementsRef = () => realtime.ref("freeTables/engagements");
  const engagementRef = (uid) => realtime.ref(`freeTables/engagements/${uid}`);
  const hostActiveRef = (uid) => realtime.ref(`freeTables/hostActive/${uid}`);
  const visitorPendingRef = (uid) => realtime.ref(`freeTables/visitorPending/${uid}`);
  const requestsRef = (roomId) => realtime.ref(`freeTables/requests/${roomId}`);
  const requestRef = (roomId, requestId) => realtime
    .ref(`freeTables/requests/${roomId}/${requestId}`);
  const activeRef = (uid) => realtime.ref(`freeTables/active/${uid}`);
  const sessionsRef = () => realtime.ref("freeTables/sessions");
  const sessionRef = (sessionId) => realtime.ref(`freeTables/sessions/${sessionId}`);
  const presenceRef = (sessionId) => realtime.ref(`freeTables/presence/${sessionId}`);
  const signalsRef = (sessionId) => realtime.ref(`freeTables/signals/${sessionId}`);
  const chatRef = (sessionId) => realtime.ref(`freeTables/chat/${sessionId}`);

  function httpsError(code, message) {
    return new HttpsError(code, message);
  }

  function committedTransactionValue(result, predicate) {
    if (!result?.committed || !result.snapshot?.exists()) return null;
    const value = result.snapshot.val();
    return predicate(value) ? value : null;
  }

  function transactionRemoved(result) {
    return result?.committed === true && result.snapshot?.exists() === false;
  }

  async function removeRealtimeIfMatches(reference, predicate) {
    let matchedFinalValue = false;
    const result = await reference.transaction((current) => {
      matchedFinalValue = Boolean(current && predicate(current));
      return matchedFinalValue ? null : current;
    });
    return matchedFinalValue && transactionRemoved(result);
  }

  async function issueOpenGeneration(uid) {
    let issuedGeneration = 0;
    let generationAdvanced = false;
    const result = await openGenerationRef(uid).transaction(
      (currentValue) => {
        const currentGeneration = Number(currentValue || 0);
        generationAdvanced = Number.isSafeInteger(currentGeneration)
          && currentGeneration >= 0
          && currentGeneration < Number.MAX_SAFE_INTEGER;
        if (!generationAdvanced) {
          issuedGeneration = 0;
          return currentValue;
        }
        issuedGeneration = currentGeneration + 1;
        return issuedGeneration;
      },
      undefined,
      false,
    );
    if (!generationAdvanced
        || !result?.committed
        || result.snapshot?.val() !== issuedGeneration) {
      throw httpsError(
        "resource-exhausted",
        "開室世代を更新できませんでした。しばらくしてからもう一度お試しください。",
      );
    }
    return issuedGeneration;
  }

  function requireUid(uid) {
    if (typeof uid !== "string"
        || !uid
        || uid.length > 128
        || UID_CONTROL_PATTERN.test(uid)) {
      throw httpsError("unauthenticated", "匿名ログインが必要です。");
    }
    return uid;
  }

  function requirePublicId(value, label = "部屋") {
    const id = typeof value === "string" ? value.trim() : "";
    if (!PUBLIC_ID_PATTERN.test(id)) {
      throw httpsError("invalid-argument", `${label}を確認してください。`);
    }
    return id;
  }

  function requireChildId(value, label) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!CHILD_ID_PATTERN.test(id)) {
      throw httpsError("invalid-argument", `${label}を確認してください。`);
    }
    return id;
  }

  function requireBoolean(value, label) {
    if (typeof value !== "boolean") {
      throw httpsError("invalid-argument", `${label}を確認してください。`);
    }
    return value;
  }

  async function ensureIdentity(uid) {
    const existing = await profileRef(uid).get();
    const existingData = existing.exists ? existing.data() : null;
    if (PUBLIC_ID_PATTERN.test(String(existingData?.publicMemberId || ""))
        && PUBLIC_ID_PATTERN.test(String(existingData?.publicRoomId || ""))) {
      return {
        publicMemberId: existingData.publicMemberId,
        publicRoomId: existingData.publicRoomId,
      };
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const publicMemberId = randomPublicId(randomBytes);
      const publicRoomId = randomPublicId(randomBytes);
      try {
        const identity = await firestore.runTransaction(async (transaction) => {
          const [profileSnapshot, memberSnapshot, spaceSnapshot] = await Promise.all([
            transaction.get(profileRef(uid)),
            transaction.get(publicMemberRef(publicMemberId)),
            transaction.get(publicSpaceRef(publicRoomId)),
          ]);
          const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
          if (PUBLIC_ID_PATTERN.test(String(profile?.publicMemberId || ""))
              && PUBLIC_ID_PATTERN.test(String(profile?.publicRoomId || ""))) {
            return {
              publicMemberId: profile.publicMemberId,
              publicRoomId: profile.publicRoomId,
            };
          }
          if (memberSnapshot.exists || spaceSnapshot.exists) {
            throw new FreeTableCollisionError("free table public id collision");
          }
          const now = currentTime();
          transaction.set(profileRef(uid), {
            uid,
            publicMemberId,
            publicRoomId,
            createdAt: now,
            updatedAt: now,
          });
          transaction.set(publicMemberRef(publicMemberId), {
            uid,
            publicRoomId,
            createdAt: now,
          });
          transaction.set(publicSpaceRef(publicRoomId), {
            hostUid: uid,
            publicMemberId,
            createdAt: now,
          });
          return { publicMemberId, publicRoomId };
        });
        return identity;
      } catch (error) {
        if (!(error instanceof FreeTableCollisionError)) throw error;
      }
    }
    throw httpsError("resource-exhausted", "公開用IDを準備できませんでした。");
  }

  async function identityForPublicMember(publicMemberId) {
    const snapshot = await publicMemberRef(publicMemberId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (typeof data?.uid !== "string"
        || !data.uid
        || !PUBLIC_ID_PATTERN.test(String(data.publicRoomId || ""))) return null;
    return {
      uid: data.uid,
      publicMemberId,
      publicRoomId: data.publicRoomId,
    };
  }

  async function identityForPublicSpace(publicRoomId) {
    const snapshot = await publicSpaceRef(publicRoomId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (typeof data?.hostUid !== "string"
        || !data.hostUid
        || !PUBLIC_ID_PATTERN.test(String(data.publicMemberId || ""))) return null;
    return {
      uid: data.hostUid,
      publicMemberId: data.publicMemberId,
      publicRoomId,
    };
  }

  async function pairIsBlocked(firstUid, firstPublicMemberId, secondUid, secondPublicMemberId) {
    const snapshot = await blockPairRef(firstUid, secondUid).get();
    if (!snapshot.exists) return false;
    const value = snapshot.data();
    const participants = [firstUid, secondUid].sort();
    const storedParticipants = Array.isArray(value?.participants)
      ? [...value.participants].sort()
      : [];
    if (JSON.stringify(storedParticipants) !== JSON.stringify(participants)
        || value?.publicMembers?.[firstUid] !== firstPublicMemberId
        || value?.publicMembers?.[secondUid] !== secondPublicMemberId) return true;
    return value?.blockedBy?.[firstUid] === true
      || value?.blockedBy?.[secondUid] === true;
  }

  function blockPairSnapshotIsSafe(snapshot, uid, peerUid) {
    if (!snapshot.exists) return true;
    const value = snapshot.data();
    const participants = [uid, peerUid].sort();
    if (!Array.isArray(value?.participants)
        || JSON.stringify([...value.participants].sort()) !== JSON.stringify(participants)) {
      return false;
    }
    return value?.blockedBy?.[uid] !== true && value?.blockedBy?.[peerUid] !== true;
  }

  async function filterUnblockedCandidates(uid, candidates, limit) {
    const output = [];
    const chunkSize = FREE_TABLE_LIST_LIMIT;
    for (let offset = 0; offset < candidates.length && output.length < limit; offset += chunkSize) {
      const chunk = candidates.slice(offset, offset + chunkSize);
      const snapshots = await firestore.getAll(
        ...chunk.map((candidate) => blockPairRef(uid, candidate.hostUid)),
      );
      for (let index = 0; index < chunk.length && output.length < limit; index += 1) {
        if (blockPairSnapshotIsSafe(snapshots[index], uid, chunk[index].hostUid)) {
          output.push(chunk[index]);
        }
      }
    }
    return output;
  }

  function appendPublicRoomSnapshot(target, snapshot) {
    snapshot.forEach((child) => {
      if (target.size >= FREE_TABLE_LIST_SCAN_LIMIT) return true;
      if (!target.has(child.key)) target.set(child.key, child.val());
      return false;
    });
  }

  async function readBoundedPublicRoomWindow(uid, now) {
    const cursor = fairShelfCursor(uid, now);
    const rooms = new Map();
    const firstSnapshot = await publicRoomsRef()
      .orderByKey()
      .startAt(cursor)
      .limitToFirst(FREE_TABLE_LIST_SCAN_LIMIT)
      .get();
    appendPublicRoomSnapshot(rooms, firstSnapshot);
    if (rooms.size < FREE_TABLE_LIST_SCAN_LIMIT) {
      const wrapSnapshot = await publicRoomsRef()
        .orderByKey()
        .limitToFirst(FREE_TABLE_LIST_SCAN_LIMIT - rooms.size)
        .get();
      appendPublicRoomSnapshot(rooms, wrapSnapshot);
    }
    return [...rooms.entries()];
  }

  async function saveSpace(uid, data) {
    const payload = exactPayload(data, ["space", "hostCard"]);
    if (!payload
        || !validateRoomSettings(payload.space)
        || !validateCard(payload.hostCard)) {
      throw httpsError("invalid-argument", "部屋札の内容を確認してください。");
    }
    const activeSnapshot = await hostActiveRef(uid).get();
    const active = activeSnapshot.val();
    const now = currentTime();
    if (active
        && Number(active.expiresAt || 0) > now
        && ["open", "active"].includes(active.state)) {
      throw httpsError(
        "failed-precondition",
        "部屋を閉じてから、しつらえを変更してください。",
      );
    }
    const identity = await ensureIdentity(uid);
    const normalizedSpace = normalizeRoomSettings(payload.space);
    const normalizedHostCard = normalizeCard(payload.hostCard);
    const reference = spaceRef(uid);
    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const previous = snapshot.exists ? snapshot.data() : {};
      const growth = normalizeGrowth(previous.growth);
      const value = {
        uid,
        ...identity,
        protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
        space: normalizedSpace,
        hostCard: normalizedHostCard,
        growth,
        createdAt: Math.max(0, Number(previous.createdAt || now)),
        updatedAt: now,
      };
      transaction.set(reference, value);
      return value;
    });
    return { ok: true, space: publicSpaceState(result) };
  }

  function openRoomPublicValue(
    savedSpace,
    roomId,
    generation,
    openedAt,
    heartbeatAt,
    expiresAt,
  ) {
    return {
      protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
      roomId,
      generation,
      publicRoomId: savedSpace.publicRoomId,
      publicMemberId: savedSpace.publicMemberId,
      hostUid: savedSpace.uid,
      state: "open",
      space: normalizeRoomSettings(savedSpace.space),
      hostCard: normalizeCard(savedSpace.hostCard),
      openedAt,
      heartbeatAt,
      expiresAt,
    };
  }

  async function clearPendingIfMatches(visitorUid, requestId) {
    await removeRealtimeIfMatches(
      visitorPendingRef(visitorUid),
      (current) => current.requestId === requestId,
    );
  }

  async function clearEngagementIfMatches(uid, field, value) {
    await removeRealtimeIfMatches(
      engagementRef(uid),
      (current) => current[field] === value,
    );
  }

  async function closeOpenRoom(uid) {
    const snapshot = await hostActiveRef(uid).get();
    const active = snapshot.val();
    if (!active) return { ok: true, closed: true };
    const now = currentTime();
    if (active.state === "active"
        && Number(active.expiresAt || 0) > now) {
      throw httpsError(
        "failed-precondition",
        "入室中の卓は、お開きにしてから閉じてください。",
      );
    }
    const roomId = String(active.roomId || "");
    const publicRoomId = String(active.publicRoomId || "");
    if (!CHILD_ID_PATTERN.test(roomId) || !PUBLIC_ID_PATTERN.test(publicRoomId)) {
      throw httpsError("failed-precondition", "開いている部屋を確認できませんでした。");
    }
    const proposedCloseToken = randomPublicId(randomBytes);
    const roomResult = await roomStateRef(roomId).transaction((current) => {
      if (current?.state === "closing"
          && current.hostUid === uid
          && current.publicRoomId === publicRoomId
          && CHILD_ID_PATTERN.test(String(current.closeToken || ""))) return current;
      if (current?.state !== "open"
          || current.hostUid !== uid
          || current.publicRoomId !== publicRoomId) return current;
      return {
        ...current,
        state: "closing",
        closeToken: proposedCloseToken,
        closingAt: now,
      };
    });
    let room = committedTransactionValue(
      roomResult,
      (value) => (
        value?.state === "closing"
        && value.hostUid === uid
        && value.roomId === roomId
        && value.publicRoomId === publicRoomId
        && CHILD_ID_PATTERN.test(String(value.closeToken || ""))
      ),
    );
    if (!room && transactionRemoved(roomResult)) {
      room = {
        roomId,
        publicRoomId,
        hostUid: uid,
        state: "closing",
        closeToken: active.state === "closing"
          && CHILD_ID_PATTERN.test(String(active.closeToken || ""))
          ? active.closeToken
          : proposedCloseToken,
        requests: {},
      };
    }
    if (!room) {
      throw httpsError(
        "failed-precondition",
        "入室状態が変わりました。現在の自由卓を確認してください。",
      );
    }
    const closeToken = room.closeToken;
    const restoreRoom = () => roomStateRef(roomId).transaction((current) => {
      if (current?.state !== "closing"
          || current.closeToken !== closeToken
          || current.hostUid !== uid) return current;
      const restored = { ...current, state: "open" };
      delete restored.closeToken;
      delete restored.closingAt;
      return restored;
    });
    const hostResult = await hostActiveRef(uid).transaction((current) => {
      if (current?.state === "closing"
          && current.roomId === roomId
          && current.closeToken === closeToken) return current;
      if ((!current || Number(current.expiresAt || 0) <= now)
          || (current.state === "open"
            && current.roomId === roomId
            && current.publicRoomId === publicRoomId)) {
        return {
          ...(current || {}),
          roomId,
          publicRoomId,
          state: "closing",
          closeToken,
          heartbeatAt: now,
          expiresAt: now + FREE_TABLE_CONNECTING_TTL_MS,
        };
      }
      return current;
    });
    const closingHost = committedTransactionValue(
      hostResult,
      (value) => (
        value?.state === "closing"
        && value.roomId === roomId
        && value.publicRoomId === publicRoomId
        && value.closeToken === closeToken
      ),
    );
    if (!closingHost) {
      await restoreRoom();
      throw httpsError(
        "failed-precondition",
        "入室状態が変わりました。現在の自由卓を確認してください。",
      );
    }
    const engagementResult = await engagementRef(uid).transaction((current) => {
      if (current?.state === "host_closing"
          && current.roomId === roomId
          && current.closeToken === closeToken) return current;
      if ((!current || Number(current.expiresAt || 0) <= now)
          || (current.state === "host_open"
            && current.roomId === roomId
            && current.publicRoomId === publicRoomId)) {
        return {
          ...(current || {}),
          state: "host_closing",
          roomId,
          publicRoomId,
          closeToken,
          heartbeatAt: now,
          expiresAt: now + FREE_TABLE_CONNECTING_TTL_MS,
        };
      }
      return current;
    });
    const closingEngagement = committedTransactionValue(
      engagementResult,
      (value) => (
        value?.state === "host_closing"
        && value.roomId === roomId
        && value.publicRoomId === publicRoomId
        && value.closeToken === closeToken
      ),
    );
    if (!closingEngagement) {
      await Promise.all([
        restoreRoom(),
        hostActiveRef(uid).transaction((current) => {
          if (current?.state !== "closing"
              || current.closeToken !== closeToken) return current;
          const restored = { ...current, state: "open" };
          delete restored.closeToken;
          return restored;
        }),
      ]);
      throw httpsError(
        "failed-precondition",
        "入室状態が変わりました。現在の自由卓を確認してください。",
      );
    }
    const publicResult = await publicRoomRef(publicRoomId).transaction((current) => (
      !current
        || (current.roomId === roomId && current.hostUid === uid)
        ? null
        : current
    ));
    if (!transactionRemoved(publicResult)) {
      throw httpsError("aborted", "部屋の世代が変わりました。もう一度お試しください。");
    }
    const requests = Object.values(objectValue(room.requests));
    await freeTablesRoot().update({
      [`roomStates/${roomId}`]: null,
      [`roomOwners/${roomId}`]: null,
      [`requests/${roomId}`]: null,
    });
    await Promise.all([
      removeRealtimeIfMatches(
        hostActiveRef(uid),
        (current) => (
          current.state === "closing"
          && current.roomId === roomId
          && current.closeToken === closeToken
        ),
      ),
      removeRealtimeIfMatches(
        engagementRef(uid),
        (current) => (
          current.state === "host_closing"
          && current.roomId === roomId
          && current.closeToken === closeToken
        ),
      ),
    ]);
    await Promise.all(requests
      .filter((request) => request?.visitorUid && request?.requestId)
      .map((request) => Promise.all([
        clearPendingIfMatches(request.visitorUid, request.requestId),
        clearEngagementIfMatches(request.visitorUid, "requestId", request.requestId),
      ])));
    return { ok: true, closed: true };
  }

  async function openSpace(uid, data) {
    const payload = exactPayload(data, [], ["active"]);
    if (!payload) throw httpsError("invalid-argument", "開室操作を確認してください。");
    if (payload.active === false) return closeOpenRoom(uid);
    if (payload.active !== undefined && payload.active !== true) {
      throw httpsError("invalid-argument", "開室操作を確認してください。");
    }
    const savedSnapshot = await spaceRef(uid).get();
    if (!savedSnapshot.exists) {
      throw httpsError("failed-precondition", "先に部屋札を用意してください。");
    }
    const savedSpace = savedSnapshot.data();
    if (!validateRoomSettings(savedSpace?.space)
        || !validateCard(savedSpace?.hostCard)
        || !PUBLIC_ID_PATTERN.test(String(savedSpace?.publicRoomId || ""))
        || !PUBLIC_ID_PATTERN.test(String(savedSpace?.publicMemberId || ""))) {
      throw httpsError("failed-precondition", "部屋札を保存し直してください。");
    }
    const now = currentTime();
    const expiresAt = now + FREE_TABLE_PUBLIC_ROOM_TTL_MS;
    const generation = await issueOpenGeneration(uid);
    const proposedRoomId = randomPublicId(randomBytes);
    const engagementResult = await engagementRef(uid).transaction((current) => {
      const next = nextEngagementClaim(current, {
        state: "host_open",
        roomId: proposedRoomId,
        publicRoomId: savedSpace.publicRoomId,
        generation,
        heartbeatAt: now,
        expiresAt,
      }, now);
      return next ?? current;
    });
    const engagement = committedTransactionValue(
      engagementResult,
      (value) => (
        value?.state === "host_open"
        && value.publicRoomId === savedSpace.publicRoomId
        && CHILD_ID_PATTERN.test(String(value.roomId || ""))
        && value.generation === generation
        && Number(value.expiresAt || 0) > now
      ),
    );
    if (!engagement) {
      throw httpsError(
        "failed-precondition",
        "来訪札を取り下げるか、現在の自由卓を終えてから部屋を開いてください。",
      );
    }
    const result = await hostActiveRef(uid).transaction((current) => {
      const next = nextHostOpenClaim(current, {
        roomId: engagement.roomId,
        publicRoomId: savedSpace.publicRoomId,
        state: "open",
        generation,
        heartbeatAt: now,
        expiresAt,
      }, now);
      return next ?? current;
    });
    const hostState = committedTransactionValue(
      result,
      (value) => (
        value?.state === "open"
        && value.roomId === engagement.roomId
        && value.publicRoomId === savedSpace.publicRoomId
        && value.generation === generation
        && Number(value.expiresAt || 0) > now
      ),
    );
    if (!hostState) {
      await removeRealtimeIfMatches(
        engagementRef(uid),
        (current) => (
          current.state === "host_open"
          && current.roomId === engagement.roomId
          && current.generation === generation
        ),
      );
      throw httpsError("failed-precondition", "すでに別の自由卓へ入室しています。");
    }
    const roomId = hostState.roomId;
    const rollbackOpenGeneration = () => Promise.all([
      publicRoomRef(savedSpace.publicRoomId).transaction(
        (current) => (
          current?.roomId === roomId
          && current?.hostUid === uid
          && current?.generation === generation
          ? null
          : current
        ),
        undefined,
        false,
      ),
      roomStateRef(roomId).transaction(
        (current) => (
          current?.state === "open"
          && current?.hostUid === uid
          && current?.publicRoomId === savedSpace.publicRoomId
          && current?.generation === generation
          ? null
          : current
        ),
        undefined,
        false,
      ),
      roomOwnerRef(roomId).transaction(
        (current) => (
          current?.uid === uid
          && current?.publicRoomId === savedSpace.publicRoomId
          && current?.generation === generation
          ? null
          : current
        ),
        undefined,
        false,
      ),
    ]);
    const roomResult = await roomStateRef(roomId).transaction((current) => {
      if (current
          && (current.hostUid !== uid
            || current.publicRoomId !== savedSpace.publicRoomId
            || current.state !== "open")) return current;
      const currentGeneration = Number(current?.generation || 0);
      if (Number.isSafeInteger(currentGeneration)
          && currentGeneration > generation) return current;
      const publicValue = openRoomPublicValue(
        savedSpace,
        roomId,
        generation,
        current?.openedAt || now,
        now,
        expiresAt,
      );
      return {
        ...(current || {}),
        protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
        roomId,
        generation,
        publicRoomId: savedSpace.publicRoomId,
        hostUid: uid,
        publicMemberId: savedSpace.publicMemberId,
        state: "open",
        space: publicValue.space,
        hostCard: publicValue.hostCard,
        requests: objectValue(current?.requests),
        openedAt: current?.openedAt || now,
        heartbeatAt: now,
        expiresAt,
      };
    });
    const internalValue = committedTransactionValue(
      roomResult,
      (value) => (
        value?.hostUid === uid
        && value.roomId === roomId
        && value.publicRoomId === savedSpace.publicRoomId
        && value.state === "open"
        && value.generation === generation
        && value.heartbeatAt === now
        && value.expiresAt === expiresAt
      ),
    );
    if (!internalValue) {
      await rollbackOpenGeneration();
      throw httpsError("aborted", "開室状態が変わりました。もう一度お試しください。");
    }
    const publicValue = openRoomPublicValue(
      savedSpace,
      roomId,
      generation,
      internalValue.openedAt,
      now,
      expiresAt,
    );
    const ownerValue = {
      roomId,
      uid,
      publicRoomId: savedSpace.publicRoomId,
      generation,
      heartbeatAt: now,
      expiresAt,
    };
    const [publicResult, ownerResult] = await Promise.all([
      publicRoomRef(savedSpace.publicRoomId).transaction(
        (current) => {
          if (!current) return publicValue;
          const currentGeneration = Number(current.generation || 0);
          if (Number.isSafeInteger(currentGeneration)
              && currentGeneration > generation) return current;
          if (currentGeneration === generation
              && (current.roomId !== roomId || current.hostUid !== uid)) return current;
          return publicValue;
        },
        undefined,
        false,
      ),
      roomOwnerRef(roomId).transaction(
        (current) => {
          if (!current) return ownerValue;
          const currentGeneration = Number(current.generation || 0);
          if (Number.isSafeInteger(currentGeneration)
              && currentGeneration > generation) return current;
          if (currentGeneration === generation
              && (current.uid !== uid
                || current.publicRoomId !== savedSpace.publicRoomId)) return current;
          return ownerValue;
        },
        undefined,
        false,
      ),
    ]);
    const materializedPublic = committedTransactionValue(
      publicResult,
      (value) => (
        value?.roomId === roomId
        && value.hostUid === uid
        && value.publicRoomId === savedSpace.publicRoomId
        && value.generation === generation
        && value.heartbeatAt === now
        && value.expiresAt === expiresAt
      ),
    );
    const materializedOwner = committedTransactionValue(
      ownerResult,
      (value) => (
        value?.roomId === roomId
        && value.uid === uid
        && value.publicRoomId === savedSpace.publicRoomId
        && value.generation === generation
        && value.heartbeatAt === now
        && value.expiresAt === expiresAt
      ),
    );
    if (!materializedPublic || !materializedOwner) {
      await rollbackOpenGeneration();
      throw httpsError("aborted", "開室状態が変わりました。もう一度お試しください。");
    }
    const [
      latestEngagement,
      latestHost,
      latestRoom,
      latestPublic,
      latestOwner,
    ] = await Promise.all([
      engagementRef(uid).get(),
      hostActiveRef(uid).get(),
      roomStateRef(roomId).get(),
      publicRoomRef(savedSpace.publicRoomId).get(),
      roomOwnerRef(roomId).get(),
    ]);
    if (latestEngagement.val()?.state !== "host_open"
        || latestEngagement.val()?.roomId !== roomId
        || latestEngagement.val()?.generation !== generation
        || latestHost.val()?.state !== "open"
        || latestHost.val()?.roomId !== roomId
        || latestHost.val()?.generation !== generation
        || latestRoom.val()?.state !== "open"
        || latestRoom.val()?.hostUid !== uid
        || latestRoom.val()?.generation !== generation
        || latestRoom.val()?.heartbeatAt !== now
        || latestPublic.val()?.roomId !== roomId
        || latestPublic.val()?.generation !== generation
        || latestOwner.val()?.roomId !== roomId
        || latestOwner.val()?.generation !== generation) {
      await rollbackOpenGeneration();
      throw httpsError("aborted", "開室状態が変わりました。もう一度お試しください。");
    }
    return {
      ok: true,
      opened: true,
      room: publicRoomProjection(publicValue, now),
    };
  }

  async function listSpaces(uid, data) {
    if (!exactPayload(data, [])) {
      throw httpsError("invalid-argument", "部屋一覧の操作を確認してください。");
    }
    const now = currentTime();
    const [identity, storedRooms] = await Promise.all([
      ensureIdentity(uid),
      readBoundedPublicRoomWindow(uid, now),
    ]);
    const candidates = storedRooms
      .map(([publicRoomId, stored]) => ({
        hostUid: typeof stored?.hostUid === "string" ? stored.hostUid : "",
        room: stored?.publicRoomId === publicRoomId
          ? publicRoomProjection(stored, now)
          : null,
      }))
      .filter((candidate) => candidate.room && candidate.hostUid)
      .filter((candidate) => candidate.hostUid !== uid)
      .filter((candidate) => (
        candidate.room.publicMemberId !== identity.publicMemberId
      ))
      .sort((first, second) => (
        fairShelfKey(uid, first.room.publicRoomId, now)
          .localeCompare(fairShelfKey(uid, second.room.publicRoomId, now))
      ))
      .slice(0, FREE_TABLE_LIST_SCAN_LIMIT);
    const filtered = await filterUnblockedCandidates(
      uid,
      candidates,
      FREE_TABLE_LIST_LIMIT,
    );
    return {
      ok: true,
      rooms: filtered.map((candidate) => candidate.room),
      updatedAt: now,
    };
  }

  async function requestEntry(uid, data) {
    const payload = exactPayload(data, ["publicRoomId", "visitorCard"]);
    if (!payload || !validateCard(payload.visitorCard)) {
      throw httpsError("invalid-argument", "来訪札の内容を確認してください。");
    }
    const publicRoomId = requirePublicId(payload.publicRoomId);
    const now = currentTime();
    const [roomSnapshot, visitorIdentity, hostIdentity] = await Promise.all([
      publicRoomRef(publicRoomId).get(),
      ensureIdentity(uid),
      identityForPublicSpace(publicRoomId),
    ]);
    const publicRoom = publicRoomProjection(roomSnapshot.val(), now);
    if (!publicRoom || !hostIdentity) {
      throw httpsError("not-found", "この部屋は、いま一息ついています。");
    }
    if (hostIdentity.uid === uid) {
      throw httpsError("failed-precondition", "自分の部屋へ来訪札は送れません。");
    }
    if (await pairIsBlocked(
      uid,
      visitorIdentity.publicMemberId,
      hostIdentity.uid,
      hostIdentity.publicMemberId,
    )) {
      throw httpsError("permission-denied", "この部屋へ来訪札は送れません。");
    }
    const rawRoomId = String(roomSnapshot.val()?.roomId || "");
    if (!CHILD_ID_PATTERN.test(rawRoomId)) {
      throw httpsError("not-found", "この部屋は、いま一息ついています。");
    }
    const [activeSnapshot, ownHostSnapshot, ownerSnapshot] = await Promise.all([
      activeRef(uid).get(),
      hostActiveRef(uid).get(),
      roomOwnerRef(rawRoomId).get(),
    ]);
    if (activeSnapshot.exists()
        && Number(activeSnapshot.val()?.expiresAt || 0) > now) {
      throw httpsError("failed-precondition", "すでに別の自由卓へ入室しています。");
    }
    if (ownHostSnapshot.exists()
        && Number(ownHostSnapshot.val()?.expiresAt || 0) > now) {
      throw httpsError("failed-precondition", "自分の部屋を閉じてから訪ねてください。");
    }
    const publicGeneration = Number(roomSnapshot.val()?.generation || 0);
    const ownerGeneration = Number(ownerSnapshot.val()?.generation || 0);
    const roomId = String(ownerSnapshot.val()?.uid === hostIdentity.uid
      && ownerGeneration === publicGeneration
      ? rawRoomId
      : "");
    if (!CHILD_ID_PATTERN.test(roomId)) {
      throw httpsError("not-found", "この部屋は、いま一息ついています。");
    }
    const proposedRequestId = randomPublicId(randomBytes);
    const expiresAt = Math.min(
      now + FREE_TABLE_REQUEST_TTL_MS,
      Number(publicRoom.expiresAt || now),
    );
    const engagementResult = await engagementRef(uid).transaction((current) => {
      const next = nextEngagementClaim(current, {
        state: "visitor_pending",
        requestId: proposedRequestId,
        roomId,
        publicRoomId,
        hostUid: hostIdentity.uid,
        requestedAt: now,
        expiresAt,
      }, now);
      return next ?? current;
    });
    const engagement = committedTransactionValue(
      engagementResult,
      (value) => (
        value?.state === "visitor_pending"
        && value.roomId === roomId
        && value.publicRoomId === publicRoomId
        && value.hostUid === hostIdentity.uid
        && CHILD_ID_PATTERN.test(String(value.requestId || ""))
        && Number(value.expiresAt || 0) > now
      ),
    );
    if (!engagement) {
      throw httpsError(
        "failed-precondition",
        "自分の部屋を閉じるか、現在の来訪を終えてから来訪札を送ってください。",
      );
    }
    const pendingResult = await visitorPendingRef(uid).transaction((current) => {
      const next = nextVisitorPendingClaim(current, {
        requestId: engagement.requestId,
        roomId: engagement.roomId,
        publicRoomId: engagement.publicRoomId,
        publicMemberId: visitorIdentity.publicMemberId,
        visitorCard: normalizeCard(payload.visitorCard),
        requestedAt: engagement.requestedAt || now,
        expiresAt: engagement.expiresAt,
      }, now);
      return next ?? current;
    });
    const pending = committedTransactionValue(
      pendingResult,
      (value) => (
        value?.requestId === engagement.requestId
        && value.roomId === engagement.roomId
        && value.publicRoomId === engagement.publicRoomId
        && value.publicMemberId === visitorIdentity.publicMemberId
        && Number(value.expiresAt || 0) > now
      ),
    );
    if (!pending) {
      await clearEngagementIfMatches(uid, "requestId", engagement.requestId);
      throw httpsError("failed-precondition", "すでに別の部屋へ来訪札を送っています。");
    }
    const requestId = pending.requestId;
    const internalRequest = {
      requestId,
      roomId,
      publicRoomId,
      hostUid: hostIdentity.uid,
      visitorUid: uid,
      publicMemberId: visitorIdentity.publicMemberId,
      visitorCard: normalizeCard(payload.visitorCard),
      requestedAt: pending.requestedAt || now,
      expiresAt: pending.expiresAt || expiresAt,
    };
    let requestRoomOutcome = "unavailable";
    const roomResult = await roomStateRef(roomId).transaction((current) => {
      requestRoomOutcome = "unavailable";
      if (!current
          || current.state !== "open"
          || current.hostUid !== hostIdentity.uid
          || current.publicRoomId !== publicRoomId
          || Number(current.expiresAt || 0) <= now) return current;
      const decision = nextRoomRequests(
        current.requests,
        internalRequest,
        now,
      );
      requestRoomOutcome = decision.reason;
      if (!decision.accepted) {
        return decision.pruned
          ? { ...current, requests: decision.requests }
          : current;
      }
      return { ...current, requests: decision.requests };
    });
    const updatedRoom = committedTransactionValue(
      roomResult,
      (value) => (
        value?.state === "open"
        && value.hostUid === hostIdentity.uid
        && value.publicRoomId === publicRoomId
        && value.requests?.[requestId]?.visitorUid === uid
        && value.requests?.[requestId]?.requestId === requestId
        && Number(value.expiresAt || 0) > now
      ),
    );
    if (!updatedRoom) {
      await Promise.all([
        clearPendingIfMatches(uid, requestId),
        clearEngagementIfMatches(uid, "requestId", requestId),
      ]);
      if (requestRoomOutcome === "full") {
        throw httpsError(
          "resource-exhausted",
          "この部屋には、いま来訪札がたくさん届いています。少し待ってからもう一度お試しください。",
        );
      }
      throw httpsError("not-found", "この部屋は、いま一息ついています。");
    }
    await requestRef(roomId, requestId).set(publicRequestProjection(internalRequest));
    if (await pairIsBlocked(
      uid,
      visitorIdentity.publicMemberId,
      hostIdentity.uid,
      hostIdentity.publicMemberId,
    )) {
      const blockedClaimRemoved = await removeRealtimeIfMatches(
        engagementRef(uid),
        (current) => (
          current.state === "visitor_pending"
          && current.requestId === requestId
          && current.roomId === roomId
        ),
      );
      if (blockedClaimRemoved) {
        await Promise.all([
          clearPendingIfMatches(uid, requestId),
          requestRef(roomId, requestId).remove(),
          roomStateRef(roomId).transaction((current) => {
            const request = current?.requests?.[requestId];
            if (!request || request.visitorUid !== uid) return current;
            const requests = { ...objectValue(current.requests) };
            delete requests[requestId];
            return { ...current, requests };
          }),
        ]);
      } else {
        const activeCandidate = (await activeRef(uid).get()).val();
        const candidateSessionId = CHILD_ID_PATTERN.test(
          String(activeCandidate?.sessionId || ""),
        ) ? activeCandidate.sessionId : "";
        if (candidateSessionId && await pairIsBlocked(
          uid,
          visitorIdentity.publicMemberId,
          hostIdentity.uid,
          hostIdentity.publicMemberId,
        )) {
          await endFixedPairSessionIfActive(
            uid,
            hostIdentity.uid,
            candidateSessionId,
          );
        }
      }
      throw httpsError("permission-denied", "この部屋へ来訪札は送れません。");
    }
    return {
      ok: true,
      pending: true,
      request: publicRequestProjection(internalRequest),
      room: publicRoom,
    };
  }

  async function cancelEntryRequest(uid, data) {
    if (!exactPayload(data, [])) {
      throw httpsError("invalid-argument", "来訪札の取り下げを確認してください。");
    }
    const [pendingSnapshot, initialEngagementSnapshot, initialActiveSnapshot] = await Promise.all([
      visitorPendingRef(uid).get(),
      engagementRef(uid).get(),
      activeRef(uid).get(),
    ]);
    const pending = pendingSnapshot.val();
    if (!pending
        || !CHILD_ID_PATTERN.test(String(pending.requestId || ""))
        || !CHILD_ID_PATTERN.test(String(pending.roomId || ""))) {
      const engagement = initialEngagementSnapshot.val();
      const active = initialActiveSnapshot.val();
      if ((engagement?.state === "active"
          && Number(engagement.expiresAt || 0) > currentTime())
          || (active?.sessionId
            && Number(active.expiresAt || 0) > currentTime())) {
        throw httpsError(
          "failed-precondition",
          "お迎えが成立しました。現在の自由卓を確認してください。",
        );
      }
      return { ok: true, cancelled: false };
    }
    const claimRemoved = await removeRealtimeIfMatches(
      engagementRef(uid),
      (current) => (
        current.state === "visitor_pending"
        && current.requestId === pending.requestId
        && current.roomId === pending.roomId
      ),
    );
    if (!claimRemoved) {
      const latestClaim = (await engagementRef(uid).get()).val();
      if (latestClaim?.state === "active") {
        throw httpsError(
          "failed-precondition",
          "お迎えが成立しました。現在の自由卓を確認してください。",
        );
      }
      if (latestClaim
          && Number(latestClaim.expiresAt || 0) > currentTime()
          && latestClaim.requestId !== pending.requestId) {
        throw httpsError("aborted", "来訪札の状態が変わりました。");
      }
    }
    await clearPendingIfMatches(uid, pending.requestId);
    await Promise.all([
      requestRef(pending.roomId, pending.requestId).remove(),
      roomStateRef(pending.roomId).transaction((current) => {
        const request = current?.requests?.[pending.requestId];
        if (!request || request.visitorUid !== uid) return current;
        const requests = { ...objectValue(current.requests) };
        delete requests[pending.requestId];
        return { ...current, requests };
      }),
    ]);
    return {
      ok: true,
      cancelled: true,
      requestId: pending.requestId,
    };
  }

  async function materializedSessionIsCurrent(session, requestId) {
    const [
      roomSnapshot,
      storedSessionSnapshot,
      hostActiveSnapshot,
      hostClaimSnapshot,
      visitorClaimSnapshot,
      hostEngagementSnapshot,
      visitorEngagementSnapshot,
    ] = await Promise.all([
      roomStateRef(session.roomId).get(),
      sessionRef(session.sessionId).get(),
      hostActiveRef(session.hostUid).get(),
      activeRef(session.hostUid).get(),
      activeRef(session.visitorUid).get(),
      engagementRef(session.hostUid).get(),
      engagementRef(session.visitorUid).get(),
    ]);
    const room = roomSnapshot.val();
    const storedSession = storedSessionSnapshot.val();
    const hostActive = hostActiveSnapshot.val();
    const hostClaim = hostClaimSnapshot.val();
    const visitorClaim = visitorClaimSnapshot.val();
    const hostEngagement = hostEngagementSnapshot.val();
    const visitorEngagement = visitorEngagementSnapshot.val();
    return room?.state === "active"
      && room.acceptedRequestId === requestId
      && room.session?.sessionId === session.sessionId
      && storedSession?.sessionId === session.sessionId
      && ["connecting", "active"].includes(storedSession.status)
      && hostActive?.state === "active"
      && hostActive.sessionId === session.sessionId
      && hostClaim?.sessionId === session.sessionId
      && visitorClaim?.sessionId === session.sessionId
      && hostEngagement?.state === "active"
      && hostEngagement.sessionId === session.sessionId
      && visitorEngagement?.state === "active"
      && visitorEngagement.sessionId === session.sessionId;
  }

  async function retireStaleMaterialization(session) {
    try {
      await endSessionInternal(
        session.hostUid,
        session.sessionId,
        "safe_exit",
      );
      return;
    } catch {
      // Concurrent cleanup may already have removed the canonical session.
    }
    const sessionRemoved = await removeRealtimeIfMatches(
      sessionRef(session.sessionId),
      (current) => (
        current.sessionId === session.sessionId
        && current.roomId === session.roomId
        && ["connecting", "active"].includes(current.status)
      ),
    );
    await Promise.all([
      clearActiveIfMatches(session.hostUid, session.sessionId),
      clearActiveIfMatches(session.visitorUid, session.sessionId),
      clearHostActiveIfMatches(session.hostUid, session.sessionId),
      clearEngagementIfMatches(session.hostUid, "sessionId", session.sessionId),
      clearEngagementIfMatches(session.visitorUid, "sessionId", session.sessionId),
    ]);
    if (sessionRemoved) {
      await freeTablesRoot().update({
        [`presence/${session.sessionId}`]: null,
        [`signals/${session.sessionId}`]: null,
        [`chat/${session.sessionId}`]: null,
      });
    }
  }

  async function completeAcceptedAdmission(uid, room, session) {
    const closedRequests = Object.values(objectValue(room.requests));
    await Promise.all(closedRequests
      .filter((entry) => entry?.visitorUid && entry?.requestId)
      .map((entry) => Promise.all([
        clearPendingIfMatches(entry.visitorUid, entry.requestId),
        clearEngagementIfMatches(entry.visitorUid, "requestId", entry.requestId),
      ])));
    if (await pairIsBlocked(
      session.hostUid,
      session.publicMembers?.[session.hostUid],
      session.visitorUid,
      session.publicMembers?.[session.visitorUid],
    )) {
      await endSessionInternal(session.hostUid, session.sessionId, "safe_exit");
      throw httpsError("permission-denied", "ブロック状態が変わったため、お迎えを終了しました。");
    }
    return {
      ok: true,
      accepted: true,
      session: publicSessionProjection(uid, session),
    };
  }

  async function respondToRequest(uid, data) {
    const payload = exactPayload(data, ["requestId", "accept"]);
    if (!payload) {
      throw httpsError("invalid-argument", "お迎えの操作を確認してください。");
    }
    const requestId = requireChildId(payload.requestId, "来訪札");
    const accept = requireBoolean(payload.accept, "お迎えの選択");
    const now = currentTime();
    const hostSnapshot = await hostActiveRef(uid).get();
    const host = hostSnapshot.val();
    if (accept
        && host?.state === "active"
        && CHILD_ID_PATTERN.test(String(host.roomId || ""))
        && CHILD_ID_PATTERN.test(String(host.sessionId || ""))
        && Number(host.expiresAt || 0) > now) {
      const [activeRoomSnapshot, activeSessionSnapshot] = await Promise.all([
        roomStateRef(host.roomId).get(),
        sessionRef(host.sessionId).get(),
      ]);
      const activeRoom = activeRoomSnapshot.val();
      const activeSession = activeSessionSnapshot.val();
      if (activeRoom?.state === "active"
          && activeRoom.acceptedRequestId === requestId
          && activeRoom.session?.sessionId === host.sessionId
          && activeSession?.sessionId === host.sessionId
          && activeSession.hostUid === uid
          && ["connecting", "active"].includes(activeSession.status)
          && Number(activeSession.expiresAt || 0) > now) {
        return completeAcceptedAdmission(uid, activeRoom, activeSession);
      }
    }
    if (!host
        || host.state !== "open"
        || Number(host.expiresAt || 0) <= now
        || !CHILD_ID_PATTERN.test(String(host.roomId || ""))) {
      throw httpsError("failed-precondition", "お迎え中の部屋が見つかりません。");
    }
    const roomId = host.roomId;
    const beforeSnapshot = await roomStateRef(roomId).get();
    const before = beforeSnapshot.val();
    const requested = objectValue(before?.requests)[requestId];
    if (!requested
        || requested.hostUid !== uid
        || Number(requested.expiresAt || 0) <= now) {
      throw httpsError("not-found", "この来訪札は期限が切れています。");
    }
    if (await pairIsBlocked(
      uid,
      String(before.publicMemberId || ""),
      requested.visitorUid,
      requested.publicMemberId,
    )) {
      await Promise.all([
        requestRef(roomId, requestId).remove(),
        clearPendingIfMatches(requested.visitorUid, requestId),
        clearEngagementIfMatches(requested.visitorUid, "requestId", requestId),
      ]);
      throw httpsError("permission-denied", "この来訪札は受け付けられません。");
    }
    const proposedSessionId = randomPublicId(randomBytes);
    const roomResult = await roomStateRef(roomId).transaction((current) => (
      nextAdmissionState(current, {
        hostUid: uid,
        requestId,
        accept,
        sessionId: proposedSessionId,
        now,
      }) ?? current
    ));
    const room = committedTransactionValue(
      roomResult,
      (value) => (
        value?.hostUid === uid
        && (
          accept
            ? (
              value.state === "active"
              && value.acceptedRequestId === requestId
              && CHILD_ID_PATTERN.test(String(value.session?.sessionId || ""))
              && value.session?.hostUid === uid
              && value.session?.visitorUid === requested.visitorUid
            )
            : (
              value.state === "open"
              && !value.requests?.[requestId]
            )
        )
      ),
    );
    if (!room) {
      throw httpsError("aborted", "お迎え状態が変わりました。もう一度お試しください。");
    }
    if (!accept) {
      await Promise.all([
        requestRef(roomId, requestId).remove(),
        clearPendingIfMatches(requested.visitorUid, requestId),
        clearEngagementIfMatches(requested.visitorUid, "requestId", requestId),
      ]);
      return { ok: true, accepted: false, requestId };
    }
    const session = room.session;
    if (!session
        || !CHILD_ID_PATTERN.test(String(session.sessionId || ""))
        || session.hostUid !== uid
        || session.visitorUid !== requested.visitorUid) {
      throw httpsError("internal", "入室状態を確定できませんでした。");
    }
    const admissionProposal = {
      hostUid: session.hostUid,
      visitorUid: session.visitorUid,
      roomId,
      requestId,
      sessionId: session.sessionId,
      publicRoomId: session.publicRoomId,
      generation: Number(session.generation || room.generation || 0),
      expiresAt: session.expiresAt,
      requestedAt: requested.requestedAt,
      requestExpiresAt: requested.expiresAt,
      hostHeartbeatAt: host.heartbeatAt,
      hostExpiresAt: host.expiresAt,
    };
    const restoreAdmissionRoom = () => roomStateRef(roomId).transaction(
      (current) => {
        if (current?.state !== "active"
            || current.acceptedRequestId !== requestId
            || current.session?.sessionId !== session.sessionId) return current;
        const next = { ...current, state: "open" };
        delete next.acceptedRequestId;
        delete next.session;
        return next;
      },
      undefined,
      false,
    );
    const restoreHostAdmission = () => engagementRef(session.hostUid).transaction(
      (current) => restoredHostOpenClaim(current, admissionProposal),
      undefined,
      false,
    );
    const restoreVisitorAdmission = () => engagementRef(session.visitorUid).transaction(
      (current) => restoredVisitorPendingClaim(current, admissionProposal),
      undefined,
      false,
    );
    const restoreAcceptedHostAdmission = () => engagementRef(session.hostUid).transaction(
      (current) => restoredAcceptedHostOpenClaim(current, admissionProposal),
      undefined,
      false,
    );
    const hostAdmissionResult = await engagementRef(session.hostUid).transaction(
      (current) => (
        nextHostAdmissionClaim(current, admissionProposal, now) ?? current
      ),
      undefined,
      false,
    );
    const hostAdmission = committedTransactionValue(
      hostAdmissionResult,
      (value) => (
        ["host_admitting", "active"].includes(value?.state)
        && value.role === "host"
        && value.sessionId === session.sessionId
        && value.roomId === roomId
      ),
    );
    if (!hostAdmission) {
      await restoreAdmissionRoom();
      throw httpsError(
        "failed-precondition",
        "来訪者が別の自由卓へ移動したため、お迎えできませんでした。",
      );
    }
    const visitorAdmissionResult = await engagementRef(session.visitorUid).transaction(
      (current) => (
        nextVisitorAdmissionClaim(current, admissionProposal, now) ?? current
      ),
      undefined,
      false,
    );
    const visitorAdmission = committedTransactionValue(
      visitorAdmissionResult,
      (value) => (
        value?.state === "active"
        && value.role === "visitor"
        && value.sessionId === session.sessionId
        && value.roomId === roomId
      ),
    );
    if (!visitorAdmission) {
      await Promise.all([
        restoreHostAdmission(),
        restoreAdmissionRoom(),
      ]);
      throw httpsError(
        "failed-precondition",
        "来訪者が別の自由卓へ移動したため、お迎えできませんでした。",
      );
    }
    const finalHostResult = await engagementRef(session.hostUid).transaction(
      (current) => (
        nextFinalHostAdmissionClaim(current, admissionProposal, now) ?? current
      ),
      undefined,
      false,
    );
    const finalHost = committedTransactionValue(
      finalHostResult,
      (value) => (
        value?.state === "active"
        && value.role === "host"
        && value.sessionId === session.sessionId
        && value.roomId === roomId
      ),
    );
    if (!finalHost) {
      const latestHost = (await engagementRef(session.hostUid).get()).val();
      if (latestHost?.state !== "active"
          || latestHost.role !== "host"
          || latestHost.sessionId !== session.sessionId
          || latestHost.roomId !== roomId) {
        await Promise.all([
          restoreVisitorAdmission(),
          restoreHostAdmission(),
          restoreAdmissionRoom(),
        ]);
        throw httpsError(
          "failed-precondition",
          "来訪者が別の自由卓へ移動したため、お迎えできませんでした。",
        );
      }
    }
    const updates = {
      [`sessions/${session.sessionId}`]: session,
      [`active/${session.hostUid}`]: {
        sessionId: session.sessionId,
        role: "host",
        heartbeatAt: now,
        expiresAt: session.expiresAt,
      },
      [`active/${session.visitorUid}`]: {
        sessionId: session.sessionId,
        role: "visitor",
        heartbeatAt: now,
        expiresAt: session.expiresAt,
      },
      [`hostActive/${session.hostUid}`]: {
        roomId,
        publicRoomId: session.publicRoomId,
        sessionId: session.sessionId,
        state: "active",
        ...(Number.isSafeInteger(Number(session.generation))
          && Number(session.generation) > 0
          ? { generation: Number(session.generation) }
          : {}),
        heartbeatAt: now,
        expiresAt: session.expiresAt,
      },
      [`publicRooms/${session.publicRoomId}`]: null,
      [`requests/${roomId}`]: null,
    };
    try {
      await freeTablesRoot().update(updates);
    } catch (error) {
      let materializationVerification = "unknown";
      try {
        materializationVerification = await materializedSessionIsCurrent(
          session,
          requestId,
        ) ? "current" : "absent";
      } catch {
        // The same transient failure can also make the verification reads fail.
      }
      if (materializationVerification === "absent") {
        await Promise.allSettled([
          restoreAcceptedHostAdmission(),
          restoreVisitorAdmission(),
          restoreAdmissionRoom(),
        ]);
        throw httpsError(
          "unavailable",
          "お迎えの確定通信に失敗しました。来訪札はそのままでもう一度お試しください。",
        );
      }
      if (materializationVerification === "unknown") {
        throw httpsError(
          "unavailable",
          "お迎えの確定結果を確認できませんでした。状態を更新してからもう一度お試しください。",
        );
      }
    }
    if (!await materializedSessionIsCurrent(session, requestId)) {
      await retireStaleMaterialization(session);
      throw httpsError(
        "aborted",
        "お迎え中に部屋の期限が切れました。もう一度お試しください。",
      );
    }
    return completeAcceptedAdmission(uid, room, session);
  }

  async function finalizeSeatGrowth(session) {
    const hostUid = session.hostUid;
    const visitorUid = session.visitorUid;
    const sessionId = session.sessionId;
    const pairId = internalPairId(hostUid, visitorUid);
    const now = Math.max(0, Number(session.startedAt || currentTime()));
    const ledgerReference = visitLedgerRef(sessionId);
    const pairReference = pairActivityRef(pairId);
    const hostSpaceReference = spaceRef(hostUid);
    return firestore.runTransaction(async (transaction) => {
      const [ledgerSnapshot, pairSnapshot, spaceSnapshot] = await Promise.all([
        transaction.get(ledgerReference),
        transaction.get(pairReference),
        transaction.get(hostSpaceReference),
      ]);
      if (ledgerSnapshot.exists) {
        const ledger = ledgerSnapshot.data();
        return {
          visitId: String(ledger.visitId || sessionId),
          integrated: ledger.integrated === true,
          grew: ledger.grew === true,
          growth: ownerGrowthProjection(ledger.growth),
        };
      }
      if (!spaceSnapshot.exists) {
        throw httpsError("failed-precondition", "部屋のしつらえを確認できませんでした。");
      }
      const pair = pairSnapshot.exists ? pairSnapshot.data() : {};
      const previousGrowthAt = Math.max(0, Number(pair.lastGrowthAt || 0));
      const {
        visitId,
        integrated,
        grew,
        growth,
      } = pairGrowthDecision(pair, spaceSnapshot.data()?.growth, sessionId, now);
      transaction.set(hostSpaceReference, {
        growth,
        updatedAt: now,
      }, { merge: true });
      transaction.set(pairReference, {
        pairId,
        participants: [hostUid, visitorUid].sort(),
        lastVisitId: visitId,
        lastVisitAt: now,
        lastGrowthAt: grew ? now : previousGrowthAt,
        updatedAt: now,
      }, { merge: true });
      const result = {
        visitId,
        integrated,
        grew,
        growth,
      };
      transaction.create(ledgerReference, {
        protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
        sessionId,
        visitId,
        pairId,
        hostUid,
        visitorUid,
        integrated,
        grew,
        growth,
        createdAt: now,
        expireAt: Timestamp.fromMillis(now + FREE_TABLE_VISIT_LEDGER_RETENTION_MS),
      });
      return {
        ...result,
        growth: ownerGrowthProjection(result.growth),
      };
    });
  }

  async function refreshEstablishedClaims(session, now) {
    const expiresAt = Number(session.hardExpiresAt || session.expiresAt || 0);
    const engagementResults = await Promise.all(
      [session.hostUid, session.visitorUid].map((participantUid) => (
        engagementRef(participantUid).transaction(
          (current) => (
            current?.state === "active"
              && current.sessionId === session.sessionId
              ? { ...current, heartbeatAt: now, expiresAt }
              : current
          ),
          undefined,
          false,
        )
      )),
    );
    if (engagementResults.some((result) => !committedTransactionValue(
      result,
      (value) => (
        value?.state === "active"
        && value.sessionId === session.sessionId
        && value.expiresAt === expiresAt
      ),
    ))) {
      throw httpsError("aborted", "入室状態が変わりました。もう一度お試しください。");
    }
    const claimResults = await Promise.all([
      activeRef(session.hostUid).transaction((current) => (
        current?.sessionId === session.sessionId
          ? { ...current, heartbeatAt: now, expiresAt }
          : current
      )),
      activeRef(session.visitorUid).transaction((current) => (
        current?.sessionId === session.sessionId
          ? { ...current, heartbeatAt: now, expiresAt }
          : current
      )),
      hostActiveRef(session.hostUid).transaction((current) => (
        current?.sessionId === session.sessionId
          ? { ...current, heartbeatAt: now, expiresAt }
          : current
      )),
    ]);
    if (claimResults.some((result) => !committedTransactionValue(
      result,
      (value) => (
        value?.sessionId === session.sessionId
        && value.expiresAt === expiresAt
      ),
    ))) {
      throw httpsError("aborted", "入室状態が変わりました。もう一度お試しください。");
    }
  }

  async function arriveAtSession(uid, data) {
    const payload = exactPayload(data, ["sessionId"]);
    if (!payload) throw httpsError("invalid-argument", "入室確認を確認してください。");
    const sessionId = requireChildId(payload.sessionId, "自由卓");
    const now = currentTime();
    const activeSnapshot = await activeRef(uid).get();
    const active = activeSnapshot.val();
    if (!active
        || active.sessionId !== sessionId
        || Number(active.expiresAt || 0) <= now) {
      throw httpsError("failed-precondition", "現在の自由卓として確認できません。");
    }
    const result = await sessionRef(sessionId).transaction(
      (current) => nextArrivalState(current, uid, now) ?? current,
      undefined,
      false,
    );
    const session = committedTransactionValue(
      result,
      (value) => (
        value?.sessionId === sessionId
        && value.participants?.[uid] === true
        && ["connecting", "active"].includes(value.status)
        && (
          (value.hostUid === uid && value.arrivals?.host === true)
          || (value.visitorUid === uid && value.arrivals?.visitor === true)
        )
        && Number(value.expiresAt || 0) > now
      ),
    );
    if (!session) {
      throw httpsError("failed-precondition", "入室確認の期限が切れています。");
    }
    await refreshActiveHeartbeatIfMatches(uid, sessionId, now);
    const established = session.admissionAccepted === true
      && session.p2pConnected === true
      && session.arrivals?.host === true
      && session.arrivals?.visitor === true;
    if (established) await refreshEstablishedClaims(session, now);
    const growth = established ? await finalizeSeatGrowth(session) : null;
    if (growth) {
      const latestSessionSnapshot = await sessionRef(sessionId).get();
      const latestSession = latestSessionSnapshot.val();
      if (latestSession?.endedAt) {
        await recordSeatEnded(latestSession, latestSession.endedAt);
      }
    }
    return {
      ok: true,
      established,
      seatEstablished: established,
      session: publicSessionProjection(uid, session),
      ...(growth ? { growth } : {}),
    };
  }

  async function clearActiveIfMatches(uid, sessionId) {
    await activeRef(uid).transaction((current) => (
      current?.sessionId === sessionId ? null : current
    ));
  }

  async function clearHostActiveIfMatches(uid, sessionId) {
    await hostActiveRef(uid).transaction((current) => (
      current?.sessionId === sessionId ? null : current
    ));
  }

  async function refreshActiveHeartbeatIfMatches(uid, sessionId, now) {
    return activeRef(uid).transaction(
      (current) => (
        current?.sessionId === sessionId
          && Number(current.expiresAt || 0) > now
          ? { ...current, heartbeatAt: now }
          : current
      ),
      undefined,
      false,
    );
  }

  async function releaseOrphanedParticipantClaims(uid, sessionId) {
    await Promise.all([
      clearActiveIfMatches(uid, sessionId),
      clearHostActiveIfMatches(uid, sessionId),
      clearEngagementIfMatches(uid, "sessionId", sessionId),
      presenceRef(sessionId).child(uid).remove(),
    ]);
  }

  function normalizedEnding(kind, line) {
    if (kind === "departure") {
      return {
        kind,
        line: normalizeDepartureLine(line),
        sendoffLine: "いってらっしゃい",
      };
    }
    if (kind === "wrap_up") {
      return {
        kind,
        line: boundedLine(line || "今日はここまで", 80),
        sendoffLine: "",
      };
    }
    return { kind, line: "", sendoffLine: "" };
  }

  async function recordSeatEnded(session, endedAt) {
    if (!session?.sessionId || !session?.hostUid || !session?.visitorUid) return;
    const ledgerReference = visitLedgerRef(session.sessionId);
    const pairReference = pairActivityRef(internalPairId(session.hostUid, session.visitorUid));
    await firestore.runTransaction(async (transaction) => {
      const [ledgerSnapshot, pairSnapshot] = await Promise.all([
        transaction.get(ledgerReference),
        transaction.get(pairReference),
      ]);
      if (!ledgerSnapshot.exists || !pairSnapshot.exists) return;
      const ledger = ledgerSnapshot.data();
      const pair = pairSnapshot.data();
      if (pair.lastVisitId !== ledger.visitId) return;
      transaction.set(pairReference, {
        lastEndedAt: Math.max(
          Number(pair.lastEndedAt || 0),
          Number(endedAt || 0),
        ),
        updatedAt: Math.max(
          Number(pair.updatedAt || 0),
          Number(endedAt || 0),
        ),
      }, { merge: true });
    });
  }

  async function endSessionInternal(uid, sessionId, requestedKind, line = "") {
    const now = currentTime();
    const kind = normalizeEndKind(requestedKind);
    if (!kind) throw httpsError("invalid-argument", "お開きの方法を確認してください。");
    const result = await sessionRef(sessionId).transaction(
      (current) => {
        if (!current || current.participants?.[uid] !== true) return current;
        if (current.status === "ended") return current;
        if (!["connecting", "active"].includes(current.status)) return current;
        const role = current.hostUid === uid
          ? "host"
          : current.visitorUid === uid
            ? "visitor"
            : "";
        if (!role || (kind === "departure" && role !== "visitor")) return current;
        return {
          ...current,
          status: "ended",
          endedAt: now,
          endedByRole: role,
          ending: normalizedEnding(kind, line),
          expiresAt: now + FREE_TABLE_ENDED_RETENTION_MS,
        };
      },
      undefined,
      false,
    );
    const session = committedTransactionValue(
      result,
      (value) => (
        value?.sessionId === sessionId
        && value.participants?.[uid] === true
        && value.status === "ended"
        && Number(value.endedAt || 0) > 0
      ),
    );
    if (!session) {
      throw httpsError("failed-precondition", "現在の自由卓として確認できません。");
    }
    await finalizeEndedSessionResources(session);
    return session;
  }

  function sessionPresenceIsFresh(presenceValue, uid, now) {
    const presence = objectValue(presenceValue)[uid];
    return presence?.online === true
      && Number(presence.lastSeen || 0) > 0
      && Number(presence.expiresAt || 0) > now;
  }

  async function finalizeEndedSessionResources(session) {
    if (!session?.sessionId || !session.hostUid || !session.visitorUid) return;
    await Promise.all([
      clearActiveIfMatches(session.hostUid, session.sessionId),
      clearActiveIfMatches(session.visitorUid, session.sessionId),
      clearHostActiveIfMatches(session.hostUid, session.sessionId),
      clearEngagementIfMatches(session.hostUid, "sessionId", session.sessionId),
      clearEngagementIfMatches(session.visitorUid, "sessionId", session.sessionId),
      presenceRef(session.sessionId).remove(),
      signalsRef(session.sessionId).remove(),
    ]);
    await recordSeatEnded(session, session.endedAt);
    const finalizedAt = currentTime();
    await sessionRef(session.sessionId).transaction(
      (current) => {
        if (current?.sessionId !== session.sessionId
            || current.status !== "ended"
            || Number(current.endedAt || 0) !== Number(session.endedAt || 0)) {
          return current;
        }
        return {
          ...current,
          cleanupFinalizedAt: Math.max(
            Number(current.cleanupFinalizedAt || 0),
            finalizedAt,
          ),
        };
      },
      undefined,
      false,
    );
  }

  async function releaseDisconnectLock(sessionId, cleanupToken) {
    await presenceRef(sessionId).transaction((currentValue) => {
      const current = objectValue(currentValue);
      if (current._disconnect?.state !== "locked"
          || current._disconnect?.cleanupToken !== cleanupToken) return currentValue;
      const next = { ...current };
      delete next._disconnect;
      return Object.keys(next).length ? next : null;
    });
  }

  async function reconcileDisconnectedSession(sessionId, expectedSession, now) {
    let finalOutcome = { type: "unchanged" };
    const proposedCleanupToken = randomPublicId(randomBytes);
    const presenceResult = await presenceRef(sessionId).transaction((currentValue) => {
      finalOutcome = { type: "unchanged" };
      const current = objectValue(currentValue);
      const existingControl = objectValue(current._disconnect);
      if (existingControl.state === "locked"
          && existingControl.sessionId === sessionId
          && CHILD_ID_PATTERN.test(String(existingControl.cleanupToken || ""))) {
        finalOutcome = {
          type: "locked",
          cleanupToken: existingControl.cleanupToken,
        };
        return currentValue;
      }
      const missingHost = !sessionPresenceIsFresh(
        current,
        expectedSession.hostUid,
        now,
      );
      const missingVisitor = !sessionPresenceIsFresh(
        current,
        expectedSession.visitorUid,
        now,
      );
      if (!missingHost && !missingVisitor) {
        if (!current._disconnect) return currentValue;
        const recoveredPresence = { ...current };
        delete recoveredPresence._disconnect;
        finalOutcome = { type: "recovered" };
        return recoveredPresence;
      }
      const sameMissingParticipants = existingControl.state === "probe"
        && existingControl.sessionId === sessionId
        && existingControl.missingHost === missingHost
        && existingControl.missingVisitor === missingVisitor;
      if (!sameMissingParticipants
          || Number(existingControl.recheckAt || 0) <= 0) {
        finalOutcome = { type: "probed" };
        return {
          ...current,
          _disconnect: {
            state: "probe",
            sessionId,
            missingHost,
            missingVisitor,
            observedAt: now,
            recheckAt: now + FREE_TABLE_DISCONNECT_GRACE_MS,
          },
        };
      }
      if (Number(existingControl.recheckAt || 0) > now) {
        finalOutcome = { type: "waiting" };
        return currentValue;
      }
      finalOutcome = {
        type: "locked",
        cleanupToken: proposedCleanupToken,
      };
      return {
        ...current,
        _disconnect: {
          state: "locked",
          sessionId,
          missingHost,
          missingVisitor,
          observedAt: Number(existingControl.observedAt || now),
          lockedAt: now,
          lockExpiresAt: now + FREE_TABLE_CONNECTING_TTL_MS,
          cleanupToken: proposedCleanupToken,
        },
      };
    });
    if (!presenceResult?.committed) {
      return { type: "unchanged", session: null };
    }
    const storedControl = presenceResult.snapshot.child("_disconnect").val();
    if (finalOutcome.type !== "locked"
        || storedControl?.state !== "locked"
        || storedControl.sessionId !== sessionId
        || storedControl.cleanupToken !== finalOutcome.cleanupToken) {
      return { type: finalOutcome.type, session: null };
    }
    const cleanupToken = storedControl.cleanupToken;
    const sessionResult = await sessionRef(sessionId).transaction(
      (current) => {
        if (current?.status === "ended") return current;
        if (current?.sessionId !== sessionId
            || current.status !== "active"
            || current.p2pConnected !== true
            || current.arrivals?.host !== true
            || current.arrivals?.visitor !== true
            || current.hostUid !== expectedSession.hostUid
            || current.visitorUid !== expectedSession.visitorUid
            || Number(current.expiresAt || 0) <= now) return current;
        return {
          ...current,
          status: "ended",
          endedAt: now,
          endedByRole: "system",
          ending: normalizedEnding("disconnected", ""),
          disconnectCleanupToken: cleanupToken,
          expiresAt: now + FREE_TABLE_ENDED_RETENTION_MS,
        };
      },
      undefined,
      false,
    );
    const storedSession = sessionResult?.snapshot?.val();
    if (storedSession?.status === "ended"
        && storedSession.sessionId === sessionId) {
      await finalizeEndedSessionResources(storedSession);
      return {
        type: storedSession.ending?.kind === "disconnected"
          && storedSession.disconnectCleanupToken === cleanupToken
          ? "ended"
          : "settled",
        session: storedSession,
      };
    }
    await releaseDisconnectLock(sessionId, cleanupToken);
    return { type: "unchanged", session: storedSession || null };
  }

  async function endSession(uid, data) {
    const payload = exactPayload(data, ["sessionId", "reason"], ["message"]);
    if (!payload) throw httpsError("invalid-argument", "お開きの操作を確認してください。");
    const sessionId = requireChildId(payload.sessionId, "自由卓");
    if (payload.message !== undefined
        && (typeof payload.message !== "string"
          || codePointLength(normalizeLine(payload.message)) > 80)) {
      throw httpsError("invalid-argument", "お開きの言葉は80文字以内にしてください。");
    }
    const session = await endSessionInternal(
      uid,
      sessionId,
      payload.reason,
      payload.message || "",
    );
    return {
      ok: true,
      ended: true,
      session: publicSessionProjection(uid, session),
    };
  }

  async function loadPublicSpaceSummary(publicRoomId) {
    const identity = await identityForPublicSpace(publicRoomId);
    if (!identity) return null;
    const snapshot = await spaceRef(identity.uid).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (!validateRoomSettings(data?.space) || !validateCard(data?.hostCard)) return null;
    return {
      publicRoomId,
      publicMemberId: identity.publicMemberId,
      space: normalizeRoomSettings(data.space),
      hostCard: normalizeCard(data.hostCard),
      updatedAt: Math.max(0, Number(data.updatedAt || 0)),
    };
  }

  async function setBookmark(uid, data) {
    const payload = exactPayload(data, ["publicRoomId", "active"]);
    if (!payload) throw httpsError("invalid-argument", "帰る場所の操作を確認してください。");
    const publicRoomId = requirePublicId(payload.publicRoomId);
    const active = requireBoolean(payload.active, "帰る場所の選択");
    const target = await identityForPublicSpace(publicRoomId);
    if (!target) throw httpsError("not-found", "この部屋を確認できませんでした。");
    if (target.uid === uid) {
      throw httpsError("failed-precondition", "自分の部屋は帰る場所へ追加できません。");
    }
    const reference = bookmarkRef(uid, publicRoomId);
    if (!active) {
      await reference.delete();
      return { ok: true, active: false, publicRoomId };
    }
    const existing = await reference.get();
    if (!existing.exists) {
      const page = await bookmarkCollection(uid).limit(FREE_TABLE_BOOKMARK_LIMIT + 1).get();
      if (page.size >= FREE_TABLE_BOOKMARK_LIMIT) {
        throw httpsError("resource-exhausted", "帰る場所は100件までです。");
      }
    }
    const summary = await loadPublicSpaceSummary(publicRoomId);
    if (!summary) throw httpsError("not-found", "この部屋を確認できませんでした。");
    const now = currentTime();
    await firestore.runTransaction(async (transaction) => {
      const [bookmarkSnapshot, blockPairSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(blockPairRef(uid, target.uid)),
      ]);
      if (!blockPairSnapshotIsSafe(blockPairSnapshot, uid, target.uid)) {
        throw httpsError("permission-denied", "この部屋は帰る場所へ追加できません。");
      }
      transaction.set(reference, {
        ownerUid: uid,
        hostUid: target.uid,
        ...summary,
        createdAt: bookmarkSnapshot.exists
          ? Math.max(0, Number(bookmarkSnapshot.data()?.createdAt || now))
          : now,
        updatedAt: now,
      });
    });
    return { ok: true, active: true, bookmark: summary };
  }

  async function setRelationship(uid, data) {
    const payload = exactPayload(data, ["sessionId", "wants"]);
    if (!payload) throw httpsError("invalid-argument", "縁の操作を確認してください。");
    const sessionId = requireChildId(payload.sessionId, "自由卓");
    const wants = requireBoolean(payload.wants, "縁の選択");
    const now = currentTime();
    const sessionSnapshot = await sessionRef(sessionId).get();
    const session = sessionSnapshot.val();
    if (!session
        || session.participants?.[uid] !== true
        || session.admissionAccepted !== true
        || session.p2pConnected !== true
        || session.arrivals?.host !== true
        || session.arrivals?.visitor !== true
        || Number(session.expiresAt || 0) <= now) {
      throw httpsError("failed-precondition", "この一席の縁として確認できません。");
    }
    const peerUid = session.hostUid === uid ? session.visitorUid : session.hostUid;
    const ownPublicMemberId = String(session.publicMembers?.[uid] || "");
    const peerPublicMemberId = String(session.publicMembers?.[peerUid] || "");
    if (!PUBLIC_ID_PATTERN.test(ownPublicMemberId)
        || !PUBLIC_ID_PATTERN.test(peerPublicMemberId)) {
      throw httpsError("permission-denied", "この縁は結べません。");
    }
    const pairId = internalPairId(uid, peerUid);
    const reference = relationshipRef(pairId);
    const result = await firestore.runTransaction(async (transaction) => {
      const [snapshot, blockPairSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(blockPairRef(uid, peerUid)),
      ]);
      if (!blockPairSnapshotIsSafe(blockPairSnapshot, uid, peerUid)) {
        throw httpsError("permission-denied", "この縁は結べません。");
      }
      const previous = snapshot.exists ? snapshot.data() : {};
      const participants = [uid, peerUid].sort();
      if (snapshot.exists
          && JSON.stringify([...(previous.participants || [])].sort())
            !== JSON.stringify(participants)) {
        throw httpsError("failed-precondition", "縁の組み合わせを確認できません。");
      }
      const previousWants = objectValue(previous.wants);
      const nextWants = {
        ...previousWants,
        [uid]: wants,
      };
      const mutual = nextWants[participants[0]] === true
        && nextWants[participants[1]] === true;
      const value = {
        pairId,
        participants,
        publicMembers: {
          [session.hostUid]: session.publicMembers?.[session.hostUid] || "",
          [session.visitorUid]: session.publicMembers?.[session.visitorUid] || "",
        },
        wants: nextWants,
        active: mutual,
        sourceSessionId: sessionId,
        createdAt: Math.max(0, Number(previous.createdAt || now)),
        updatedAt: now,
        mutualAt: mutual
          ? Math.max(0, Number(previous.mutualAt || now))
          : 0,
      };
      transaction.set(reference, value);
      return { mutual, value };
    });
    return {
      ok: true,
      wants,
      mutual: result.mutual,
      publicMemberId: String(result.value.publicMembers?.[peerUid] || ""),
    };
  }

  async function resolveBlockTarget(uid, publicMemberId) {
    const own = await ensureIdentity(uid);
    const target = await identityForPublicMember(publicMemberId);
    if (!target) throw httpsError("not-found", "相手を確認できませんでした。");
    if (target.uid === uid) {
      throw httpsError("failed-precondition", "自分自身はブロックできません。");
    }
    return { own, target };
  }

  async function blockOperationIsCurrent(
    uid,
    targetUid,
    publicMemberId,
    operationToken,
  ) {
    if (!PUBLIC_ID_PATTERN.test(String(publicMemberId || ""))
        || !CHILD_ID_PATTERN.test(String(operationToken || ""))) return false;
    const [blockSnapshot, pairSnapshot] = await firestore.getAll(
      blockRef(uid, publicMemberId),
      blockPairRef(uid, targetUid),
    );
    if (!blockSnapshot.exists || !pairSnapshot.exists) return false;
    const block = blockSnapshot.data();
    const pair = pairSnapshot.data();
    const participants = [uid, targetUid].sort();
    return block?.ownerUid === uid
      && block?.targetUid === targetUid
      && block?.publicMemberId === publicMemberId
      && block?.operationToken === operationToken
      && Array.isArray(pair?.participants)
      && JSON.stringify([...pair.participants].sort()) === JSON.stringify(participants)
      && pair?.blockedBy?.[uid] === true
      && pair?.blockTokens?.[uid] === operationToken;
  }

  async function endFixedPairSessionIfActive(uid, targetUid, sessionId) {
    if (!CHILD_ID_PATTERN.test(String(sessionId || ""))) return;
    const snapshot = await sessionRef(sessionId).get();
    const session = snapshot.val();
    if (!session
        || session.participants?.[uid] !== true
        || session.participants?.[targetUid] !== true
        || !["connecting", "active"].includes(session.status)) return;
    await endSessionInternal(uid, sessionId, "safe_exit");
  }

  async function endPairSessionIfActive(
    uid,
    targetUid,
    publicMemberId = "",
    operationToken = "",
  ) {
    if (operationToken
        && !await blockOperationIsCurrent(
          uid,
          targetUid,
          publicMemberId,
          operationToken,
        )) return;
    const activeSnapshot = await activeRef(uid).get();
    const active = activeSnapshot.val();
    if (!active?.sessionId) return;
    if (operationToken
        && !await blockOperationIsCurrent(
          uid,
          targetUid,
          publicMemberId,
          operationToken,
        )) return;
    await endFixedPairSessionIfActive(uid, targetUid, active.sessionId);
  }

  async function removePendingPair(
    uid,
    targetUid,
    publicMemberId,
    operationToken,
  ) {
    for (const visitorUid of [uid, targetUid]) {
      if (!await blockOperationIsCurrent(
        uid,
        targetUid,
        publicMemberId,
        operationToken,
      )) return;
      const [pendingSnapshot, engagementSnapshot] = await Promise.all([
        visitorPendingRef(visitorUid).get(),
        engagementRef(visitorUid).get(),
      ]);
      const pending = pendingSnapshot.val();
      const engagement = engagementSnapshot.val();
      if (!pending) continue;
      const peerUid = visitorUid === uid ? targetUid : uid;
      if (engagement?.hostUid !== peerUid
          || engagement?.requestId !== pending.requestId) continue;
      if (!await blockOperationIsCurrent(
        uid,
        targetUid,
        publicMemberId,
        operationToken,
      )) return;
      await Promise.all([
        clearPendingIfMatches(visitorUid, pending.requestId),
        clearEngagementIfMatches(visitorUid, "requestId", pending.requestId),
        requestRef(pending.roomId, pending.requestId).remove(),
        roomStateRef(pending.roomId).transaction((current) => {
          if (!current?.requests?.[pending.requestId]) return current;
          const requests = { ...objectValue(current.requests) };
          delete requests[pending.requestId];
          return { ...current, requests };
        }),
      ]);
    }
  }

  async function setBlock(uid, data) {
    const payload = exactPayload(data, ["publicMemberId"]);
    if (!payload) throw httpsError("invalid-argument", "ブロック操作を確認してください。");
    const publicMemberId = requirePublicId(payload.publicMemberId, "相手");
    const { own, target } = await resolveBlockTarget(uid, publicMemberId);
    const reference = blockRef(uid, publicMemberId);
    const existing = await reference.get();
    if (!existing.exists) {
      const page = await blockCollection(uid).limit(FREE_TABLE_BLOCK_LIMIT + 1).get();
      if (page.size >= FREE_TABLE_BLOCK_LIMIT) {
        throw httpsError("resource-exhausted", "ブロックは100件までです。");
      }
    }
    const summary = await loadPublicSpaceSummary(target.publicRoomId);
    const now = currentTime();
    const operationToken = randomPublicId(randomBytes);
    const pairId = internalPairId(uid, target.uid);
    const pairReference = blockPairRef(uid, target.uid);
    const relationshipReference = relationshipRef(pairId);
    await firestore.runTransaction(async (transaction) => {
      const [blockSnapshot, pairSnapshot, relationshipSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(pairReference),
        transaction.get(relationshipReference),
      ]);
      const participants = [uid, target.uid].sort();
      const pair = pairSnapshot.exists ? pairSnapshot.data() : {};
      if (pairSnapshot.exists
          && (!Array.isArray(pair.participants)
            || JSON.stringify([...pair.participants].sort())
              !== JSON.stringify(participants))) {
        throw httpsError("failed-precondition", "ブロック状態を確認できませんでした。");
      }
      const createdAt = blockSnapshot.exists
        ? Math.max(0, Number(blockSnapshot.data()?.createdAt || now))
        : now;
      transaction.set(reference, {
        ownerUid: uid,
        targetUid: target.uid,
        publicMemberId,
        displayName: boundedLine(summary?.hostCard?.name, CARD_LIMITS.name),
        operationToken,
        createdAt,
        updatedAt: now,
      });
      transaction.set(pairReference, {
        pairId,
        participants,
        publicMembers: {
          ...objectValue(pair.publicMembers),
          [uid]: own.publicMemberId,
          [target.uid]: target.publicMemberId,
        },
        blockedBy: {
          ...objectValue(pair.blockedBy),
          [uid]: true,
        },
        blockTokens: {
          ...objectValue(pair.blockTokens),
          [uid]: operationToken,
        },
        createdAt: Math.max(0, Number(pair.createdAt || now)),
        updatedAt: now,
      });
      if (relationshipSnapshot.exists) {
        const relationship = relationshipSnapshot.data();
        if (!Array.isArray(relationship.participants)
            || JSON.stringify([...relationship.participants].sort())
              !== JSON.stringify(participants)) {
          throw httpsError("failed-precondition", "縁の状態を確認できませんでした。");
        }
        transaction.set(relationshipReference, {
          ...relationship,
          active: false,
          wants: {
            ...objectValue(relationship.wants),
            [uid]: false,
          },
          updatedAt: now,
        });
      }
      transaction.delete(bookmarkRef(uid, target.publicRoomId));
      transaction.delete(bookmarkRef(target.uid, own.publicRoomId));
    });
    await Promise.all([
      endPairSessionIfActive(uid, target.uid, publicMemberId, operationToken),
      removePendingPair(uid, target.uid, publicMemberId, operationToken),
    ]);
    if (!await blockOperationIsCurrent(
      uid,
      target.uid,
      publicMemberId,
      operationToken,
    )) {
      throw httpsError(
        "aborted",
        "ブロック状態が別の操作で変わりました。現在の状態を確認してください。",
      );
    }
    return { ok: true, blocked: true, publicMemberId };
  }

  async function unsetBlock(uid, data) {
    const payload = exactPayload(data, ["publicMemberId"]);
    if (!payload) throw httpsError("invalid-argument", "ブロック解除を確認してください。");
    const publicMemberId = requirePublicId(payload.publicMemberId, "相手");
    const reference = blockRef(uid, publicMemberId);
    const [existing, target] = await Promise.all([
      reference.get(),
      identityForPublicMember(publicMemberId),
    ]);
    const targetUid = typeof existing.data()?.targetUid === "string"
      ? existing.data().targetUid
      : target?.uid;
    if (typeof targetUid !== "string" || !targetUid) {
      await reference.delete();
      return { ok: true, blocked: false, publicMemberId };
    }
    const pairReference = blockPairRef(uid, targetUid);
    await firestore.runTransaction(async (transaction) => {
      const [blockSnapshot, pairSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(pairReference),
      ]);
      if (blockSnapshot.exists) transaction.delete(reference);
      if (!pairSnapshot.exists) return;
      const pair = pairSnapshot.data();
      const participants = [uid, targetUid].sort();
      if (!Array.isArray(pair.participants)
          || JSON.stringify([...pair.participants].sort())
            !== JSON.stringify(participants)) {
        throw httpsError("failed-precondition", "ブロック状態を確認できませんでした。");
      }
      const blockedBy = { ...objectValue(pair.blockedBy) };
      const blockTokens = { ...objectValue(pair.blockTokens) };
      delete blockedBy[uid];
      delete blockTokens[uid];
      if (Object.values(blockedBy).some((value) => value === true)) {
        transaction.set(pairReference, {
          ...pair,
          blockedBy,
          blockTokens,
          updatedAt: currentTime(),
        });
      } else {
        transaction.delete(pairReference);
      }
    });
    return { ok: true, blocked: false, publicMemberId };
  }

  async function submitReport(uid, data) {
    const payload = exactPayload(
      data,
      ["sessionId", "reason"],
      ["details", "messageIds"],
    );
    if (!payload || !FREE_TABLE_REPORT_REASONS.includes(payload.reason)) {
      throw httpsError("invalid-argument", "通報内容を確認してください。");
    }
    const sessionId = requireChildId(payload.sessionId, "自由卓");
    if (payload.details !== undefined
        && (typeof payload.details !== "string"
          || codePointLength(safeMultiline(payload.details, 501)) > 500)) {
      throw httpsError("invalid-argument", "通報の補足は500文字以内にしてください。");
    }
    if (payload.messageIds !== undefined
        && (!Array.isArray(payload.messageIds)
          || payload.messageIds.length > FREE_TABLE_REPORT_MESSAGE_LIMIT)) {
      throw httpsError(
        "invalid-argument",
        `通報へ添付できる発言は${FREE_TABLE_REPORT_MESSAGE_LIMIT}件までです。`,
      );
    }
    const now = currentTime();
    const sessionSnapshot = await sessionRef(sessionId).get();
    const session = sessionSnapshot.val();
    if (!session
        || session.participants?.[uid] !== true
        || Number(session.createdAt || 0) > now + 15_000
        || Number(session.expiresAt || 0) <= now) {
      throw httpsError("failed-precondition", "この自由卓からの通報として確認できません。");
    }
    const targetUid = session.hostUid === uid ? session.visitorUid : session.hostUid;
    const requestedMessageIds = [...new Set((payload.messageIds || [])
      .filter((id) => typeof id === "string" && CHILD_ID_PATTERN.test(id)))]
      .slice(0, FREE_TABLE_REPORT_MESSAGE_LIMIT);
    const chatWindowSnapshot = await chatRef(sessionId)
      .orderByChild("createdAt")
      .limitToLast(FREE_TABLE_REPORT_CHAT_SCAN_LIMIT)
      .get();
    const chatWindow = new Map();
    chatWindowSnapshot.forEach((messageSnapshot) => {
      chatWindow.set(messageSnapshot.key, messageSnapshot.val());
    });
    const selectedIds = new Set();
    const messageEntries = [];
    const appendTargetMessage = (messageId, message) => {
      if (selectedIds.has(messageId)
          || message?.authorUid !== targetUid
          || messageEntries.length >= FREE_TABLE_REPORT_MESSAGE_LIMIT) return;
      selectedIds.add(messageId);
      messageEntries.push({ messageId, message });
    };
    for (const messageId of requestedMessageIds) {
      appendTargetMessage(messageId, chatWindow.get(messageId));
    }
    [...chatWindow.entries()]
      .sort(([, first], [, second]) => (
        Number(second?.createdAt || 0) - Number(first?.createdAt || 0)
      ))
      .forEach(([messageId, message]) => appendTargetMessage(messageId, message));
    const evidence = selectReportEvidence(
      messageEntries,
      [...selectedIds],
      session,
      now,
    ).filter((entry) => entry.authorUid === targetUid);
    const reportId = internalReportId(sessionId, uid);
    const proposedReport = {
      protocolVersion: FREE_TABLE_PROTOCOL_VERSION,
      reportId,
      sessionId,
      reporterUid: uid,
      targetUid,
      reason: payload.reason,
      details: safeMultiline(payload.details, 500),
      evidence,
      createdAt: now,
      expireAt: Timestamp.fromMillis(now + FREE_TABLE_REPORT_RETENTION_MS),
    };
    const storedReport = await firestore.runTransaction(async (transaction) => {
      const reference = reportRef(reportId);
      const existingSnapshot = await transaction.get(reference);
      if (existingSnapshot.exists) {
        const existing = existingSnapshot.data();
        if (existing.sessionId !== sessionId || existing.reporterUid !== uid) {
          throw httpsError("aborted", "通報記録の整合性を確認できませんでした。");
        }
        return existing;
      }
      transaction.create(reference, proposedReport);
      return proposedReport;
    });
    return {
      ok: true,
      reportId,
      evidenceCount: Array.isArray(storedReport.evidence)
        ? storedReport.evidence.length
        : 0,
    };
  }

  function publicBookmark(value) {
    const source = objectValue(value);
    if (!PUBLIC_ID_PATTERN.test(String(source.publicRoomId || ""))
        || !PUBLIC_ID_PATTERN.test(String(source.publicMemberId || ""))
        || !validateRoomSettings(source.space)
        || !validateCard(source.hostCard)) return null;
    return {
      publicRoomId: source.publicRoomId,
      publicMemberId: source.publicMemberId,
      space: normalizeRoomSettings(source.space),
      hostCard: normalizeCard(source.hostCard),
      createdAt: Math.max(0, Number(source.createdAt || 0)),
      updatedAt: Math.max(0, Number(source.updatedAt || 0)),
    };
  }

  async function getMyState(uid, data) {
    if (!exactPayload(data, [])) {
      throw httpsError("invalid-argument", "自由卓の状態取得を確認してください。");
    }
    const identity = await ensureIdentity(uid);
    const [
      savedSnapshot,
      hostSnapshot,
      pendingSnapshot,
      activeSnapshot,
      bookmarkSnapshot,
      blockSnapshot,
      relationshipSnapshot,
    ] = await Promise.all([
      spaceRef(uid).get(),
      hostActiveRef(uid).get(),
      visitorPendingRef(uid).get(),
      activeRef(uid).get(),
      bookmarkCollection(uid).limit(FREE_TABLE_BOOKMARK_LIMIT).get(),
      blockCollection(uid).limit(FREE_TABLE_BLOCK_LIMIT).get(),
      firestore.collection("freeTableRelationships")
        .where("participants", "array-contains", uid)
        .limit(FREE_TABLE_RELATIONSHIP_LIMIT)
        .get(),
    ]);
    const now = currentTime();
    const host = hostSnapshot.val();
    let open = null;
    let requests = [];
    if (host?.state === "open"
        && Number(host.expiresAt || 0) > now
        && PUBLIC_ID_PATTERN.test(String(host.publicRoomId || ""))
        && CHILD_ID_PATTERN.test(String(host.roomId || ""))) {
      const [publicSnapshot, incomingSnapshot] = await Promise.all([
        publicRoomRef(host.publicRoomId).get(),
        requestsRef(host.roomId).get(),
      ]);
      const publicOpen = publicRoomProjection(publicSnapshot.val(), now);
      open = publicOpen
        ? { ...publicOpen, requestInboxId: host.roomId }
        : null;
      requests = Object.values(objectValue(incomingSnapshot.val()))
        .filter((request) => Number(request?.expiresAt || 0) > now)
        .map(publicRequestProjection)
        .filter(Boolean)
        .sort((first, second) => first.requestedAt - second.requestedAt);
    }
    let pending = null;
    const pendingValue = pendingSnapshot.val();
    if (pendingValue
        && Number(pendingValue.expiresAt || 0) > now
        && CHILD_ID_PATTERN.test(String(pendingValue.roomId || ""))
        && CHILD_ID_PATTERN.test(String(pendingValue.requestId || ""))) {
      const [requestSnapshot, roomSnapshot] = await Promise.all([
        requestRef(pendingValue.roomId, pendingValue.requestId).get(),
        publicRoomRef(pendingValue.publicRoomId).get(),
      ]);
      const request = publicRequestProjection(requestSnapshot.val());
      const room = publicRoomProjection(roomSnapshot.val(), now);
      if (request && room) pending = { request, room };
    }
    let session = null;
    let storedSession = null;
    let sessionPeerUid = "";
    const active = activeSnapshot.val();
    if (active?.sessionId
        && CHILD_ID_PATTERN.test(String(active.sessionId))
        && Number(active.expiresAt || 0) > now) {
      const sessionSnapshot = await sessionRef(active.sessionId).get();
      storedSession = sessionSnapshot.val();
      const canonicalParticipant = storedSession?.sessionId === active.sessionId
        && storedSession.participants?.[uid] === true
        && ["connecting", "active", "ended"].includes(storedSession.status)
        && Number(storedSession.expiresAt || 0) > now;
      sessionPeerUid = canonicalParticipant && storedSession.hostUid === uid
        ? String(storedSession.visitorUid || "")
        : canonicalParticipant && storedSession.visitorUid === uid
          ? String(storedSession.hostUid || "")
          : "";
      if (!canonicalParticipant || !sessionPeerUid) {
        await releaseOrphanedParticipantClaims(uid, active.sessionId);
        storedSession = null;
        sessionPeerUid = "";
      }
    }
    const bookmarkCandidates = bookmarkSnapshot.docs
      .map((snapshot) => ({
        hostUid: typeof snapshot.data()?.hostUid === "string"
          ? snapshot.data().hostUid
          : "",
        bookmark: publicBookmark(snapshot.data()),
      }))
      .filter((candidate) => candidate.bookmark && candidate.hostUid);
    const relationshipCandidates = relationshipSnapshot.docs
      .map((snapshot) => snapshot.data())
      .filter((relationship) => relationship?.active === true)
      .map((relationship) => {
        const peerUid = relationship.participants?.find((participant) => participant !== uid);
        const publicMemberId = String(relationship.publicMembers?.[peerUid] || "");
        return typeof peerUid === "string"
          && peerUid
          && PUBLIC_ID_PATTERN.test(publicMemberId)
          ? { relationship, peerUid, publicMemberId }
          : null;
      })
      .filter(Boolean);
    const peerUids = [...new Set([
      ...bookmarkCandidates.map((candidate) => candidate.hostUid),
      ...relationshipCandidates.map((candidate) => candidate.peerUid),
      ...(sessionPeerUid ? [sessionPeerUid] : []),
    ])];
    const pairSnapshots = peerUids.length
      ? await firestore.getAll(...peerUids.map((peerUid) => blockPairRef(uid, peerUid)))
      : [];
    const pairSnapshotsByPeer = new Map(
      peerUids.map((peerUid, index) => [peerUid, pairSnapshots[index]]),
    );
    const peerIsSafe = (peerUid) => {
      const pairSnapshot = pairSnapshotsByPeer.get(peerUid);
      return pairSnapshot
        ? blockPairSnapshotIsSafe(pairSnapshot, uid, peerUid)
        : false;
    };
    if (storedSession && sessionPeerUid && peerIsSafe(sessionPeerUid)) {
      session = publicSessionProjection(uid, storedSession);
      if (session && ["connecting", "active"].includes(storedSession.status)) {
        await refreshActiveHeartbeatIfMatches(uid, active.sessionId, now);
      }
    } else if (storedSession && sessionPeerUid) {
      try {
        await endSessionInternal(uid, active.sessionId, "safe_exit");
      } catch {
        // The block remains authoritative even if concurrent cleanup already ended the seat.
      }
    }
    const bookmarks = bookmarkCandidates
      .filter((candidate) => peerIsSafe(candidate.hostUid))
      .map((candidate) => candidate.bookmark);
    bookmarks.sort((first, second) => second.updatedAt - first.updatedAt);
    const blocks = blockSnapshot.docs
      .map((snapshot) => {
        const value = snapshot.data();
        return PUBLIC_ID_PATTERN.test(String(value?.publicMemberId || ""))
          ? {
            publicMemberId: value.publicMemberId,
            name: boundedLine(value.displayName, CARD_LIMITS.name),
          }
          : null;
      })
      .filter(Boolean);
    const relationships = relationshipCandidates
      .filter((candidate) => peerIsSafe(candidate.peerUid))
      .map((candidate) => {
        return {
          publicMemberId: candidate.publicMemberId,
          mutualAt: Math.max(0, Number(candidate.relationship.mutualAt || 0)),
        };
      })
      .sort((first, second) => second.mutualAt - first.mutualAt);
    return {
      ok: true,
      identity,
      space: savedSnapshot.exists ? publicSpaceState(savedSnapshot.data()) : null,
      open,
      requests,
      pending,
      session,
      bookmarks,
      relationships,
      blocks,
      updatedAt: now,
    };
  }

  async function cleanupExpiredFirestoreCollection(collectionName, now) {
    let removed = 0;
    for (let page = 0; page < 5; page += 1) {
      const snapshot = await firestore.collection(collectionName)
        .where("expireAt", "<=", Timestamp.fromMillis(now))
        .limit(100)
        .get();
      if (snapshot.empty) break;
      const batch = firestore.batch();
      for (const document of snapshot.docs) batch.delete(document.ref);
      await batch.commit();
      removed += snapshot.size;
      if (snapshot.size < 100) break;
    }
    return removed;
  }

  async function removeRoomOwnerIfMatches(roomId, hostUid, publicRoomId) {
    await removeRealtimeIfMatches(
      roomOwnerRef(roomId),
      (current) => (
        current.uid === hostUid
        && current.publicRoomId === publicRoomId
      ),
    );
  }

  async function restoreRoomCleanupClaim(roomId, cleanupToken) {
    await roomStateRef(roomId).transaction((current) => {
      if (current?.state !== "expiring"
          || current.cleanupToken !== cleanupToken) return current;
      const restored = {
        ...current,
        state: ["open", "closing", "active"].includes(current.cleanupFromState)
          ? current.cleanupFromState
          : "open",
      };
      delete restored.cleanupFromState;
      delete restored.cleanupToken;
      delete restored.cleanupAt;
      delete restored.cleanupExpiresAt;
      return restored;
    });
  }

  async function cleanupExpiredPublicRoom(room, now) {
    const publicRoomId = String(room?.publicRoomId || "");
    const roomId = String(room?.roomId || "");
    const hostUid = String(room?.hostUid || "");
    if (!PUBLIC_ID_PATTERN.test(publicRoomId)
        || !CHILD_ID_PATTERN.test(roomId)
        || !hostUid) return false;
    const removePublicRoom = () => removeRealtimeIfMatches(
      publicRoomRef(publicRoomId),
      (current) => (
        current.roomId === roomId
        && current.hostUid === hostUid
        && Number(current.expiresAt || 0) <= now
      ),
    );
    const stateSnapshot = await roomStateRef(roomId).get();
    const observedState = stateSnapshot.val();
    const observedSessionId = CHILD_ID_PATTERN.test(
      String(observedState?.session?.sessionId || ""),
    )
      ? observedState.session.sessionId
      : "";
    if (observedState?.state === "active" && observedSessionId) {
      const canonicalSession = (await sessionRef(observedSessionId).get()).val();
      if (canonicalSession?.sessionId === observedSessionId
          && canonicalSession.roomId === roomId
          && ["connecting", "active"].includes(canonicalSession.status)
          && Number(canonicalSession.expiresAt || 0) > now) {
        return removePublicRoom();
      }
    }
    const cleanupToken = randomPublicId(randomBytes);
    const claimResult = await roomStateRef(roomId).transaction((current) => (
      nextExpiredRoomCleanupClaim(current, {
        roomId,
        publicRoomId,
        hostUid,
        cleanupToken,
        now,
      }) ?? current
    ));
    const claimedRoom = committedTransactionValue(
      claimResult,
      (value) => (
        value?.state === "expiring"
        && value.roomId === roomId
        && value.publicRoomId === publicRoomId
        && value.hostUid === hostUid
        && value.cleanupToken === cleanupToken
      ),
    );
    if (!claimedRoom) {
      if (claimResult?.snapshot?.exists()) return false;
      const publicRemoved = await removePublicRoom();
      if (!publicRemoved) return false;
      await Promise.all([
        removeRoomOwnerIfMatches(roomId, hostUid, publicRoomId),
        realtime.ref(`freeTables/requests/${roomId}`).remove(),
        removeRealtimeIfMatches(
          hostActiveRef(hostUid),
          (current) => (
            ["open", "closing"].includes(current.state)
            && current.roomId === roomId
            && current.publicRoomId === publicRoomId
          ),
        ),
        removeRealtimeIfMatches(
          engagementRef(hostUid),
          (current) => (
            ["host_open", "host_closing"].includes(current.state)
            && current.roomId === roomId
            && current.publicRoomId === publicRoomId
          ),
        ),
      ]);
      return true;
    }
    const publicRemoved = await removePublicRoom();
    if (!publicRemoved) {
      await restoreRoomCleanupClaim(roomId, cleanupToken);
      return false;
    }
    const incompleteSession = objectValue(claimedRoom.session);
    const incompleteSessionId = CHILD_ID_PATTERN.test(
      String(incompleteSession.sessionId || ""),
    )
      ? incompleteSession.sessionId
      : "";
    if (incompleteSessionId) {
      const canonicalSession = (await sessionRef(incompleteSessionId).get()).val();
      if (canonicalSession?.sessionId === incompleteSessionId
          && canonicalSession.roomId === roomId
          && ["connecting", "active"].includes(canonicalSession.status)
          && Number(canonicalSession.expiresAt || 0) > now) {
        await restoreRoomCleanupClaim(roomId, cleanupToken);
        return true;
      }
    }
    for (const request of Object.values(objectValue(claimedRoom.requests))) {
      if (request?.visitorUid && request?.requestId) {
        await Promise.all([
          clearPendingIfMatches(request.visitorUid, request.requestId),
          clearEngagementIfMatches(
            request.visitorUid,
            "requestId",
            request.requestId,
          ),
        ]);
      }
    }
    let incompleteSessionRemoved = false;
    if (incompleteSessionId) {
      incompleteSessionRemoved = await removeRealtimeIfMatches(
        sessionRef(incompleteSessionId),
        (current) => (
          current.sessionId === incompleteSessionId
          && current.roomId === roomId
          && Number(current.expiresAt || 0) <= now
        ),
      );
    }
    await Promise.all([
      removeRealtimeIfMatches(
        roomStateRef(roomId),
        (current) => (
          current.state === "expiring"
          && current.cleanupToken === cleanupToken
          && current.roomId === roomId
        ),
      ),
      removeRoomOwnerIfMatches(roomId, hostUid, publicRoomId),
      realtime.ref(`freeTables/requests/${roomId}`).remove(),
      incompleteSessionId
        ? clearActiveIfMatches(hostUid, incompleteSessionId)
        : removeRealtimeIfMatches(
          hostActiveRef(hostUid),
          (current) => (
            ["open", "closing"].includes(current.state)
            && current.roomId === roomId
            && current.publicRoomId === publicRoomId
          ),
        ),
      incompleteSessionId && incompleteSession.visitorUid
        ? clearActiveIfMatches(incompleteSession.visitorUid, incompleteSessionId)
        : Promise.resolve(),
      incompleteSessionId
        ? clearHostActiveIfMatches(hostUid, incompleteSessionId)
        : Promise.resolve(),
      incompleteSessionId
        ? clearEngagementIfMatches(hostUid, "sessionId", incompleteSessionId)
        : removeRealtimeIfMatches(
          engagementRef(hostUid),
          (current) => (
            ["host_open", "host_closing"].includes(current.state)
            && current.roomId === roomId
            && current.publicRoomId === publicRoomId
          ),
        ),
      incompleteSessionId && incompleteSession.visitorUid
        ? clearEngagementIfMatches(
          incompleteSession.visitorUid,
          "sessionId",
          incompleteSessionId,
        )
        : Promise.resolve(),
    ]);
    if (incompleteSessionRemoved) {
      await freeTablesRoot().update({
        [`presence/${incompleteSessionId}`]: null,
        [`signals/${incompleteSessionId}`]: null,
        [`chat/${incompleteSessionId}`]: null,
      });
    }
    return true;
  }

  async function cleanupExpired(nowValue = currentTime()) {
    const now = Number(nowValue);
    const [
      roomsSnapshot,
      pendingSnapshot,
      sessionSnapshot,
      engagementSnapshot,
      presenceSnapshot,
    ] = await Promise.all([
      publicRoomsRef().get(),
      realtime.ref("freeTables/visitorPending").get(),
      sessionsRef().get(),
      engagementsRef().get(),
      realtime.ref("freeTables/presence").get(),
    ]);
    let rooms = 0;
    let requests = 0;
    let sessions = 0;
    let engagements = 0;
    let disconnectProbes = 0;
    let disconnectedSessions = 0;
    for (const room of Object.values(objectValue(roomsSnapshot.val()))) {
      if (Number(room?.expiresAt || 0) > now
          || !PUBLIC_ID_PATTERN.test(String(room?.publicRoomId || ""))) continue;
      if (await cleanupExpiredPublicRoom(room, now)) rooms += 1;
    }
    for (const [visitorUid, pending] of Object.entries(objectValue(pendingSnapshot.val()))) {
      if (Number(pending?.expiresAt || 0) > now) continue;
      const pendingRemoved = await removeRealtimeIfMatches(
        visitorPendingRef(visitorUid),
        (current) => (
          current.requestId === pending.requestId
          && Number(current.expiresAt || 0) <= now
        ),
      );
      if (!pendingRemoved) continue;
      requests += 1;
      await clearEngagementIfMatches(visitorUid, "requestId", pending.requestId);
      if (pending.roomId && pending.requestId) {
        await requestRef(pending.roomId, pending.requestId).remove();
        await roomStateRef(pending.roomId).transaction((current) => {
          if (!current?.requests?.[pending.requestId]) return current;
          const nextRequests = { ...objectValue(current.requests) };
          delete nextRequests[pending.requestId];
          return { ...current, requests: nextRequests };
        });
      }
    }
    const observedPresence = objectValue(presenceSnapshot.val());
    for (const [sessionId, session] of Object.entries(objectValue(sessionSnapshot.val()))) {
      if (session?.status === "ended"
          && Number(session.cleanupFinalizedAt || 0) <= 0
          && Number(session.expiresAt || 0) > now) {
        await finalizeEndedSessionResources(session);
        continue;
      }
      if (session?.status !== "active"
          || Number(session.expiresAt || 0) <= now) continue;
      const sessionPresence = objectValue(observedPresence[sessionId]);
      const presenceMissing = !sessionPresenceIsFresh(
        sessionPresence,
        session.hostUid,
        now,
      ) || !sessionPresenceIsFresh(
        sessionPresence,
        session.visitorUid,
        now,
      );
      if (!presenceMissing && !sessionPresence._disconnect) continue;
      const reconciliation = await reconcileDisconnectedSession(
        sessionId,
        session,
        now,
      );
      if (reconciliation.type === "probed") disconnectProbes += 1;
      if (reconciliation.type === "ended") disconnectedSessions += 1;
    }
    for (const [sessionId, session] of Object.entries(objectValue(sessionSnapshot.val()))) {
      if (Number(session?.expiresAt || 0) > now) continue;
      const hostUid = session.hostUid;
      const visitorUid = session.visitorUid;
      const sessionRemoved = await removeRealtimeIfMatches(
        sessionRef(sessionId),
        (current) => (
          Number(current.expiresAt || 0) === Number(session.expiresAt || 0)
          && Number(current.expiresAt || 0) <= now
        ),
      );
      if (!sessionRemoved) continue;
      sessions += 1;
      await Promise.all([
        hostUid ? clearActiveIfMatches(hostUid, sessionId) : Promise.resolve(),
        visitorUid ? clearActiveIfMatches(visitorUid, sessionId) : Promise.resolve(),
        hostUid ? clearHostActiveIfMatches(hostUid, sessionId) : Promise.resolve(),
        hostUid
          ? clearEngagementIfMatches(hostUid, "sessionId", sessionId)
          : Promise.resolve(),
        visitorUid
          ? clearEngagementIfMatches(visitorUid, "sessionId", sessionId)
          : Promise.resolve(),
      ]);
      await freeTablesRoot().update({
        [`presence/${sessionId}`]: null,
        [`signals/${sessionId}`]: null,
        [`chat/${sessionId}`]: null,
      });
      if (session.roomId) {
        const roomRemoved = await removeRealtimeIfMatches(
          roomStateRef(session.roomId),
          (current) => (
            current.roomId === session.roomId
            && current.session?.sessionId === sessionId
          ),
        );
        if (roomRemoved && hostUid && session.publicRoomId) {
          await removeRoomOwnerIfMatches(
            session.roomId,
            hostUid,
            session.publicRoomId,
          );
        }
      }
    }
    for (const [uid, engagement] of Object.entries(objectValue(engagementSnapshot.val()))) {
      if (Number(engagement?.expiresAt || 0) > now) continue;
      const engagementRemoved = await removeRealtimeIfMatches(
        engagementRef(uid),
        (current) => (
          Number(current.expiresAt || 0) === Number(engagement.expiresAt || 0)
          && Number(current.expiresAt || 0) <= now
        ),
      );
      if (engagementRemoved) engagements += 1;
    }
    const [reports, visitLedgers] = await Promise.all([
      cleanupExpiredFirestoreCollection("freeTableReports", now),
      cleanupExpiredFirestoreCollection("freeTableVisitLedger", now),
    ]);
    return {
      rooms,
      requests,
      sessions,
      engagements,
      disconnectProbes,
      disconnectedSessions,
      reports,
      visitLedgers,
      cleanedAt: now,
    };
  }

  async function performAction(uidValue, data) {
    const uid = requireUid(uidValue);
    const action = typeof data?.action === "string" ? data.action.trim() : "";
    if (!FREE_TABLE_ACTIONS.includes(action)) {
      throw httpsError("invalid-argument", "未対応の自由卓操作です。");
    }
    if (action === "save_space") return saveSpace(uid, data);
    if (action === "open") return openSpace(uid, data);
    if (action === "list") return listSpaces(uid, data);
    if (action === "request") return requestEntry(uid, data);
    if (action === "cancel_request") return cancelEntryRequest(uid, data);
    if (action === "respond") return respondToRequest(uid, data);
    if (action === "arrive") return arriveAtSession(uid, data);
    if (action === "end") return endSession(uid, data);
    if (action === "bookmark") return setBookmark(uid, data);
    if (action === "relationship") return setRelationship(uid, data);
    if (action === "block") return setBlock(uid, data);
    if (action === "unblock") return unsetBlock(uid, data);
    if (action === "report") return submitReport(uid, data);
    if (action === "get_my_state") return getMyState(uid, data);
    throw httpsError("invalid-argument", "未対応の自由卓操作です。");
  }

  return Object.freeze({
    cleanupExpired,
    performAction,
  });
}

module.exports = Object.freeze({
  FREE_TABLE_ACTIONS,
  FREE_TABLE_BLOCK_LIMIT,
  FREE_TABLE_BOOKMARK_LIMIT,
  FREE_TABLE_CONNECTING_TTL_MS,
  FREE_TABLE_DISCONNECT_GRACE_MS,
  FREE_TABLE_DURATIONS,
  FREE_TABLE_ENDED_RETENTION_MS,
  FREE_TABLE_GROWTH_MILESTONES,
  FREE_TABLE_LIST_LIMIT,
  FREE_TABLE_LIST_SCAN_LIMIT,
  FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS,
  FREE_TABLE_PROTOCOL_VERSION,
  FREE_TABLE_PUBLIC_ROOM_TTL_MS,
  FREE_TABLE_RECONNECT_MERGE_MS,
  FREE_TABLE_REPORT_MESSAGE_LIMIT,
  FREE_TABLE_REPORT_CHAT_SCAN_LIMIT,
  FREE_TABLE_REQUEST_LIMIT,
  FREE_TABLE_REQUEST_TTL_MS,
  FREE_TABLE_SESSION_TTL_MS,
  createFreeTableService,
  acceptedSessionValue,
  blockedInEitherDirection,
  fairShelfCursor,
  fairShelfKey,
  growthStage,
  internalPairId,
  internalReportId,
  nextAdmissionState,
  nextArrivalState,
  nextExpiredRoomCleanupClaim,
  nextEngagementClaim,
  nextFinalHostAdmissionClaim,
  nextHostAdmissionClaim,
  nextHostOpenClaim,
  nextRoomRequests,
  nextVisitorAdmissionClaim,
  nextVisitorPendingClaim,
  normalizeCard,
  normalizeDepartureLine,
  normalizeEndKind,
  normalizeGrowth,
  normalizeRoomSettings,
  ownerGrowthProjection,
  pairGrowthDecision,
  publicRequestProjection,
  publicRoomProjection,
  publicSessionProjection,
  randomPublicId,
  restoredAcceptedHostOpenClaim,
  restoredHostOpenClaim,
  restoredVisitorPendingClaim,
  selectReportEvidence,
  validateCard,
  validateRoomSettings,
});
