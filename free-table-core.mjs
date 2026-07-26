export const FREE_TABLE_PROTOCOL_VERSION = 1;
export const FREE_TABLE_MAX_PARTICIPANTS = 2;
export const FREE_TABLE_DEPARTURE_GREETING = "いってきます";
export const FREE_TABLE_SENDOFF_GREETING = "いってらっしゃい";
export const FREE_TABLE_RECONNECT_MERGE_MS = 30 * 60 * 1000;
export const FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const FREE_TABLE_GROWTH_MILESTONES = Object.freeze([1, 3, 7, 15, 30]);

export const FREE_TABLE_ROLES = Object.freeze({
  HOST: "host",
  VISITOR: "visitor",
  SYSTEM: "system",
});

export const FREE_TABLE_STATES = Object.freeze({
  CLOSED: "closed",
  OPEN: "open",
  ADMISSION_PENDING: "admission_pending",
  CONNECTING: "connecting",
  ACTIVE: "active",
  RESTING: "resting",
});

export const FREE_TABLE_ACTIONS = Object.freeze({
  OPEN_ROOM: "open_room",
  REQUEST_ENTRY: "request_entry",
  CANCEL_REQUEST: "cancel_request",
  REJECT_REQUEST: "reject_request",
  ACCEPT_REQUEST: "accept_request",
  CONNECTION_READY: "connection_ready",
  CONNECTION_FAILED: "connection_failed",
  DEPART: "depart",
  END_NORMALLY: "end_normally",
  SAFE_EXIT: "safe_exit",
  REOPEN_ROOM: "reopen_room",
  CLOSE_ROOM: "close_room",
});

export const FREE_TABLE_END_KINDS = Object.freeze({
  DEPARTURE: "departure",
  WRAP_UP: "wrap_up",
  SAFE_EXIT: "safe_exit",
  DISCONNECTED: "disconnected",
});

export const FREE_TABLE_ROLEPLAY_LEVELS = Object.freeze([
  "none",
  "light",
  "full",
]);

export const FREE_TABLE_DURATIONS = Object.freeze([
  "5m",
  "15m",
  "30m",
  "leisurely",
]);

export const FREE_TABLE_MEDIA_KEYS = Object.freeze([
  "text",
  "image",
  "audio",
  "video",
]);

export const FREE_TABLE_ROOM_LIMITS = Object.freeze({
  name: 24,
  description: 80,
  topic: 60,
  introduction: 160,
  journeyCue: 60,
  avoid: 80,
  welcome: 80,
  themeId: 48,
});

export const FREE_TABLE_VISITOR_CARD_LIMITS = Object.freeze({
  name: 24,
  activityTag: 24,
  message: 40,
});

export const FREE_TABLE_ENDING_LIMITS = Object.freeze({
  departureLine: 80,
  sendoffLine: 80,
  wrapUpLine: 80,
});

export const FREE_TABLE_ENDING_DEFAULTS = Object.freeze({
  [FREE_TABLE_END_KINDS.DEPARTURE]: FREE_TABLE_DEPARTURE_GREETING,
  [FREE_TABLE_END_KINDS.WRAP_UP]: "今日はここまで",
  [FREE_TABLE_END_KINDS.SAFE_EXIT]: "",
  [FREE_TABLE_END_KINDS.DISCONNECTED]: "",
});

