/* PHOENIX - wins and the leaderboard.
 *
 * A win is a fact about one finished match: this player, that match, once.
 * It is written here by the server when a match ends, and it is never taken
 * from anything a browser says - the account is read from the session the
 * socket authenticated with at the moment it connected.
 *
 * PLAYERS ONLY. The owner is never ranked. That is applied three times over so
 * it cannot be lost by any single change: an owner account is refused here
 * before anything is written, the query asks for players only, and the pure
 * rank() rule filters on role again on the way out.
 *
 * There is no running total to keep honest. The leaderboard is counted from
 * the rows themselves each time it is read, so it cannot drift out of step
 * with the matches that were actually won.
 */
'use strict';

const Auth = require('./auth');
const Badges = require('./badges');

/** A cap on one read of the win table. Enough for a very long-running server,
 *  and a guard against ever asking for the whole table at once. */
const MAX_WINS_READ = 5000;

function logError(op, error) {
  Auth.describeError && console.error('[PHOENIX wins] ' + op + ' -> ' + Auth.describeError(error));
}

/**
 * Is the migration actually present?
 *
 * sql/leaderboard.sql is run by hand in Supabase, so a server can be deployed
 * before it. A missing table has to degrade to "unavailable" rather than
 * throwing at the end of someone's match.
 */
function schemaMissing(error) {
  const code = error && error.code ? String(error.code) : '';
  return code === 'PGRST205' || code === '42P01' ||
    /could not find the table|relation .* does not exist/i.test((error && error.message) || '');
}

function isAvailable() { return Auth.isConfigured(); }

/**
 * Turn the raw rows into a ranked table. Pure, so the ordering rule can be
 * read and tested without a database anywhere near it.
 *
 * RULES, in order:
 *   - only accounts whose role is 'player' are considered, so the owner is
 *     never ranked whatever this is handed;
 *   - only players with at least one win appear, because a board listing every
 *     registered account is a member list wearing a leaderboard's clothes;
 *   - most wins first, and equal scores are broken by username so the order is
 *     stable and nobody can nudge themselves up by joining first.
 *
 * @param {Array<{id, username, role}>} accounts every account
 * @param {Array<{account_id}>}         wins     one row per match won
 * @returns {Array<{rank, username, wins}>}
 */
function rank(accounts, wins) {
  const counts = new Map();

  (Array.isArray(wins) ? wins : []).forEach(row => {
    if (!row || !row.account_id) return;
    counts.set(row.account_id, (counts.get(row.account_id) || 0) + 1);
  });

  return (Array.isArray(accounts) ? accounts : [])
    .filter(a => a && a.role === 'player')
    .map(a => ({
      username: String(a.username || ''),
      wins: counts.get(a.id) || 0
    }))
    .filter(p => p.wins > 0)
    .sort((a, b) => b.wins - a.wins || a.username.localeCompare(b.username))
    .map((p, index) => ({ rank: index + 1, username: p.username, wins: p.wins }));
}

/**
 * Hand over the badge that comes with a win, and pass the result through.
 *
 * Awarded here, in the same breath as the win itself, rather than at the call
 * site - so any path that ever counts a win hands the badge out, and none of
 * them can forget to. The grant is idempotent too, so a match reported twice
 * cannot hand it out twice.
 *
 * Badges are decoration. If handing one over fails, the win still stands and
 * the player is still told nothing went wrong.
 */
function withWinBadge(account, result) {
  return Badges.grant(account, Badges.WIN_BADGE_KEY)
    .then(() => result)
    .catch(err => {
      logError('could not award the win badge ->', err);
      return result;
    });
}

/**
 * Count that `account` won the match named `matchId`.
 *
 * Fire-and-forget from the match path: this never delays a snapshot, and a
 * failure to write a ledger row leaves the match itself completely untouched.
 *
 * A second report of the same match is not an error and not a second win - the
 * primary key on (match_id, account_id) is what makes a win count once. It is
 * also not a second badge, because the grant is idempotent by the same rule.
 */
async function recordWin(matchId, account) {
  if (!isAvailable()) return { ok: false, available: false };

  // A server with no account system (local testing) keeps no records at all.
  if (!account || !account.id) {
    return { ok: true, skipped: true, reason: 'no-account' };
  }

  // The owner plays like anyone else, but the owner is not ranked - so their
  // wins are never written down in the first place. They hold every badge
  // there is anyway, by sql/champion-badge.sql.
  if (account.role !== 'player') {
    return { ok: true, skipped: true, reason: 'not-a-player' };
  }

  const id = String(matchId || '').trim();
  if (!id) {
    return { ok: false, status: 400, message: 'That match has no id.' };
  }

  let error;
  try {
    const result = await Auth.client()
      .from('match_wins')
      .insert({ match_id: id, account_id: account.id });
    error = result && result.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    // The row is already there. That is the guard doing its job, not a fault:
    // the same match reported twice still counts as one win.
    if (String(error.code) === '23505') {
      return withWinBadge(account, { ok: true, alreadyCounted: true });
    }
    if (schemaMissing(error)) return { ok: false, available: false };
    logError('recordWin failed', error);
    throw error;
  }

  return withWinBadge(account, { ok: true });
}

/**
 * The leaderboard: players ranked by wins, best first.
 *
 * Public and read-only. Who won how much is the point of a leaderboard, so it
 * takes no session and answers the same signed in or not - but the only thing
 * that leaves the server is a rank, a username and a number, never an account
 * row, never a role, never a secret.
 *
 * When the migration has not been run this answers `available: false` rather
 * than failing.
 */
async function leaderboard() {
  if (!isAvailable()) return { ok: false, available: false };

  let accounts;
  let wins;

  try {
    const [found, counted] = await Promise.all([
      Auth.client().from('accounts').select('id, username, role').eq('role', 'player'),
      Auth.client().from('match_wins').select('account_id').limit(MAX_WINS_READ)
    ]);
    if (found.error) throw found.error;
    if (counted.error) throw counted.error;
    accounts = found.data || [];
    wins = counted.data || [];
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, available: false };
    logError('leaderboard failed', error);
    throw error;
  }

  return { ok: true, available: true, players: rank(accounts, wins) };
}

module.exports = {
  MAX_WINS_READ,
  isAvailable, rank, recordWin, leaderboard
};
