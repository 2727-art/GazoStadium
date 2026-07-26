export const TEAM_CHALLENGE_PROTOCOL_VERSION = 2;
export const TEAM_CHALLENGE_VARIANT = "oshi_jouzu_duo";
export const TEAM_CHALLENGE_ROLES = Object.freeze({
  OSHI_JOUZU: "oshi_jouzu",
  CHALLENGER: "challenger",
});
export const TEAM_CHALLENGE_SIDES = Object.freeze({
  SOLO: "solo",
  DUO: "duo",
});
export const TEAM_CHALLENGE_FOCUSES = Object.freeze([
  "image",
  "audio",
  "video",
  "words",
  "overall",
]);
export const TEAM_CHALLENGE_REFERENCE_KINDS = Object.freeze(["image", "video"]);

const SCORE_MIN = 1;
const SCORE_MAX = 10;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

export function normalizeTeamChallengeRole(value) {
  return Object.values(TEAM_CHALLENGE_ROLES).includes(value) ? value : "";
}

export function normalizeTeamChallengeFocus(value, fallback = "overall") {
  return TEAM_CHALLENGE_FOCUSES.includes(value) ? value : fallback;
}

export function normalizeTeamChallengeWords(value, maximum = 100) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

export function normalizeReferenceKind(value) {
  return TEAM_CHALLENGE_REFERENCE_KINDS.includes(value) ? value : "";
}

export function isTeamChallengeQueueEntry(value, {
  now = Date.now(),
  freshnessMs = 45_000,
  activeUsers = {},
} = {}) {
  const entry = objectValue(value);
  const role = normalizeTeamChallengeRole(entry.role);
  const lastSeen = Number(entry.lastSeen);
  return entry.protocolVersion === TEAM_CHALLENGE_PROTOCOL_VERSION
    && entry.variant === TEAM_CHALLENGE_VARIANT
    && Boolean(role)
    && typeof entry.uid === "string"
    && entry.uid.length > 0
    && entry.state === "waiting"
    && Number.isFinite(lastSeen)
    && lastSeen >= now - freshnessMs
    && !objectValue(activeUsers)[entry.uid];
}

export function validTeamChallengeQueueEntries(queue, options = {}) {
  return Object.values(objectValue(queue))
    .filter((entry) => isTeamChallengeQueueEntry(entry, options))
    .sort((first, second) => (
      Number(first.joinedAt || 0) - Number(second.joinedAt || 0)
      || String(first.uid).localeCompare(String(second.uid))
    ));
}

// Cached pre-roleplay clients still import this technical queue-validity name.
export const eligibleTeamChallengeQueueEntries = validTeamChallengeQueueEntries;

export function selectTeamChallengeGroup(entries) {
  const source = Array.isArray(entries) ? entries : [];
  const solo = source.find((entry) => entry.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU);
  const challengers = source
    .filter((entry) => entry.role === TEAM_CHALLENGE_ROLES.CHALLENGER)
    .slice(0, 2);
  return solo && challengers.length === 2 ? [solo, ...challengers] : [];
}

export function sortedChallengePlayers(players) {
  return Object.values(objectValue(players))
    .filter((player) => player && typeof player.uid === "string")
    .sort((first, second) => (
      finiteInteger(first.slot, 99) - finiteInteger(second.slot, 99)
      || String(first.uid).localeCompare(String(second.uid))
    ));
}

export function teamChallengeMembersByRole(players) {
  const ordered = sortedChallengePlayers(players);
  return {
    solo: ordered.find((player) => player.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU) || null,
    challengers: ordered.filter((player) => player.role === TEAM_CHALLENGE_ROLES.CHALLENGER),
  };
}

function hasComponent(components, ownerUid, component) {
  const owner = objectValue(objectValue(components)[ownerUid]);
  if (component === "words") return normalizeTeamChallengeWords(owner.words).length > 0;
  return owner[component] === true;
}

function validOwner(value, challengerUids, components, component) {
  return value === "" || (
    challengerUids.includes(value)
    && hasComponent(components, value, component)
  );
}

function deterministicComponentOwner(component, challengerUids, choices, components) {
  const selected = challengerUids.map((uid) => String(objectValue(choices[uid])[`${component}OwnerUid`] || ""));
  if (selected.length === challengerUids.length
    && selected.every((value) => value === selected[0])
    && validOwner(selected[0], challengerUids, components, component)) {
    return { ownerUid: selected[0], agreed: true };
  }
  const ownerUid = challengerUids.find((uid) => hasComponent(components, uid, component)) || "";
  return { ownerUid, agreed: false };
}

export function resolveDuoPlan({
  challengers,
  choices,
  components,
} = {}) {
  const challengerUids = sortedChallengePlayers(
    Object.fromEntries((Array.isArray(challengers) ? challengers : []).map((player) => [player.uid, player])),
  ).map((player) => player.uid).slice(0, 2);
  if (challengerUids.length !== 2) {
    return {
      ready: false,
      agreed: false,
      audioOwnerUid: "",
      videoOwnerUid: "",
      wordsOwnerUid: "",
    };
  }
  const audio = deterministicComponentOwner("audio", challengerUids, objectValue(choices), objectValue(components));
  const video = deterministicComponentOwner("video", challengerUids, objectValue(choices), objectValue(components));
  const words = deterministicComponentOwner("words", challengerUids, objectValue(choices), objectValue(components));
  return {
    ready: true,
    agreed: audio.agreed && video.agreed && words.agreed,
    audioOwnerUid: audio.ownerUid,
    videoOwnerUid: video.ownerUid,
    wordsOwnerUid: words.ownerUid,
  };
}

