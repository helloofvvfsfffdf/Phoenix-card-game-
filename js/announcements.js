/* PHOENIX — server-side announcements.
 *
 * The owner posts a short message; it appears on the main menu and in an
 * archive covering the last 30 days. The owner can also take one down again
 * from the dashboard. Both are owner-only and are decided here from
 * accounts.role: posting is checked a second time in Postgres by the
 * `announcement_author_only` trigger (see sql/announcements.sql), and the
 * table itself is reachable by nobody but this server, so a delete has no way
 * in except through this file.
 *
 * Everything in this file is server-side. The browser only ever receives an
 * announcement's id, its words and the time it was posted, all of which come
 * from the table, and it always renders them with textContent rather than as
 * markup. The id is what names a post on the way back in to be deleted; it
 * identifies an announcement and nothing else, and it is worth nothing to
 * anyone who is not the owner, because this file asks for the role first.
 */
'use strict';

const Auth = require('./auth');

/** How far back the menu and the archive go. Older posts stay in the table. */
const WINDOW_DAYS = 30;

/** The whole post, in one line. Long enough for a real notice, short enough
 *  for the corner card on the main menu. */
const MAX_LENGTH = 400;

/** A cap on one read, so the archive cannot be asked for the entire table. */
const MAX_LISTED = 200;

/**
 * The shape of an announcement's id.
 *
 * A delete names one row, and it names it in the URL, so the id is checked
 * here before it goes anywhere near PostgREST. Anything else is not an
 * announcement - it is a mistake, or a guess, and it is refused as one.
 */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAnnouncementId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

function logError(op, error) {
  Auth.describeError && console.error('[PHOENIX announcements] ' + op + ' -> ' + Auth.describeError(error));
}

/**
 * Is the migration actually present?
 *
 * sql/announcements.sql is run by hand in Supabase, so a server can be
 * deployed before it. A missing table has to degrade to "unavailable" rather
 * than throwing on every visit to the menu.
 */
function schemaMissing(error) {
  const code = error && error.code ? String(error.code) : '';
  return code === 'PGRST205' || code === '42P01' ||
    /could not find the table|relation .* does not exist/i.test((error && error.message) || '');
}

function isAvailable() { return Auth.isConfigured(); }

/** Start of the readable window, as an ISO timestamp. */
function windowStart() {
  return new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();
}

/**
 * Collapse runs of whitespace and trim.
 *
 * The client sends a textarea, so a post can arrive carrying newlines, tabs or
 * a pile of blank lines. One tidy line is what the corner card is built for,
 * and this also makes a post of nothing but spaces an empty post rather than a
 * whitespace-only announcement.
 */
function cleanBody(body) {
  if (typeof body !== 'string') return '';
  return body.replace(/\s+/g, ' ').trim();
}

/**
 * The ONLY projection that leaves the server.
 *
 * Deliberately just the id that names this post, the words and when they were
 * posted: no account id, no username, no role. Nothing here can be used to
 * identify or impersonate anyone, and nothing here is text the visitor
 * supplied. The id is public on purpose - it names one announcement, so the
 * dashboard can point at the post it means - and it buys a stranger nothing,
 * because taking a post down asks for the owner's session before it looks at
 * the id at all.
 */
function toPublic(row) {
  return { id: row.id, body: row.body, createdAt: row.created_at };
}

/**
 * Every announcement from the last WINDOW_DAYS, newest first.
 *
 * Public and read-only: the newest post is meant for every visitor, so this
 * takes no session and answers identically whether or not anyone is signed in.
 *
 * When the migration has not been run this answers `available: false` rather
 * than failing, so the menu simply shows no announcement card.
 */
async function list() {
  if (!isAvailable()) return { ok: false, available: false };

  let rows;
  try {
    const result = await Auth.client()
      .from('announcements')
      .select('id, body, created_at')
      .gte('created_at', windowStart())
      .order('created_at', { ascending: false })
      .limit(MAX_LISTED);
    if (result.error) throw result.error;
    rows = result.data || [];
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, available: false };
    logError('list failed', error);
    throw error;
  }

  // The menu card shows the FIRST row, so the order is not left to the
  // database. Sorting here means that invariant holds wherever it is read.
  const announcements = rows.map(toPublic).sort(function (a, b) {
    return a.createdAt < b.createdAt ? 1 : (a.createdAt > b.createdAt ? -1 : 0);
  });

  return {
    ok: true,
    available: true,
    windowDays: WINDOW_DAYS,
    maxLength: MAX_LENGTH,
    announcements: announcements
  };
}

/**
 * Post an announcement.
 *
 * OWNER ONLY, and the role is checked before the text is even looked at, so a
 * non-owner gets the same answer whatever they send. Postgres enforces this a
 * second time through the announcement_author_only trigger, so a bug in this
 * file cannot let a non-owner write one either.
 *
 * The returned timestamp is stamped here, on the server, at the moment it was
 * accepted - never taken from the request.
 */
async function create(account, body) {
  if (!isAvailable()) return { ok: false, available: false };

  if (!account || account.role !== 'owner') {
    return { ok: false, status: 403,
             message: 'Only the owner of PHOENIX can post announcements.' };
  }

  const text = cleanBody(body);
  if (!text) {
    return { ok: false, status: 400, message: 'Write something first.' };
  }
  if (text.length > MAX_LENGTH) {
    return { ok: false, status: 400,
             message: 'Announcements are limited to ' + MAX_LENGTH + ' characters.' };
  }

  let error;
  try {
    const result = await Auth.client()
      .from('announcements')
      .insert({ account_id: account.id, body: text });
    error = result && result.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    if (schemaMissing(error)) return { ok: false, available: false };
    logError('create failed', error);
    throw error;
  }

  return {
    ok: true,
    announcement: { body: text, createdAt: new Date().toISOString() }
  };
}

/**
 * Take one announcement down.
 *
 * OWNER ONLY, checked before the id is even looked at, so a player gets the
 * same refusal whether they name a real post or a made-up id. It is the same
 * question the composer asks - may this session write to this table? - asked
 * once more on the way in, from accounts.role rather than from anything the
 * browser said about itself.
 *
 * Naming a row is the only thing the id does, and a non-owner never gets far
 * enough to use one. Nothing is cascaded or rewritten by this: one row of one
 * table goes, and every other announcement stays exactly where it is.
 */
async function remove(account, id) {
  if (!isAvailable()) return { ok: false, available: false };

  if (!account || account.role !== 'owner') {
    return { ok: false, status: 403,
             message: 'Only the owner of PHOENIX can delete announcements.' };
  }

  if (!isAnnouncementId(id)) {
    return { ok: false, status: 400, message: 'That is not an announcement.' };
  }

  let error, rows;
  try {
    const result = await Auth.client()
      .from('announcements')
      .delete()
      .eq('id', id)
      .select('id');
    error = result && result.error;
    rows = (result && result.data) || [];
  } catch (err) {
    error = err;
  }

  if (error) {
    if (schemaMissing(error)) return { ok: false, available: false };
    logError('remove failed', error);
    throw error;
  }

  // The id named nothing. Saying so is more useful than a shrug that looks
  // like it worked - the post was already gone, and the list is about to be
  // fetched again either way.
  if (!rows.length) {
    return { ok: false, status: 404, message: 'That announcement is no longer here.' };
  }

  return { ok: true, deleted: 1 };
}

module.exports = {
  WINDOW_DAYS, MAX_LENGTH, MAX_LISTED,
  isAvailable, isAnnouncementId, cleanBody, list, create, remove
};
