/* Server-side projection: never send private interaction state verbatim. */
'use strict';

module.exports = function interactionView(pi, viewerId) {
  if (!pi) return null;
  const phase = pi.phase || 'main';
  const data = pi.roundData || {};
  // The moment the music stops is the server's business, not the table's:
  // with a countdown on screen, everybody knows exactly when to press.
  const roundData = pi.type === 'musicalchairs'
    ? (function () {
        const copy = Object.assign({}, data);
        delete copy.musicStopsAt;
        return copy;
      })()
    : pi.type === 'impostor'
    ? {
        myWord: pi.participants.includes(viewerId) && data.playerWords
          ? data.playerWords[viewerId] || null : null,
        // Clues are public only once everyone has supplied one. Votes remain private.
        clues: phase === 'vote' ? { ...(data.clues || {}) } : {}
      }
    : { ...data };
  return {
    type: pi.type,
    participants: pi.participants.slice(),
    submitted: Object.keys((pi.decisions || {})[phase] || {}),
    createdAt: pi.createdAt,
    timeoutMs: pi.timeoutMs,
    deadlineAt: pi.deadlineAt || null,
    phase,
    roundData,
    actorId: pi.actorId || null,
    actorSeat: pi.actorSeat == null ? null : pi.actorSeat,
    targetId: pi.targetId || null,
    targetIds: pi.targetIds || null
  };
};