const FREE_TABLE_TRANSITIONS = Object.freeze([
  Object.freeze({
    from: FREE_TABLE_STATES.CLOSED,
    action: FREE_TABLE_ACTIONS.OPEN_ROOM,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.OPEN,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.OPEN,
    action: FREE_TABLE_ACTIONS.REQUEST_ENTRY,
    role: FREE_TABLE_ROLES.VISITOR,
    to: FREE_TABLE_STATES.ADMISSION_PENDING,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.OPEN,
    action: FREE_TABLE_ACTIONS.CLOSE_ROOM,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.CLOSED,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ADMISSION_PENDING,
    action: FREE_TABLE_ACTIONS.CANCEL_REQUEST,
    role: FREE_TABLE_ROLES.VISITOR,
    to: FREE_TABLE_STATES.OPEN,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ADMISSION_PENDING,
    action: FREE_TABLE_ACTIONS.REJECT_REQUEST,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.OPEN,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ADMISSION_PENDING,
    action: FREE_TABLE_ACTIONS.ACCEPT_REQUEST,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.CONNECTING,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ADMISSION_PENDING,
    action: FREE_TABLE_ACTIONS.CLOSE_ROOM,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.CLOSED,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.CONNECTING,
    action: FREE_TABLE_ACTIONS.CONNECTION_READY,
    role: FREE_TABLE_ROLES.SYSTEM,
    to: FREE_TABLE_STATES.ACTIVE,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.CONNECTING,
    action: FREE_TABLE_ACTIONS.CONNECTION_FAILED,
    role: FREE_TABLE_ROLES.SYSTEM,
    to: FREE_TABLE_STATES.OPEN,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.CONNECTING,
    action: FREE_TABLE_ACTIONS.CANCEL_REQUEST,
    role: FREE_TABLE_ROLES.VISITOR,
    to: FREE_TABLE_STATES.OPEN,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.CONNECTING,
    action: FREE_TABLE_ACTIONS.SAFE_EXIT,
    role: FREE_TABLE_ROLES.VISITOR,
    to: FREE_TABLE_STATES.RESTING,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.CONNECTING,
    action: FREE_TABLE_ACTIONS.SAFE_EXIT,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.CLOSED,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.CONNECTING,
    action: FREE_TABLE_ACTIONS.CLOSE_ROOM,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.CLOSED,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ACTIVE,
    action: FREE_TABLE_ACTIONS.DEPART,
    role: FREE_TABLE_ROLES.VISITOR,
    to: FREE_TABLE_STATES.RESTING,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ACTIVE,
    action: FREE_TABLE_ACTIONS.END_NORMALLY,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.RESTING,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ACTIVE,
    action: FREE_TABLE_ACTIONS.END_NORMALLY,
    role: FREE_TABLE_ROLES.VISITOR,
    to: FREE_TABLE_STATES.RESTING,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ACTIVE,
    action: FREE_TABLE_ACTIONS.SAFE_EXIT,
    role: FREE_TABLE_ROLES.VISITOR,
    to: FREE_TABLE_STATES.RESTING,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ACTIVE,
    action: FREE_TABLE_ACTIONS.SAFE_EXIT,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.CLOSED,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.ACTIVE,
    action: FREE_TABLE_ACTIONS.CLOSE_ROOM,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.CLOSED,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.RESTING,
    action: FREE_TABLE_ACTIONS.REOPEN_ROOM,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.OPEN,
  }),
  Object.freeze({
    from: FREE_TABLE_STATES.RESTING,
    action: FREE_TABLE_ACTIONS.CLOSE_ROOM,
    role: FREE_TABLE_ROLES.HOST,
    to: FREE_TABLE_STATES.CLOSED,
  }),
]);

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function codePointLength(value) {
  return Array.from(String(value ?? "")).length;
}

function truncateCodePoints(value, maximum) {
  return Array.from(String(value ?? "")).slice(0, Math.max(0, maximum)).join("");
}

