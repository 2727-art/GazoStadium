"use strict";

const {
  TERMINAL_PHASES,
  TRAINING_V6_PROTOCOL_VERSION,
  TRAINING_V6_QUEUE_TTL_MS,
  TRAINING_V6_ROOM_RETENTION_MS,
  TRAINING_V6_VARIANT,
  applyTrainingV6RoomAction,
  applyTrainingV6TransportClaim,
  createTrainingV6Room,
  isSafeUid,
  normalizeTrainingV6Action,
  roomIsTrainingV6,
  trainingV6RoomView,
} = require("./training-session-v6");

const PATHS = Object.freeze({
  root: "online/trainingV6/state",
  queue: "online/trainingV6/state/queue",
  tickets: "online/trainingV6/state/tickets",
  memberships: "online/trainingV6/state/memberships",
  rooms: "online/trainingV6/state/rooms",
  operations: "online/trainingV6/state/operations",
  receipts: "online/trainingV6/state/receipts",
  transportReceipts: "online/trainingV6/state/transportReceipts",
  privateScores: "online/trainingV6/state/privateScores",
  finalizationOutbox: "online/trainingV6/state/finalizationOutbox",
  signals: "online/trainingV6/signals",
  presence: "online/trainingV6/presence",
});

const ROOT_RECEIPT_LIMIT = 64;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function objectValue(value) {
  if (isRecord(value)) return clone(value);
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .map((child, index) => [String(index), child])
        .filter(([, child]) => child != null),
    );
  }
  return {};
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function semanticAction(action) {
  return Object.fromEntries(
    Object.entries(action)
      .filter(([key]) => ![
        "actionId",
        "expectedRevision",
        "protocolVersion",
        "variant",
        "clientVersion",
      ].includes(key)),
  );
}