export function isChallengeScore(value) {
  return Number.isInteger(Number(value))
    && Number(value) >= SCORE_MIN
    && Number(value) <= SCORE_MAX;
}

function requiredScore(scores, voterUid, targetUid) {
  const raw = objectValue(objectValue(scores)[voterUid]).values;
  const value = Number(objectValue(raw)[targetUid]);
  if (!isChallengeScore(value)) {
    throw new TypeError(`missing score: ${voterUid} -> ${targetUid}`);
  }
  return value;
}

export function resolveDuoChallengeScores({
  scores,
  soloUid,
  challengerUids,
} = {}) {
  const challengers = [...new Set((Array.isArray(challengerUids) ? challengerUids : []).map(String).filter(Boolean))];
  if (!soloUid || challengers.length !== 2 || challengers.includes(soloUid)) {
    throw new TypeError("invalid team challenge participants");
  }
  const soloVotes = challengers.map((uid) => requiredScore(scores, uid, soloUid));
  const duoVotes = challengers.map((uid) => requiredScore(scores, soloUid, uid));
  const soloScore = soloVotes.reduce((sum, value) => sum + value, 0) / soloVotes.length;
  const duoScore = duoVotes.reduce((sum, value) => sum + value, 0) / duoVotes.length;
  const winnerSide = soloScore === duoScore
    ? null
    : soloScore > duoScore ? TEAM_CHALLENGE_SIDES.SOLO : TEAM_CHALLENGE_SIDES.DUO;
  const outcomes = {
    [soloUid]: winnerSide === null ? "draw" : winnerSide === TEAM_CHALLENGE_SIDES.SOLO ? "win" : "loss",
  };
  challengers.forEach((uid) => {
    outcomes[uid] = winnerSide === null ? "draw" : winnerSide === TEAM_CHALLENGE_SIDES.DUO ? "win" : "loss";
  });
  return {
    soloScore,
    duoScore,
    soloVotes,
    duoVotes,
    winnerSide,
    outcomes,
  };
}

export function randomPresentationOrder(randomValues = null) {
  const values = randomValues || globalThis.crypto?.getRandomValues?.(new Uint8Array(1));
  const first = values && Number(values[0]) % 2 === 1
    ? TEAM_CHALLENGE_SIDES.DUO
    : TEAM_CHALLENGE_SIDES.SOLO;
  return first === TEAM_CHALLENGE_SIDES.SOLO
    ? [TEAM_CHALLENGE_SIDES.SOLO, TEAM_CHALLENGE_SIDES.DUO]
    : [TEAM_CHALLENGE_SIDES.DUO, TEAM_CHALLENGE_SIDES.SOLO];
}

export function normalizePresentationOrder(value) {
  return Array.isArray(value)
    && value.length === 2
    && new Set(value).size === 2
    && value.includes(TEAM_CHALLENGE_SIDES.SOLO)
    && value.includes(TEAM_CHALLENGE_SIDES.DUO)
    ? [...value]
    : [TEAM_CHALLENGE_SIDES.SOLO, TEAM_CHALLENGE_SIDES.DUO];
}

export function allMembersMarked(collection, memberUids) {
  const source = objectValue(collection);
  const members = [...new Set((Array.isArray(memberUids) ? memberUids : []).map(String).filter(Boolean))];
  return members.length > 0 && members.every((uid) => source[uid] === true);
}

export function teamTalkStatus(roomData, memberUids, now = Date.now(), durationMs = 10 * 60 * 1000) {
  const room = objectValue(roomData);
  const decisions = objectValue(room.talkDecisions);
  const ended = objectValue(room.talkEnded);
  const members = [...new Set((Array.isArray(memberUids) ? memberUids : []).map(String).filter(Boolean))];
  if (!members.length) return "unavailable";
  if (members.some((uid) => decisions[uid] === "decline")) return "declined";
  if (members.some((uid) => ended[uid] === true)) return "ended";
  const startedAt = Number(room.talkStartedAt || 0);
  if (startedAt > 0 && now >= startedAt + durationMs) return "expired";
  if (startedAt > 0 && members.every((uid) => decisions[uid] === "accept")) return "active";
  if (members.every((uid) => decisions[uid] === "accept")) return "ready";
  return "inviting";
}

export function presentationReplayStatus(replay, memberUids) {
  const source = objectValue(replay);
  if (allMembersMarked(source.completed, memberUids)) return "completed";
  if (Number(source.startedAt || 0) > 0) return "playing";
  if (allMembersMarked(source.ready, memberUids)) return "ready";
  return "waiting";
}

export function referenceVideoPlayStatus(value, viewerUid) {
  const source = objectValue(value);
  if (source.success?.[viewerUid] === true) return "completed";
  if (source.playing?.[viewerUid] === true) return "playing";
  return "ready";
}

export function createPerPeerTransferQueue() {
  const tails = new Map();
  return Object.freeze({
    enqueue(remoteUid, operation) {
      if (!remoteUid || typeof operation !== "function") {
        return Promise.reject(new TypeError("invalid peer transfer"));
      }
      const previous = tails.get(remoteUid) || Promise.resolve();
      const current = previous.catch(() => {}).then(operation);
      tails.set(remoteUid, current);
      current.finally(() => {
        if (tails.get(remoteUid) === current) tails.delete(remoteUid);
      }).catch(() => {});
      return current;
    },
    clear(remoteUid = "") {
      if (remoteUid) tails.delete(remoteUid);
      else tails.clear();
    },
    pending(remoteUid) {
      return tails.has(remoteUid);
    },
  });
}
