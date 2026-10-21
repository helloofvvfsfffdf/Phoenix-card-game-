let currentState = null;

export function receiveState(message) {
  if (!message || message.type !== 'state') return;

  currentState = message;

  console.log('[PHOENIX 3D] State received:', {
    phase: message.phase,
    players: message.players?.length ?? 0,
    cards: message.hand?.length ?? 0,
    legalMoves: message.moves?.length ?? 0
  });
}

export function getState() {
  return currentState;
}
