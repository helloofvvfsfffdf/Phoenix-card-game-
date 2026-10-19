/* Who may act right now.
 *
 * The turn belongs to the player the server says it is - the one whose own
 * seat holds the current turn. When that player is being held hostage, it is
 * their CRIMINAL who plays the turn for them, and the criminal is the one who
 * is given the hostage's legal moves.
 *
 * Tests that play a match use this, so they find the same player the server
 * expects a move from.
 */
'use strict';

function actingClient(clients, stateOf) {
  const get = stateOf || function (client) { return client.state; };
  if (!clients || !clients.length) return null;
  const first = get(clients[0]);
  if (!first) return null;
  const current = first.current;

  const own = function (client) {
    const st = get(client);
    if (!st || !st.players || st.seat === undefined) return null;
    const seat = st.players[st.seat];
    return seat ? seat.id : null;
  };

  // A FORCED CHOICE has its own chooser: the Steal a Turn or the Alvin
  // burn is waiting for that player, not for the one whose turn it is.
  const pending = first.pending;
  if (pending && pending.chooserId) {
    const chooser = clients.find(function (client) { return own(client) === pending.chooserId; });
    if (chooser) {
      const st = get(chooser);
      // A hostage cannot answer their own choice - their criminal does.
      if (st.hostage && st.hostage.hostageId === pending.chooserId) {
        const criminal = clients.find(function (client) { return own(client) === st.hostage.criminalId; });
        if (criminal) return criminal;
      }
      return chooser;
    }
  }

  // A HOSTAGE'S TURN belongs to their criminal.
  if (current && first.hostage && first.hostage.hostageId === current) {
    const criminal = clients.find(function (client) { return own(client) === first.hostage.criminalId; });
    if (criminal) return criminal;
  }

  if (current) {
    const turnPeer = clients.find(function (client) { return own(client) === current; });
    if (turnPeer) {
      const st = get(turnPeer);
      if (st.acting) return turnPeer;
    }
  }

  // The table may be a moment behind: whoever says they are acting is the
  // best answer until it catches up.
  return clients.find(function (client) {
    const st = get(client);
    return st && st.acting;
  }) || null;
}

module.exports = actingClient;
