"use strict";

function isIncomingMarketRoomStateOlder(current, room) {
  const currentVersion = Number(current?.stateVersion || 0);
  const incomingVersion = Number(room?.stateVersion || 0);
  if (currentVersion > 0 && incomingVersion > 0) return incomingVersion < currentVersion;
  return Number(room?.updatedAt || 0) < Number(current?.updatedAt || 0);
}

function nextPublicMarketRoomState(current, room, { now, terminal }) {
  const incomingVersion = Number(room?.stateVersion || 0);
  const currentVersion = Number(current?.stateVersion || 0);
  if (incomingVersion < currentVersion || (current?.closed === true && !terminal)) return undefined;
  if (terminal) {
    return {
      closed: true,
      stateVersion: incomingVersion,
      updatedAt: Number(now),
    };
  }
  return {
    ...(current || {}),
    closed: false,
    stateVersion: incomingVersion,
    updatedAt: Number(now),
  };
}

function nextPublicMarketRoomHeartbeat(current, room, role, now) {
  if (!["seller", "buyer"].includes(role)) return undefined;
  const incomingVersion = Number(room?.stateVersion || 0);
  const currentVersion = Number(current?.stateVersion || 0);
  if (current?.closed === true || incomingVersion < currentVersion) return undefined;
  return {
    ...(current || {}),
    closed: false,
    stateVersion: incomingVersion,
    [`${role}SeenAt`]: Number(now),
    updatedAt: Number(now),
  };
}

module.exports = {
  isIncomingMarketRoomStateOlder,
  nextPublicMarketRoomHeartbeat,
  nextPublicMarketRoomState,
};