function createTrainingSessionV6Service({
  realtime,
  HttpsError,
  crypto,
  now = Date.now,
} = {}) {
  if (!realtime || typeof realtime.ref !== "function") {
    throw new TypeError("realtime is required");
  }
  if (typeof HttpsError !== "function") throw new TypeError("HttpsError is required");
  if (!crypto
      || typeof crypto.randomBytes !== "function"
      || typeof crypto.createHash !== "function") {
    throw new TypeError("crypto is required");
  }
  if (typeof now !== "function") throw new TypeError("now is required");

  const currentTime = () => {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("training V6 clock is invalid");
    }
    return value;
  };
  const rootRef = () => realtime.ref(PATHS.root);

  function roomIdToken() {
    const bytes = crypto.randomBytes(15);
    if (!Buffer.isBuffer(bytes) || bytes.length !== 15) {
      throw new TypeError("training V6 token source is invalid");
    }
    return bytes.toString("base64url");
  }

  function normalizeUid(value) {
    const uid = String(value || "");
    if (!isSafeUid(uid)) {
      throw new HttpsError("unauthenticated", "ログインを確認してください。");
    }
    return uid;
  }

  function requireAction(input) {
    if (isRecord(input)
        && (input.protocolVersion !== TRAINING_V6_PROTOCOL_VERSION
          || input.variant !== TRAINING_V6_VARIANT)) {
      throw new HttpsError(
        "failed-precondition",
        "鍛え合い60を最新版へ更新してください。",
        {
          reason: "protocol-mismatch",
          protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
          variant: TRAINING_V6_VARIANT,
        },
      );
    }
    const data = normalizeTrainingV6Action(input);
    if (!data) {
      throw new HttpsError(
        "invalid-argument",
        "鍛え合い60 V6の操作形式を確認してください。",
      );
    }
    return data;
  }

  function actionDigest(action) {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(stableValue(semanticAction(action))))
      .digest("hex");
  }

  function ensureRoot(value) {
    const root = objectValue(value);
    root.protocolVersion = TRAINING_V6_PROTOCOL_VERSION;
    root.variant = TRAINING_V6_VARIANT;
    root.queue = objectValue(root.queue);
    root.tickets = objectValue(root.tickets);
    root.memberships = objectValue(root.memberships);
    root.rooms = objectValue(root.rooms);
    root.operations = objectValue(root.operations);
    root.receipts = objectValue(root.receipts);
    root.transportReceipts = objectValue(root.transportReceipts);
    root.privateScores = objectValue(root.privateScores);
    root.finalizationOutbox = objectValue(root.finalizationOutbox);
    return root;
  }

  function ensureFinalizationOutbox(root, room, timestamp) {
    if (!roomIsTrainingV6(room) || !TERMINAL_PHASES.has(room.phase)) return;
    const completedAt = Number(room.result?.completedAt || 0);
    if (!Number.isSafeInteger(completedAt) || completedAt <= 0) return;
    const current = root.finalizationOutbox?.[room.roomId];
    if (isRecord(current)
        && current.protocolVersion === TRAINING_V6_PROTOCOL_VERSION
        && current.roomId === room.roomId
        && Number(current.terminalAt) === completedAt) {
      return;
    }
    root.finalizationOutbox[room.roomId] = {
      protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
      variant: TRAINING_V6_VARIANT,
      roomId: room.roomId,
      participantUid: room.participantUids[0],
      terminalPhase: room.phase,
      terminalAt: completedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  function operationReceipt(root, uid, actionId) {
    const receipt = root.operations?.[uid]?.[actionId];
    return isRecord(receipt) ? receipt : null;
  }

  function operationReceiptMatches(receipt, action, digest) {
    return receipt?.action === action && receipt?.digest === digest;
  }

  function recordOperation(root, uid, action, digest, result, timestamp) {
    root.operations[uid] = objectValue(root.operations[uid]);
    root.operations[uid][action.actionId] = {
      action: action.action,
      digest,
      result: clone(result),
      at: timestamp,
    };
    const receipts = Object.entries(root.operations[uid])
      .sort(([, first], [, second]) => (
        Number(second?.at || 0) - Number(first?.at || 0)
      ));
    for (const [actionId] of receipts.slice(ROOT_RECEIPT_LIMIT)) {
      delete root.operations[uid][actionId];
    }
  }

  function pruneExpiredQueue(root, timestamp) {
    for (const [uid, entry] of Object.entries(root.queue)) {
      if (!isRecord(entry)
          || entry.protocolVersion !== TRAINING_V6_PROTOCOL_VERSION
          || !isSafeUid(uid)
          || entry.uid !== uid
          || !Number.isSafeInteger(entry.expiresAt)
          || entry.expiresAt <= timestamp) {
        delete root.queue[uid];
        if (root.memberships?.[uid]?.state === "waiting") {
          delete root.memberships[uid];
        }
        if (root.tickets?.[uid]?.state === "waiting") {
          root.tickets[uid] = {
            ...root.tickets[uid],
            state: "terminal",
            updatedAt: timestamp,
          };
        }
      }
    }
  }

  function waitingCandidates(root, uid, timestamp) {
    return Object.values(root.queue)
      .filter((entry) => (
        entry?.uid !== uid
        && isSafeUid(entry?.uid)
        && entry.protocolVersion === TRAINING_V6_PROTOCOL_VERSION
        && Number.isSafeInteger(entry.expiresAt)
        && entry.expiresAt > timestamp
        && root.memberships?.[entry.uid]?.state === "waiting"
      ))
      .sort((first, second) => (
        Number(first.queuedAt || 0) - Number(second.queuedAt || 0)
        || String(first.uid).localeCompare(String(second.uid))
      ));
  }

  function membershipRoom(root, uid) {
    const membership = root.memberships?.[uid];
    if (!["room", "finished"].includes(membership?.state)
        || typeof membership.roomId !== "string") return null;
    const room = root.rooms?.[membership.roomId];
    return roomIsTrainingV6(room) && room.members?.[uid] === true
      ? room
      : null;
  }

  function waitingResponse(root, uid, { idempotent = false } = {}) {
    const queue = root.queue?.[uid];
    return {
      outcome: "waiting",
      protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
      variant: TRAINING_V6_VARIANT,
      queueExpiresAt: Number(queue?.expiresAt || 0),
      ticket: clone(root.tickets?.[uid]),
      idempotent,
    };
  }

  function roomResponse(room, uid, extras = {}) {
    const view = trainingV6RoomView(room, uid);
    if (!view) return null;
    return {
      outcome: room.phase,
      protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
      variant: TRAINING_V6_VARIANT,
      roomId: room.roomId,
      revision: room.revision,
      transportRevision: room.transportRevision,
      phase: room.phase,
      room: view,
      snapshot: clone(view),
      ...extras,
    };
  }

  function ownScoreResponse(root, room, uid) {
    const value = root.privateScores
      ?.[room?.roomId]?.[room?.roundNumber]?.[uid]?.value;
    return Number.isInteger(value) && value >= 1 && value <= 10
      ? { ownScore: value }
      : {};
  }

  function decisionError(reason, details = {}) {
    const code = reason === "room-not-found"
      ? "not-found"
      : reason === "not-member"
        ? "permission-denied"
        : ["invalid-action", "action-id-reused", "unsafe-instruction"]
            .includes(reason)
          ? "invalid-argument"
          : "failed-precondition";
    const message = {
      "room-not-found": "鍛え合い60 V6のルームが見つかりません。",
      "invalid-room": "鍛え合い60 V6のルーム状態を確認できません。",
      "not-member": "この鍛え合い60 V6には参加していません。",
      "owner-replaced": "別の端末またはタブで鍛え合い60 V6が再開されました。",
      "revision-conflict": "鍛え合い60 V6の状態が更新されています。",
      "action-id-reused": "同じ操作IDを別の操作へ再利用できません。",
      "unsafe-instruction": "相手の安全設定に含まれない筋トレ指示です。",
      "room-finished": "この鍛え合い60 V6は終了しています。",
      "room-not-finished": "終了後に完了確認を行ってください。",
      "wrong-phase": "現在の段階ではこの操作を実行できません。",
      "wrong-draw": "現在のDRAWと操作対象が一致しません。",
      "wrong-workout": "現在の筋トレと操作対象が一致しません。",
      "not-trainer": "現在の指示担当ではありません。",
      "not-victim": "現在の筋トレ担当ではありません。",
      "workout-not-started": "筋トレ開始後に完了してください。",
      "workout-not-finished": "60秒の筋トレ時間が終了していません。",
      "image-already-used": "同じ画像は再度DRAWできません。",
      "already-applied": "この操作はすでに確定しています。",
      "unsupported-action": "未対応の鍛え合い60 V6操作です。",
      "invalid-action": "鍛え合い60 V6の操作を確認してください。",
    }[reason] || "鍛え合い60 V6の状態を確認してください。";
    return new HttpsError(code, message, { reason, ...details });
  }

  async function join(uid, action) {
    const timestamp = currentTime();
    const digest = actionDigest(action);
    const proposedRoomId = roomIdToken();
    const proposedTicketId = roomIdToken();
    let decision = null;
    const transaction = await rootRef().transaction((current) => {
      const root = ensureRoot(current);
      const prior = operationReceipt(root, uid, action.actionId);
      if (prior) {
        if (!operationReceiptMatches(prior, action.action, digest)) {
          decision = { error: "action-id-reused" };
        } else {
          decision = { idempotent: true, prior: prior.result };
        }
        return root;
      }

      pruneExpiredQueue(root, timestamp);
      const existingRoom = membershipRoom(root, uid);
      if (existingRoom && !TERMINAL_PHASES.has(existingRoom.phase)) {
        const result = { outcome: "room", roomId: existingRoom.roomId };
        recordOperation(root, uid, action, digest, result, timestamp);
        decision = { result };
        return root;
      }
      if (["room", "finished"].includes(root.memberships?.[uid]?.state)) {
        delete root.memberships[uid];
      }

      const existingQueue = root.queue[uid];
      const ticketId = root.tickets?.[uid]?.state === "waiting"
        ? root.tickets[uid].ticketId
        : proposedTicketId;
      root.queue[uid] = {
        protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
        uid,
        ticketId,
        profile: clone(action.profile),
        queuedAt: Number(existingQueue?.queuedAt || timestamp),
        updatedAt: timestamp,
        expiresAt: timestamp + TRAINING_V6_QUEUE_TTL_MS,
      };
      root.memberships[uid] = {
        protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
        uid,
        state: "waiting",
        queuedAt: root.queue[uid].queuedAt,
        updatedAt: timestamp,
      };
      root.tickets[uid] = {
        protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
        ticketId,
        state: "waiting",
        updatedAt: timestamp,
      };

      const opponent = waitingCandidates(root, uid, timestamp)[0];
      if (!opponent) {
        const result = { outcome: "waiting" };
        recordOperation(root, uid, action, digest, result, timestamp);
        decision = { result };
        return root;
      }
      if (root.rooms[proposedRoomId]) {
        decision = { error: "room-id-collision" };
        return root;
      }
      const room = createTrainingV6Room({
        roomId: proposedRoomId,
        firstUid: opponent.uid,
        secondUid: uid,
        players: {
          [opponent.uid]: opponent.profile,
          [uid]: action.profile,
        },
        now: timestamp,
      });
      if (!room) {
        decision = { error: "invalid-room" };
        return root;
      }
      root.rooms[room.roomId] = room;
      for (const [seat, memberUid] of room.participantUids.entries()) {
        root.memberships[memberUid] = {
          protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
          uid: memberUid,
          state: "room",
          roomId: room.roomId,
          seat,
          joinedAt: timestamp,
          updatedAt: timestamp,
        };
        const memberTicketId = root.queue[memberUid]?.ticketId
          || root.tickets?.[memberUid]?.ticketId
          || proposedTicketId;
        root.tickets[memberUid] = {
          protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
          ticketId: memberTicketId,
          state: "matched",
          roomId: room.roomId,
          updatedAt: timestamp,
        };
        delete root.queue[memberUid];
      }
      const result = { outcome: "room", roomId: room.roomId };
      recordOperation(root, uid, action, digest, result, timestamp);
      decision = { result };
      return root;
    }, undefined, false);

    if (!transaction.committed) {
      throw new HttpsError(
        "aborted",
        "鍛え合い60 V6の参加状態を再確認してください。",
        { reason: "transaction-not-committed" },
      );
    }
    const root = ensureRoot(transaction.snapshot.val());
    if (decision?.error) throw decisionError(decision.error);
    const room = membershipRoom(root, uid);
    if (room) {
      return roomResponse(room, uid, {
        idempotent: decision?.idempotent === true,
      });
    }
    if (root.memberships?.[uid]?.state === "waiting"
        && root.queue?.[uid]) {
      return waitingResponse(root, uid, {
        idempotent: decision?.idempotent === true,
      });
    }
    return {
      outcome: "idle",
      protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
      variant: TRAINING_V6_VARIANT,
      ticket: clone(root.tickets?.[uid]),
      idempotent: decision?.idempotent === true,
    };
  }

  async function inspect(uid, action) {
    const timestamp = currentTime();
    const transaction = await rootRef().transaction((current) => {
      const root = ensureRoot(current);
      pruneExpiredQueue(root, timestamp);
      const inspectedRoom = action.roomId
        ? root.rooms?.[action.roomId]
        : membershipRoom(root, uid);
      if (inspectedRoom?.members?.[uid] === true) {
        ensureFinalizationOutbox(root, inspectedRoom, timestamp);
      }
      return root;
    }, undefined, false);
    if (!transaction.committed) {
      throw new HttpsError(
        "aborted",
        "鍛え合い60 V6の状態を再確認してください。",
        { reason: "transaction-not-committed" },
      );
    }
    const root = ensureRoot(transaction.snapshot.val());
    if (action.roomId) {
      const room = root.rooms?.[action.roomId];
      if (!room) throw decisionError("room-not-found");
      if (room.members?.[uid] !== true) throw decisionError("not-member");
      return roomResponse(room, uid, {
        idempotent: false,
        ...ownScoreResponse(root, room, uid),
      });
    }
    const room = membershipRoom(root, uid);
    if (room) {
      return roomResponse(room, uid, {
        idempotent: false,
        ...ownScoreResponse(root, room, uid),
      });
    }
    const waiting = root.memberships?.[uid]?.state === "waiting"
      && Number(root.queue?.[uid]?.expiresAt || 0) > timestamp;
    if (waiting) return waitingResponse(root, uid);
    return {
      outcome: "idle",
      protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
      variant: TRAINING_V6_VARIANT,
      ticket: clone(root.tickets?.[uid]),
      idempotent: false,
    };
  }

  async function leave(uid, action) {
    const timestamp = currentTime();
    const digest = actionDigest(action);
    let decision = null;
    const transaction = await rootRef().transaction((current) => {
      const root = ensureRoot(current);
      const prior = operationReceipt(root, uid, action.actionId);
      if (prior) {
        if (!operationReceiptMatches(prior, action.action, digest)) {
          decision = { error: "action-id-reused" };
        } else {
          decision = {
            idempotent: true,
            result: prior.result,
          };
        }
        return root;
      }
      pruneExpiredQueue(root, timestamp);
      const membership = root.memberships?.[uid];
      if (membership?.state === "waiting") {
        if (action.roomId) {
          decision = { error: "room-mismatch" };
          return root;
        }
        delete root.queue[uid];
        delete root.memberships[uid];
        if (root.tickets?.[uid]) {
          root.tickets[uid] = {
            ...root.tickets[uid],
            state: "terminal",
            updatedAt: timestamp,
          };
        }
        const result = { outcome: "left_queue" };
        recordOperation(root, uid, action, digest, result, timestamp);
        decision = { result };
        return root;
      }
      if (membership?.state !== "room") {
        const result = { outcome: "idle" };
        recordOperation(root, uid, action, digest, result, timestamp);
        decision = { result };
        return root;
      }
      if (!action.roomId || action.roomId !== membership.roomId) {
        decision = { error: "room-mismatch" };
        return root;
      }
      const room = root.rooms?.[membership.roomId];
      const transition = applyTrainingV6RoomAction({
        room,
        uid,
        action,
        actionDigest: digest,
        priorReceipt: root.receipts?.[membership.roomId]?.[uid]?.[action.actionId],
        now: timestamp,
      });
      if (!transition.ok) {
        decision = {
          error: transition.reason,
          details: {
            ...(transition.currentRevision == null ? {} : {
              currentRevision: transition.currentRevision,
            }),
          },
        };
        return root;
      }
      root.rooms[membership.roomId] = transition.room;
      ensureFinalizationOutbox(root, transition.room, timestamp);
      root.receipts[membership.roomId] = objectValue(
        root.receipts[membership.roomId],
      );
      root.receipts[membership.roomId][uid] = objectValue(
        root.receipts[membership.roomId][uid],
      );
      if (transition.receipt) {
        root.receipts[membership.roomId][uid][action.actionId] = transition.receipt;
      }
      for (const memberUid of transition.room.participantUids) {
        root.memberships[memberUid] = {
          ...objectValue(root.memberships[memberUid]),
          protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
          uid: memberUid,
          state: "finished",
          roomId: transition.room.roomId,
          updatedAt: timestamp,
        };
        root.tickets[memberUid] = {
          ...objectValue(root.tickets[memberUid]),
          protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
          state: "terminal",
          roomId: transition.room.roomId,
          updatedAt: timestamp,
        };
      }
      const result = {
        outcome: transition.room.phase,
        roomId: transition.room.roomId,
      };
      recordOperation(root, uid, action, digest, result, timestamp);
      decision = {
        result,
        transition,
      };
      return root;
    }, undefined, false);

    if (!transaction.committed) {
      throw new HttpsError(
        "aborted",
        "鍛え合い60 V6の退出状態を再確認してください。",
        { reason: "transaction-not-committed" },
      );
    }
    if (decision?.error) {
      throw decisionError(decision.error, decision.details);
    }
    const root = ensureRoot(transaction.snapshot.val());
    const roomId = decision?.result?.roomId || action.roomId;
    const room = roomId ? root.rooms?.[roomId] : null;
    if (room?.members?.[uid] === true) {
      return roomResponse(room, uid, {
        idempotent: decision?.idempotent === true,
      });
    }
    return {
      outcome: decision?.result?.outcome || "idle",
      protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
      variant: TRAINING_V6_VARIANT,
      idempotent: decision?.idempotent === true,
    };
  }

  async function applyRoomAction(uid, action) {
    const timestamp = currentTime();
    const digest = actionDigest(action);
    let decision = null;
    const transaction = await rootRef().transaction((current) => {
      const root = ensureRoot(current);
      const privateScores = action.action === "score"
        ? objectValue(
          root.privateScores?.[action.roomId]?.[action.roundNumber],
        )
        : {};
      decision = applyTrainingV6RoomAction({
        room: root.rooms?.[action.roomId],
        uid,
        action,
        actionDigest: digest,
        priorReceipt: root.receipts?.[action.roomId]?.[uid]?.[action.actionId],
        privateScores,
        now: timestamp,
      });
      if (!decision.ok) return root;
      if (decision.changed) {
        root.rooms[action.roomId] = decision.room;
        root.receipts[action.roomId] = objectValue(root.receipts[action.roomId]);
        root.receipts[action.roomId][uid] = objectValue(
          root.receipts[action.roomId][uid],
        );
        if (decision.receipt) {
          root.receipts[action.roomId][uid][action.actionId] = decision.receipt;
        }
        if (action.action === "score" && decision.privateScore) {
          root.privateScores[action.roomId] = objectValue(
            root.privateScores[action.roomId],
          );
          root.privateScores[action.roomId][action.roundNumber] = objectValue(
            root.privateScores[action.roomId][action.roundNumber],
          );
          root.privateScores[action.roomId][action.roundNumber][uid] = {
            ...decision.privateScore,
            actionId: action.actionId,
            digest,
          };
        }
      }
      if (TERMINAL_PHASES.has(decision.room.phase)) {
        ensureFinalizationOutbox(root, decision.room, timestamp);
        for (const memberUid of decision.room.participantUids) {
          if (root.memberships?.[memberUid]?.roomId === action.roomId) {
            root.memberships[memberUid] = {
              ...root.memberships[memberUid],
              state: "finished",
              updatedAt: timestamp,
            };
          }
          root.tickets[memberUid] = {
            ...objectValue(root.tickets[memberUid]),
            protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
            state: "terminal",
            roomId: action.roomId,
            updatedAt: timestamp,
          };
        }
      }
      if (action.action === "finish") {
        if (root.memberships?.[uid]?.roomId === action.roomId) {
          delete root.memberships[uid];
        }
        root.tickets[uid] = {
          ...objectValue(root.tickets[uid]),
          protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
          state: "terminal",
          roomId: action.roomId,
          acknowledgedAt: timestamp,
          updatedAt: timestamp,
        };
      }
      return root;
    }, undefined, false);
    if (!transaction.committed) {
      throw new HttpsError(
        "aborted",
        "鍛え合い60 V6の操作結果を再確認してください。",
        { reason: "transaction-not-committed" },
      );
    }
    if (!decision?.ok) {
      throw decisionError(decision?.reason || "invalid-room", {
        ...(decision?.currentRevision == null ? {} : {
          currentRevision: decision.currentRevision,
        }),
      });
    }
    const root = ensureRoot(transaction.snapshot.val());
    const room = root.rooms?.[action.roomId];
    return roomResponse(room, uid, {
      idempotent: decision.idempotent,
      appliedRevision: decision.appliedRevision,
      ...(action.action === "score"
        && root.privateScores?.[action.roomId]?.[action.roundNumber]?.[uid]
        ? {
          ownScore: root.privateScores[action.roomId][action.roundNumber][uid].value,
        }
        : {}),
    });
  }

  async function claimTransport(uid, action) {
    const timestamp = currentTime();
    const digest = actionDigest(action);
    let decision = null;
    const transaction = await rootRef().transaction((current) => {
      const root = ensureRoot(current);
      decision = applyTrainingV6TransportClaim({
        room: root.rooms?.[action.roomId],
        uid,
        action,
        actionDigest: digest,
        priorReceipt: root.transportReceipts
          ?.[action.roomId]?.[uid]?.[action.actionId],
        now: timestamp,
      });
      if (!decision.ok || !decision.changed) return root;
      root.rooms[action.roomId] = decision.room;
      root.transportReceipts[action.roomId] = objectValue(
        root.transportReceipts[action.roomId],
      );
      root.transportReceipts[action.roomId][uid] = objectValue(
        root.transportReceipts[action.roomId][uid],
      );
      if (decision.receipt) {
        root.transportReceipts[action.roomId][uid][action.actionId] =
          decision.receipt;
      }
      return root;
    }, undefined, false);
    if (!transaction.committed) {
      throw new HttpsError(
        "aborted",
        "鍛え合い60 V6の通信所有権を再確認してください。",
        { reason: "transaction-not-committed" },
      );
    }
    if (!decision?.ok) {
      throw decisionError(decision?.reason || "invalid-room");
    }
    const root = ensureRoot(transaction.snapshot.val());
    const room = root.rooms?.[action.roomId];
    return roomResponse(room, uid, {
      idempotent: decision.idempotent,
      generation: decision.generation,
      connection: clone(room.connections?.[uid]),
    });
  }

  function handshake(action) {
    return {
      outcome: "ready",
      compatible: true,
      updateRequired: false,
      protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
      variant: TRAINING_V6_VARIANT,
      clientVersion: action.clientVersion,
      capabilities: {
        actions: [
          "handshake",
          "join",
          "inspect",
          "leave",
          "claim_transport",
          "image_ready",
          "score",
          "instruction",
          "ready",
          "workout_started",
          "workout_completed",
          "no_contest",
          "finish",
        ],
        maxDraws: 5,
        workoutSeconds: 60,
        bpm: { minimum: 40, maximum: 160 },
        beatsPerRep: [2, 4, 8],
        exerciseIds: ["push_up", "squat", "sit_up", "custom"],
      },
    };
  }

  async function dispatch(uidValue, input) {
    const uid = normalizeUid(uidValue);
    const action = requireAction(input);
    if (action.action === "handshake") return handshake(action);
    if (action.action === "join") return join(uid, action);
    if (action.action === "inspect") return inspect(uid, action);
    if (action.action === "leave") return leave(uid, action);
    if (action.action === "claim_transport") return claimTransport(uid, action);
    return applyRoomAction(uid, action);
  }

  async function pendingFinalizations(limit = 25) {
    const boundedLimit = Number.isInteger(limit)
      ? Math.max(1, Math.min(100, limit))
      : 25;
    const snapshot = await rootRef().get();
    const root = ensureRoot(snapshot.val());
    return Object.values(root.finalizationOutbox)
      .filter((entry) => (
        isRecord(entry)
        && entry.protocolVersion === TRAINING_V6_PROTOCOL_VERSION
        && entry.variant === TRAINING_V6_VARIANT
        && typeof entry.roomId === "string"
        && isSafeUid(entry.participantUid)
        && Number.isSafeInteger(entry.terminalAt)
        && entry.terminalAt > 0
        && roomIsTrainingV6(root.rooms?.[entry.roomId])
        && TERMINAL_PHASES.has(root.rooms[entry.roomId].phase)
      ))
      .sort((first, second) => (
        Number(first.createdAt || 0) - Number(second.createdAt || 0)
      ))
      .slice(0, boundedLimit)
      .map((entry) => ({
        entry: clone(entry),
        room: clone(root.rooms[entry.roomId]),
      }));
  }

  async function acknowledgeFinalization(roomId, terminalAt) {
    if (typeof roomId !== "string"
        || !Number.isSafeInteger(terminalAt)
        || terminalAt <= 0) {
      throw new TypeError("training V6 finalization acknowledgement is invalid");
    }
    const result = await realtime.ref(
      `${PATHS.finalizationOutbox}/${roomId}`,
    ).transaction((current) => {
      if (current == null) return null;
      if (current.protocolVersion !== TRAINING_V6_PROTOCOL_VERSION
          || current.roomId !== roomId
          || Number(current.terminalAt) !== terminalAt) {
        return;
      }
      return null;
    }, undefined, false);
    return {
      acknowledged: result.committed || result.snapshot.val() == null,
    };
  }

  async function cleanup(timestampValue = currentTime()) {
    const timestamp = Number(timestampValue);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new TypeError("training V6 cleanup time is invalid");
    }
    let summary = null;
    const transaction = await rootRef().transaction((current) => {
      const root = ensureRoot(current);
      const beforeQueue = Object.keys(root.queue).length;
      pruneExpiredQueue(root, timestamp);
      const historyCutoff = timestamp - TRAINING_V6_ROOM_RETENTION_MS;
      let prunedOperations = 0;
      for (const [uid, operationsValue] of Object.entries(root.operations)) {
        const operations = objectValue(operationsValue);
        for (const [actionId, operation] of Object.entries(operations)) {
          if (isRecord(operation)
              && Number.isSafeInteger(operation.at)
              && operation.at > historyCutoff) {
            continue;
          }
          delete operations[actionId];
          prunedOperations += 1;
        }
        if (Object.keys(operations).length) {
          root.operations[uid] = operations;
        } else {
          delete root.operations[uid];
        }
      }
      const transportRoomIds = new Set();
      let expiredRooms = 0;
      let deletedRooms = 0;
      for (const [roomId, roomValue] of Object.entries(root.rooms)) {
        if (!roomIsTrainingV6(roomValue)
            || Number(roomValue.expiresAt) > timestamp) continue;
        if (!TERMINAL_PHASES.has(roomValue.phase)) {
          const room = clone(roomValue);
          room.phase = "no_contest";
          room.revision += 1;
          room.updatedAt = timestamp;
          room.expiresAt = timestamp + TRAINING_V6_ROOM_RETENTION_MS;
          room.result = {
            type: "no_contest",
            reason: "session_expired",
            note: "",
            requestedBy: "system",
            completedAt: timestamp,
          };
          root.rooms[roomId] = room;
          ensureFinalizationOutbox(root, room, timestamp);
          for (const memberUid of room.participantUids) {
            if (root.memberships?.[memberUid]?.roomId === roomId) {
              root.memberships[memberUid] = {
                ...root.memberships[memberUid],
                state: "finished",
                updatedAt: timestamp,
              };
            }
            root.tickets[memberUid] = {
              ...objectValue(root.tickets[memberUid]),
              protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
              state: "terminal",
              roomId,
              updatedAt: timestamp,
            };
          }
          transportRoomIds.add(roomId);
          expiredRooms += 1;
          continue;
        }
        if (root.finalizationOutbox?.[roomId]) continue;
        for (const memberUid of roomValue.participantUids) {
          if (root.memberships?.[memberUid]?.roomId === roomId) {
            delete root.memberships[memberUid];
          }
          if (root.tickets?.[memberUid]?.roomId === roomId) {
            delete root.tickets[memberUid];
          }
        }
        delete root.rooms[roomId];
        delete root.receipts[roomId];
        delete root.transportReceipts[roomId];
        delete root.privateScores[roomId];
        transportRoomIds.add(roomId);
        deletedRooms += 1;
      }
      let prunedTickets = 0;
      for (const [uid, ticket] of Object.entries(root.tickets)) {
        if (ticket?.state !== "terminal"
            || !Number.isSafeInteger(ticket.updatedAt)
            || ticket.updatedAt > historyCutoff
            || root.memberships?.[uid]) {
          continue;
        }
        delete root.tickets[uid];
        prunedTickets += 1;
      }
      summary = {
        prunedQueue: beforeQueue - Object.keys(root.queue).length,
        prunedOperations,
        prunedTickets,
        expiredRooms,
        deletedRooms,
        transportRoomIds: [...transportRoomIds],
      };
      return root;
    }, undefined, false);
    if (!transaction.committed) {
      throw new Error("training V6 cleanup transaction was not committed");
    }

    const staleUpdates = {};
    const [signalsSnapshot, presenceSnapshot] = await Promise.all([
      realtime.ref(PATHS.signals).get(),
      realtime.ref(PATHS.presence).get(),
    ]);
    let staleSignals = 0;
    let stalePresence = 0;
    const transportRoomIds = new Set(summary.transportRoomIds);
    for (const [roomId, recipients] of Object.entries(
      objectValue(signalsSnapshot.val()),
    )) {
      if (transportRoomIds.has(roomId)) {
        for (const senders of Object.values(objectValue(recipients))) {
          for (const signals of Object.values(objectValue(senders))) {
            staleSignals += Object.keys(objectValue(signals)).length;
          }
        }
        continue;
      }
      for (const [recipientUid, senders] of Object.entries(objectValue(recipients))) {
        for (const [senderUid, signals] of Object.entries(objectValue(senders))) {
          for (const [signalId, signal] of Object.entries(objectValue(signals))) {
            if (Number(signal?.createdAt || 0) >= timestamp - 120_000) continue;
            staleUpdates[
              `${PATHS.signals}/${roomId}/${recipientUid}/${senderUid}/${signalId}`
            ] = null;
            staleSignals += 1;
          }
        }
      }
    }
    for (const [roomId, members] of Object.entries(
      objectValue(presenceSnapshot.val()),
    )) {
      if (transportRoomIds.has(roomId)) {
        stalePresence += Object.keys(objectValue(members)).length;
        continue;
      }
      for (const [memberUid, presence] of Object.entries(objectValue(members))) {
        if (Number(presence?.updatedAt || 0) >= timestamp - 5 * 60_000) continue;
        staleUpdates[`${PATHS.presence}/${roomId}/${memberUid}`] = null;
        stalePresence += 1;
      }
    }
    for (const roomId of summary.transportRoomIds) {
      staleUpdates[`${PATHS.signals}/${roomId}`] = null;
      staleUpdates[`${PATHS.presence}/${roomId}`] = null;
    }
    if (Object.keys(staleUpdates).length) {
      await realtime.ref().update(staleUpdates);
    }
    return {
      ...summary,
      staleSignals,
      stalePresence,
    };
  }

  return Object.freeze({
    PATHS,
    acknowledgeFinalization,
    cleanup,
    dispatch,
    pendingFinalizations,
  });
}

module.exports = Object.freeze({
  PATHS,
  ROOT_RECEIPT_LIMIT,
  createTrainingSessionV6Service,
});