function normalizedSingleLine(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?|\n/gu, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeBoundedLine(value, maximum) {
  return truncateCodePoints(normalizedSingleLine(value), maximum);
}

function normalizeChoice(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

function normalizeMedia(value) {
  const source = objectValue(value);
  return {
    text: true,
    image: source.image === true,
    audio: source.audio === true,
    video: source.video === true,
  };
}

function validateTextField(errors, source, field, maximum, { required = false } = {}) {
  const line = normalizedSingleLine(source[field]);
  if (required && !line) errors.push(`${field}_required`);
  if (codePointLength(line) > maximum) errors.push(`${field}_too_long`);
}

function validateChoiceField(errors, source, field, choices) {
  if (source[field] !== undefined && !choices.includes(source[field])) {
    errors.push(`${field}_invalid`);
  }
}

function validateMedia(errors, value) {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    errors.push("media_invalid");
    return;
  }
  const source = objectValue(value);
  if (source.text === false) errors.push("text_media_required");
  for (const key of FREE_TABLE_MEDIA_KEYS) {
    if (source[key] !== undefined && typeof source[key] !== "boolean") {
      errors.push(`${key}_media_invalid`);
    }
  }
}

export function normalizeFreeTableRoomSettings(value) {
  const source = objectValue(value);
  return {
    name: normalizeBoundedLine(source.name, FREE_TABLE_ROOM_LIMITS.name),
    description: normalizeBoundedLine(source.description, FREE_TABLE_ROOM_LIMITS.description),
    topic: normalizeBoundedLine(source.topic, FREE_TABLE_ROOM_LIMITS.topic),
    introduction: normalizeBoundedLine(source.introduction, FREE_TABLE_ROOM_LIMITS.introduction),
    journeyCue: normalizeBoundedLine(source.journeyCue, FREE_TABLE_ROOM_LIMITS.journeyCue),
    roleplayLevel: normalizeChoice(source.roleplayLevel, FREE_TABLE_ROLEPLAY_LEVELS, "light"),
    duration: normalizeChoice(source.duration, FREE_TABLE_DURATIONS, "15m"),
    media: normalizeMedia(source.media),
    avoid: normalizeBoundedLine(source.avoid, FREE_TABLE_ROOM_LIMITS.avoid),
    welcome: normalizeBoundedLine(
      source.welcome || "おかえり",
      FREE_TABLE_ROOM_LIMITS.welcome,
    ),
    themeId: normalizeBoundedLine(source.themeId, FREE_TABLE_ROOM_LIMITS.themeId)
      .replace(/[^a-z0-9_-]/giu, ""),
  };
}

export function validateFreeTableRoomSettings(value) {
  const source = objectValue(value);
  const errors = [];
  validateTextField(errors, source, "name", FREE_TABLE_ROOM_LIMITS.name, {
    required: true,
  });
  validateTextField(errors, source, "description", FREE_TABLE_ROOM_LIMITS.description);
  validateTextField(errors, source, "topic", FREE_TABLE_ROOM_LIMITS.topic, {
    required: true,
  });
  validateTextField(errors, source, "introduction", FREE_TABLE_ROOM_LIMITS.introduction);
  validateTextField(errors, source, "journeyCue", FREE_TABLE_ROOM_LIMITS.journeyCue);
  validateTextField(errors, source, "avoid", FREE_TABLE_ROOM_LIMITS.avoid);
  validateTextField(errors, source, "welcome", FREE_TABLE_ROOM_LIMITS.welcome);
  validateTextField(errors, source, "themeId", FREE_TABLE_ROOM_LIMITS.themeId);
  if (source.themeId !== undefined
    && normalizedSingleLine(source.themeId)
    && !/^[a-z0-9_-]+$/iu.test(normalizedSingleLine(source.themeId))) {
    errors.push("themeId_invalid");
  }
  validateChoiceField(errors, source, "roleplayLevel", FREE_TABLE_ROLEPLAY_LEVELS);
  validateChoiceField(errors, source, "duration", FREE_TABLE_DURATIONS);
  validateMedia(errors, source.media);
  return {
    valid: errors.length === 0,
    errors,
    value: normalizeFreeTableRoomSettings(source),
  };
}

export function normalizeFreeTableVisitorCard(value) {
  const source = objectValue(value);
  return {
    name: normalizeBoundedLine(
      source.name,
      FREE_TABLE_VISITOR_CARD_LIMITS.name,
    ),
    activityTag: normalizeBoundedLine(
      source.activityTag,
      FREE_TABLE_VISITOR_CARD_LIMITS.activityTag,
    ),
    message: normalizeBoundedLine(source.message, FREE_TABLE_VISITOR_CARD_LIMITS.message),
    roleplayLevel: normalizeChoice(source.roleplayLevel, FREE_TABLE_ROLEPLAY_LEVELS, "light"),
    media: normalizeMedia(source.media),
  };
}

export function validateFreeTableVisitorCard(value) {
  const source = objectValue(value);
  const errors = [];
  validateTextField(
    errors,
    source,
    "name",
    FREE_TABLE_VISITOR_CARD_LIMITS.name,
    { required: true },
  );
  validateTextField(
    errors,
    source,
    "activityTag",
    FREE_TABLE_VISITOR_CARD_LIMITS.activityTag,
  );
  validateTextField(
    errors,
    source,
    "message",
    FREE_TABLE_VISITOR_CARD_LIMITS.message,
    { required: true },
  );
  validateChoiceField(errors, source, "roleplayLevel", FREE_TABLE_ROLEPLAY_LEVELS);
  validateMedia(errors, source.media);
  return {
    valid: errors.length === 0,
    errors,
    value: normalizeFreeTableVisitorCard(source),
  };
}

export function normalizeFreeTableEndKind(value) {
  return Object.values(FREE_TABLE_END_KINDS).includes(value)
    ? value
    : FREE_TABLE_END_KINDS.WRAP_UP;
}

export function normalizeFreeTableDepartureLine(value) {
  const source = normalizedSingleLine(value);
  const withoutGreeting = source
    .replace(new RegExp(`${FREE_TABLE_DEPARTURE_GREETING}[。.!！?？]*$`, "u"), "")
    .trim()
    .replace(/[。.!！?？]+$/u, "");
  if (!withoutGreeting) return FREE_TABLE_DEPARTURE_GREETING;
  const separator = "。";
  const prefixMaximum = FREE_TABLE_ENDING_LIMITS.departureLine
    - codePointLength(separator)
    - codePointLength(FREE_TABLE_DEPARTURE_GREETING);
  const prefix = truncateCodePoints(withoutGreeting, prefixMaximum)
    .replace(/[。.!！?？]+$/u, "");
  return prefix
    ? `${prefix}${separator}${FREE_TABLE_DEPARTURE_GREETING}`
    : FREE_TABLE_DEPARTURE_GREETING;
}

export function isCanonicalFreeTableDepartureLine(value) {
  if (typeof value !== "string") return false;
  const normalized = normalizedSingleLine(value);
  return normalized === normalizeFreeTableDepartureLine(normalized)
    && normalized.endsWith(FREE_TABLE_DEPARTURE_GREETING)
    && codePointLength(normalized) <= FREE_TABLE_ENDING_LIMITS.departureLine;
}

export function normalizeFreeTableSendoffLine(value) {
  return normalizeBoundedLine(
    value || FREE_TABLE_SENDOFF_GREETING,
    FREE_TABLE_ENDING_LIMITS.sendoffLine,
  );
}

export function normalizeFreeTableEnding(value) {
  const source = objectValue(value);
  const kind = normalizeFreeTableEndKind(source.kind);
  if (kind === FREE_TABLE_END_KINDS.DEPARTURE) {
    return {
      kind,
      line: normalizeFreeTableDepartureLine(source.line),
      sendoffLine: normalizeFreeTableSendoffLine(source.sendoffLine),
    };
  }
  return {
    kind,
    line: normalizeBoundedLine(
      source.line || FREE_TABLE_ENDING_DEFAULTS[kind],
      FREE_TABLE_ENDING_LIMITS.wrapUpLine,
    ),
    sendoffLine: "",
  };
}

export function validateFreeTableEnding(value) {
  const source = objectValue(value);
  const errors = [];
  if (!Object.values(FREE_TABLE_END_KINDS).includes(source.kind)) {
    errors.push("kind_invalid");
  }
  const kind = normalizeFreeTableEndKind(source.kind);
  if (kind === FREE_TABLE_END_KINDS.DEPARTURE) {
    const unlimitedLine = normalizedSingleLine(source.line);
    const withoutGreeting = unlimitedLine
      .replace(new RegExp(`${FREE_TABLE_DEPARTURE_GREETING}[。.!！?？]*$`, "u"), "")
      .trim()
      .replace(/[。.!！?？]+$/u, "");
    const completeLength = codePointLength(withoutGreeting)
      + (withoutGreeting ? 1 : 0)
      + codePointLength(FREE_TABLE_DEPARTURE_GREETING);
    if (completeLength > FREE_TABLE_ENDING_LIMITS.departureLine) {
      errors.push("line_too_long");
    }
    if (codePointLength(normalizedSingleLine(source.sendoffLine))
      > FREE_TABLE_ENDING_LIMITS.sendoffLine) {
      errors.push("sendoffLine_too_long");
    }
  } else if (codePointLength(normalizedSingleLine(source.line))
    > FREE_TABLE_ENDING_LIMITS.wrapUpLine) {
    errors.push("line_too_long");
  }
  return {
    valid: errors.length === 0,
    errors,
    value: normalizeFreeTableEnding(source),
  };
}

export function isFreeTableParticipantPair(value) {
  const source = objectValue(value);
  return typeof source.hostUid === "string"
    && source.hostUid.length > 0
    && typeof source.visitorUid === "string"
    && source.visitorUid.length > 0
    && source.hostUid !== source.visitorUid;
}

export function nextFreeTableState(state, action, role) {
  return FREE_TABLE_TRANSITIONS.find((transition) => (
    transition.from === state
      && transition.action === action
      && transition.role === role
  ))?.to || "";
}

export function canApplyFreeTableAction(state, action, role) {
  return Boolean(nextFreeTableState(state, action, role));
}

export function isFreeTableStateTransitionAllowed(from, to) {
  return FREE_TABLE_TRANSITIONS.some((transition) => (
    transition.from === from && transition.to === to
  ));
}

export function isFreeTableSeatEstablished(value) {
  const source = objectValue(value);
  const arrivals = objectValue(source.arrivals);
  return isFreeTableParticipantPair(source)
    && source.admissionAccepted === true
    && source.p2pConnected === true
    && arrivals.host === true
    && arrivals.visitor === true;
}

function finiteTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function nonnegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function shouldMergeFreeTableReconnect(previousSeat, currentSeat) {
  const previous = objectValue(previousSeat);
  const current = objectValue(currentSeat);
  if (!isFreeTableParticipantPair(previous)
    || !isFreeTableParticipantPair(current)
    || previous.hostUid !== current.hostUid
    || previous.visitorUid !== current.visitorUid) {
    return false;
  }
  const previousEndedAt = finiteTimestamp(previous.endedAt);
  const currentStartedAt = finiteTimestamp(current.startedAt ?? current.establishedAt);
  if (previousEndedAt === null || currentStartedAt === null) return false;
  const gap = currentStartedAt - previousEndedAt;
  return gap >= 0 && gap <= FREE_TABLE_RECONNECT_MERGE_MS;
}

export function isFreeTablePairGrowthEligible({
  establishedAt,
  lastPairGrowthAt,
} = {}) {
  const current = finiteTimestamp(establishedAt);
  if (current === null) return false;
  if (lastPairGrowthAt === undefined || lastPairGrowthAt === null || lastPairGrowthAt === "") {
    return true;
  }
  const previous = finiteTimestamp(lastPairGrowthAt);
  if (previous === null) return false;
  return current - previous >= FREE_TABLE_PAIR_GROWTH_COOLDOWN_MS;
}

export function getFreeTableGrowthMilestone(seatCount) {
  const count = nonnegativeInteger(seatCount);
  return [...FREE_TABLE_GROWTH_MILESTONES]
    .reverse()
    .find((milestone) => count >= milestone) || 0;
}

export function getNextFreeTableGrowthMilestone(seatCount) {
  const count = nonnegativeInteger(seatCount);
  return FREE_TABLE_GROWTH_MILESTONES.find((milestone) => milestone > count) ?? null;
}

export function getFreeTableMilestonesCrossed(previousSeatCount, nextSeatCount) {
  const previous = nonnegativeInteger(previousSeatCount);
  const next = nonnegativeInteger(nextSeatCount);
  if (next <= previous) return [];
  return FREE_TABLE_GROWTH_MILESTONES.filter((milestone) => (
    milestone > previous && milestone <= next
  ));
}

export function resolveFreeTableGrowth({
  seat,
  previousSeat = null,
  lastPairGrowthAt = null,
  currentSeatCount = 0,
} = {}) {
  const source = objectValue(seat);
  const previousCount = nonnegativeInteger(currentSeatCount);
  const established = isFreeTableSeatEstablished(source);
  const establishedAt = finiteTimestamp(source.establishedAt);
  const currentForMerge = {
    ...source,
    startedAt: source.startedAt ?? source.establishedAt,
  };
  const merged = established
    && establishedAt !== null
    && shouldMergeFreeTableReconnect(previousSeat, currentForMerge);
  const growthEligible = established
    && establishedAt !== null
    && !merged
    && isFreeTablePairGrowthEligible({
      establishedAt,
      lastPairGrowthAt,
    });
  const nextSeatCount = previousCount + (growthEligible ? 1 : 0);
  const reason = !established || establishedAt === null
    ? "not_established"
    : merged
      ? "reconnect_merge"
      : growthEligible
        ? "counted"
        : "pair_cooldown";
  return {
    established,
    merged,
    growthEligible,
    reason,
    previousSeatCount: previousCount,
    nextSeatCount,
    crossedMilestones: getFreeTableMilestonesCrossed(previousCount, nextSeatCount),
    currentMilestone: getFreeTableGrowthMilestone(nextSeatCount),
    nextMilestone: getNextFreeTableGrowthMilestone(nextSeatCount),
  };
}

function stableShelfHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    hash ^= codePoint;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fairnessValue(entry) {
  const fairness = objectValue(objectValue(entry).fairness);
  return {
    shownCount: nonnegativeInteger(fairness.shownCount),
    lastShownAt: finiteTimestamp(fairness.lastShownAt) ?? 0,
    openedAt: finiteTimestamp(objectValue(entry).openedAt) ?? 0,
  };
}

export function orderFreeTableShelf(entries, { rotationKey = "" } = {}) {
  const source = Array.isArray(entries)
    ? [...entries]
    : Object.values(objectValue(entries));
  return source
    .map((entry, index) => {
      const value = objectValue(entry);
      const fairness = fairnessValue(value);
      const identity = `${value.hostUid || ""}\u0000${value.roomId || ""}`;
      return {
        entry,
        index,
        ...fairness,
        tieBreak: stableShelfHash(`${rotationKey}\u0000${identity}`),
      };
    })
    .sort((first, second) => (
      first.shownCount - second.shownCount
      || first.lastShownAt - second.lastShownAt
      || first.openedAt - second.openedAt
      || first.tieBreak - second.tieBreak
      || first.index - second.index
    ))
    .map(({ entry }) => entry);
}
