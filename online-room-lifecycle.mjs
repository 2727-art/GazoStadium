export function captureOnlineRoomContext(expectedState, overrides = {}) {
  return Object.freeze({
    expectedState,
    generation: overrides.generation ?? expectedState?.matchmakingGeneration,
    roomId: overrides.roomId ?? expectedState?.roomId,
    ownUid: overrides.ownUid ?? expectedState?.uid,
    opponentUid: overrides.opponentUid ?? expectedState?.opponentUid,
  });
}

export function captureOnlineRoundContext(roomContext, expectedRound = roomContext?.expectedState?.round) {
  return Object.freeze({
    roomContext,
    expectedRound,
  });
}

export function isOnlineRoomContextCurrent(context, { active, currentState }) {
  return Boolean(
    active
      && context?.expectedState
      && currentState === context.expectedState
      && currentState.matchmakingGeneration === context.generation
      && currentState.roomId === context.roomId
      && currentState.uid === context.ownUid
      && currentState.opponentUid === context.opponentUid
      && !currentState.roomTerminationToken,
  );
}

export function isOnlineSameRoomIdentity(context, { active, currentState }) {
  return Boolean(
    active
      && context?.expectedState
      && currentState === context.expectedState
      && currentState.roomId === context.roomId
      && currentState.uid === context.ownUid
      && currentState.opponentUid === context.opponentUid,
  );
}

export function isOnlineRoundContextCurrent(context, environment) {
  return Boolean(
    isOnlineRoomContextCurrent(context?.roomContext, environment)
      && environment.currentState.round === context.expectedRound,
  );
}

export function beginOnlineStateTransition(targetState, type = "transition") {
  const token = Object.freeze({ type });
  targetState.lifecycleTransitionToken = token;
  return token;
}

export function isOnlineStateTransitionCurrent(targetState, token, currentState) {
  return Boolean(
    targetState
      && token
      && currentState === targetState
      && targetState.lifecycleTransitionToken === token,
  );
}

export function isOpponentDestroyedMarkerForRoom(marker, context) {
  return Boolean(
    marker
      && typeof marker === "object"
      && marker.by
      && marker.by === context?.opponentUid,
  );
}

export async function runOnlineOpponentDestroyedTransition({
  context,
  marker,
  isCurrent,
  cleanup,
  isStillSameRoom,
  finalize,
}) {
  const expectedState = context?.expectedState;
  if (!expectedState
      || !isCurrent()
      || !isOpponentDestroyedMarkerForRoom(marker, context)
      || expectedState.destroyedByOpponent
      || expectedState.roomTerminationToken) {
    return false;
  }
  const terminationToken = Object.freeze({ type: "opponent-destroyed" });
  expectedState.roomTerminationToken = terminationToken;
  expectedState.destroyedByOpponent = true;
  await cleanup(expectedState);
  if (expectedState.roomTerminationToken !== terminationToken || !isStillSameRoom()) return false;
  await finalize(expectedState);
  return true;
}
