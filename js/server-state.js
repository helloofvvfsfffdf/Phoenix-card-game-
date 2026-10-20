/* PHOENIX - the server's own switches, kept across a restart.
 *
 * The owner has two switches: is multiplayer open, and is lobby creation
 * locked. They used to live in a file on the server's own disk, which works
 * on a normal machine - but a Render free instance throws its disk away on
 * every deploy AND every spin-down. So a server that had been quiet for a
 * while came back up with its switches reset, and the first player to arrive
 * was told "multiplayer is closed" until the owner pressed Reopen.
 *
 * The state is therefore kept in the DATABASE as well, which survives both.
 * The file is still written, because it costs nothing and it is what a local
 * developer sees; the database is what a hosted server has.
 *
 * WHICH ONE WINS. Both copies carry the moment they were written, and the
 * newer one is the truth. That matters because a write can half-succeed: if
 * the database is unreachable the file still takes the change, and the next
 * boot must not undo it with a stale database row.
 *
 * Neither copy is a secret and neither is a player's data: two booleans.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Auth = require('./auth');

const STATE_FILE = process.env.PHOENIX_STATE_FILE ||
  path.join(__dirname, '..', '.phoenix-server-state.json');

const TABLE = 'phoenix_server_state';
const ROW_KEY = 'singleton';

let _dbChecked = false;

/* ------------------------------------------------------------------ */
/* The defaults                                                       */
/* ------------------------------------------------------------------ */

/**
 * What a brand new server starts as.
 *
 * Multiplayer is OPEN unless the environment says otherwise: a server that
 * boots up after a quiet spell should be ready to play, not waiting for the
 * owner to walk in and open the door. Set PHOENIX_MULTIPLAYER_OPEN=false to
 * start closed on purpose (a staging box, say).
 */
function defaults() {
  const raw = String(process.env.PHOENIX_MULTIPLAYER_OPEN === undefined
    ? 'true'
    : process.env.PHOENIX_MULTIPLAYER_OPEN).trim().toLowerCase();
  const closed = raw === 'false' || raw === '0' || raw === 'no' || raw === 'off';
  return { multiplayerOpen: !closed, creationLocked: false };
}

/* ------------------------------------------------------------------ */
/* Reading                                                            */
/* ------------------------------------------------------------------ */

function readFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      multiplayerOpen: typeof parsed.multiplayerOpen === 'boolean' ? parsed.multiplayerOpen : null,
      creationLocked: typeof parsed.creationLocked === 'boolean' ? parsed.creationLocked : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
    };
  } catch (e) {
    return null;
  }
}

/** Is this error the database saying "that table is not there yet"? */
function isMissingTable(error) {
  const code = String((error && error.code) || '');
  return code === 'PGRST205' || code === 'PGRST204' || code === '42P01' ||
         code === '42703';
}

/**
 * Read the durable copy out of the database.
 *
 * Returns null when there is no database, no table, or no row - every one of
 * which is a normal, expected state and never an error the owner needs to see.
 */
async function readDatabase() {
  if (!Auth.isConfigured()) return null;
  try {
    const { data, error } = await Auth.client()
      .from(TABLE)
      .select('multiplayer_open, creation_locked, updated_at')
      .eq('key', ROW_KEY)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error) && !_dbChecked) {
        _dbChecked = true;
        console.log('[PHOENIX state] the durable copy is not installed yet. ' +
          'Paste sql/server-state.sql into the Supabase SQL Editor and run it ' +
          'to keep the owner\'s switches across a restart. Until then the ' +
          'server still works, it just starts open.');
      }
      return null;
    }
    if (!data) return null;
    const at = data.updated_at ? new Date(data.updated_at).getTime() : 0;
    return {
      multiplayerOpen: typeof data.multiplayer_open === 'boolean' ? data.multiplayer_open : null,
      creationLocked: typeof data.creation_locked === 'boolean' ? data.creation_locked : null,
      updatedAt: isFinite(at) ? at : 0
    };
  } catch (err) {
    console.log('[PHOENIX state] the durable copy could not be read -> ' +
      Auth.describeError(err));
    return null;
  }
}

/**
 * The state the server should start with.
 *
 * The newer of the two copies wins. When neither is there, the built-in
 * defaults are used - which means a fresh server comes up OPEN.
 */
async function load() {
  const base = defaults();
  const fromFile = readFile();
  const fromDb = await readDatabase();

  let chosen = null;
  if (fromFile && fromDb) {
    // A file with no timestamp was written by an older build, which knew
    // nothing about the database. That file is the older build's own copy of
    // the owner's last choice, so it is trusted over the database row.
    if (!fromFile.updatedAt) {
      chosen = fromFile;
    } else {
      chosen = fromDb.updatedAt >= fromFile.updatedAt ? fromDb : fromFile;
    }
  } else {
    chosen = fromDb || fromFile;
  }

  const state = {
    multiplayerOpen: base.multiplayerOpen,
    creationLocked: base.creationLocked
  };
  if (chosen) {
    if (typeof chosen.multiplayerOpen === 'boolean') state.multiplayerOpen = chosen.multiplayerOpen;
    if (typeof chosen.creationLocked === 'boolean') state.creationLocked = chosen.creationLocked;
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Writing                                                            */
/* ------------------------------------------------------------------ */

function writeFile(state) {
  try {
    const payload = {
      multiplayerOpen: Boolean(state.multiplayerOpen),
      creationLocked: Boolean(state.creationLocked),
      updatedAt: Date.now()
    };
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, STATE_FILE);
    return payload.updatedAt;
  } catch (e) {
    console.log('[PHOENIX diagnostic] Could not persist server state: ' + e.message);
    return 0;
  }
}

/**
 * Write the state to BOTH copies.
 *
 * Never throws and never rejects: a failure to save the owner's switch must
 * not take the server down, and the switch itself has already been applied
 * in memory. The file is written first, so a database that is down still
 * leaves the change on disk.
 */
async function save(state) {
  const at = writeFile(state);
  if (!Auth.isConfigured()) return at;
  try {
    const { error } = await Auth.client().from(TABLE).upsert({
      key: ROW_KEY,
      multiplayer_open: Boolean(state.multiplayerOpen),
      creation_locked: Boolean(state.creationLocked),
      updated_at: new Date(at || Date.now()).toISOString()
    });
    if (error) {
      if (isMissingTable(error) && !_dbChecked) {
        _dbChecked = true;
        console.log('[PHOENIX state] the durable copy is not installed yet, so the ' +
          'owner\'s switches are kept on disk only.');
      }
      return at;
    }
  } catch (err) {
    console.log('[PHOENIX state] the durable copy could not be written -> ' +
      Auth.describeError(err));
  }
  return at;
}

module.exports = {
  STATE_FILE,
  defaults,
  load,
  save,
  readFile,
  readDatabase
};
