/* PHOENIX - the 3D table's connection to the real game.
 *
 * This is the SAME server the 2D game talks to, on the same socket, with
 * the same messages. The 3D table is another way of looking at the same
 * match - it is not a different game, and it does not have its own rules.
 *
 * Three things are worth saying, and they are the whole design:
 *
 *   1. THE SERVER DECIDES EVERYTHING. What a player may play, who they may
 *      aim at, what the scores are and who has won: all of it comes down
 *      the socket in one 'state' message. This file never works out what is
 *      legal. It only sends what the server already said was legal.
 *
 *   2. ONLY YOUR OWN HAND EVER ARRIVES. Everybody else's is a number, and
 *      that is the server's business, not this client's.
 *
 *   3. THE CONNECTION CAN DROP. The server keeps the match alive for ten
 *      minutes and hands back a token; this client keeps that token and
 *      puts it back, so a player who loses the signal comes back to the
 *      same seat in the same match.
 */
'use strict';

/** Where the resume token is kept. The same place the 2D game keeps it. */
const RESUME_KEY = 'phoenix-online-resume:';

/** How long to wait before trying again, and how many times. */
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 5000;
const RETRY_LIMIT = 10;

function resumeStorageKey(win) {
  const where = win || (typeof window !== 'undefined' ? window : globalThis);
  return RESUME_KEY + where.location.pathname + where.location.search;
}

function readResume(win) {
  try {
    const raw = win.sessionStorage.getItem(resumeStorageKey(win));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.code || !parsed.token) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function writeResume(value, win) {
  try {
    if (value) win.sessionStorage.setItem(resumeStorageKey(win), JSON.stringify(value));
    else win.sessionStorage.removeItem(resumeStorageKey(win));
  } catch (error) { /* the token simply does not survive a reload */ }
}

/**
 * The client.
 *
 * `options`:
 *   onState    (state)      - a new snapshot from the server
 *   onMessage  (message)    - anything else the server said
 *   onRooms    (rooms)      - the list of open rooms
 *   onStatus   (text, kind)- 'connecting' | 'connected' | 'lost' | 'closed'
 */
export function createMultiplayer(options) {
  const settings = Object.assign({
    onState: null,
    onMessage: null,
    onRooms: null,
    onStatus: null,
    // The window this client lives in. A test can give it one of its own.
    window: null
  }, options || {});

  // The window is taken once, when the client is made, so a client always
  // keeps its own place - its own session store, its own timers - however
  // many clients there are.
  const win = settings.window || window;

  let socket = null;
  let state = null;
  let connected = false;
  let intentional = false;
  let retries = 0;
  let retryTimer = null;

  function status(text, kind) {
    if (settings.onStatus) settings.onStatus(text, kind || 'info');
  }

  function say(message) {
    if (settings.onMessage) settings.onMessage(message);
  }

  /** Send a message to the server. Nothing is worked out here. */
  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      status('Not connected to the server yet.', 'lost');
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }

  function socketUrl() {
    const protocol = win.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return protocol + '//' + win.location.host;
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    intentional = false;
    status('Connecting to the server...', 'connecting');
    const connection = new WebSocket(socketUrl());
    socket = connection;
    // The interactive overlays in the 2D game talk to the socket through
    // window.ws, and they are the same overlays here.
    win.ws = connection;

    connection.onopen = function () {
      connected = true;
      retries = 0;
      status('Connected.', 'connected');
      // If the match was interrupted, go straight back into it.
      const saved = readResume(win);
      if (saved) {
        connection.send(JSON.stringify({ type: 'resume', code: saved.code, token: saved.token }));
      }
    };

    connection.onerror = function () {
      status('Could not reach the server.', 'lost');
    };

    connection.onclose = function () {
      connected = false;
      if (socket === connection) socket = null;
      if (intentional) {
        status('Disconnected.', 'closed');
        return;
      }
      status('The connection dropped. Trying to get back in...', 'lost');
      if (retries >= RETRY_LIMIT) {
        status('The server could not be reached.', 'lost');
        return;
      }
      const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, retries));
      retries += 1;
      retryTimer = win.setTimeout(connect, wait);
    };

    connection.onmessage = function (event) {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (!message || !message.type) return;

      if (message.type === 'state') {
        state = message;
        if (message.resumeToken) {
          writeResume({ code: message.code, token: message.resumeToken }, win);
        }
        if (settings.onState) settings.onState(message);
        return;
      }

      if (message.type === 'lobby') {
        if (settings.onRooms) settings.onRooms(message.rooms || []);
        return;
      }

      if (message.type === 'roomClosed') {
        writeResume(null, win);
        state = null;
      }

      say(message);
    };
  }

  /** Leave on purpose: no reconnecting afterwards. */
  function disconnect() {
    intentional = true;
    if (retryTimer) {
      win.clearTimeout(retryTimer);
      retryTimer = null;
    }
    writeResume(null, win);
    if (socket) {
      try { socket.close(); } catch (error) { /* closing anyway */ }
    }
    socket = null;
    connected = false;
    state = null;
  }

  /* ---- the actions the server understands ---- */

  const client = {
    connect: connect,
    disconnect: disconnect,
    send: send,
    isConnected: function () { return !!connected; },
    getState: function () { return state; },

    /** The cards in your own hand, as card records. */
    getHand: function () {
      const Cards = win.PhoenixCards;
      if (!Cards || !state || !Array.isArray(state.hand)) return [];
      return state.hand
        .map(function (id) { return Cards.byId(id); })
        .filter(Boolean);
    },

    /** The moves the server says you may make right now. */
    getMoves: function () {
      if (!state || !Array.isArray(state.moves)) return [];
      return state.moves;
    },

    /** The moves for one card. */
    movesFor: function (cardId) {
      return client.getMoves().filter(function (move) { return move.cardId === cardId; });
    },

    createRoom: function (code) {
      return send({ type: 'create', code: (code || '').trim().toUpperCase() });
    },
    joinRoom: function (code) {
      return send({ type: 'join', code: (code || '').trim().toUpperCase() });
    },
    leave: function () {
      const ok = send({ type: 'leave' });
      writeResume(null, win);
      return ok;
    },
    start: function (rounds) {
      return send({ type: 'start', rounds: rounds || 10 });
    },
    roll: function () {
      return send({ type: 'roll' });
    },
    chooseAlly: function (ally) {
      return send({ type: 'chooseAlly', ally: ally });
    },
    play: function (cardId, targetId) {
      return send({ type: 'move', cardId: cardId, targetId: targetId === undefined ? null : targetId });
    },
    interact: function (decision) {
      return send({ type: 'interact', decision: decision });
    },
    kick: function (seat) {
      return send({ type: 'kick', seat: seat });
    },
    closeRoom: function () {
      return send({ type: 'close_room' });
    },
    banCard: function (cardId, remove) {
      return send({ type: 'president_ban', cardId: cardId, remove: !!remove });
    },
    ping: function () {
      return send({ type: 'ping' });
    }
  };

  return client;
}

export { readResume, writeResume, resumeStorageKey };
