/* PHOENIX — Phase 2 server-side badge logic.
 *
 * Every rule here is enforced on the SERVER and, for THE PHOENIX, a second
 * time in the database (see sql/phase2-badges.sql). Nothing in this file ever
 * consults a username to decide who the owner is: ownership is read from
 * accounts.role, which Phase 1 makes atomic and unique.
 *
 * Browser code only ever receives badge NAME / RARITY / DESCRIPTION straight
 * from the catalogue table. It never renders a badge from user-typed text.
 */
'use strict';

const Auth = require('./auth');

const PHOENIX_KEY = 'phoenix';
const MAX_FEATURED = 3;

/**
 * Badges the owner may hand to another player, by key.
 *
 * An ALLOWLIST rather than "whatever is in the catalogue": adding a badge to
 * the catalogue never makes it awardable, and THE PHOENIX is absent here by
 * construction, so no request - whatever it sends - can award the owner badge
 * through this route.
 */
const AWARDABLE_KEYS = ['played-with-owner'];

/** Is this key one the owner is allowed to award? Pure, so it is unit-tested. */
function isAwardable(key) {
  return typeof key === 'string' && AWARDABLE_KEYS.indexOf(key) !== -1;
}

// Rarity tiers, weakest first. Divine sits above Impossible on purpose.
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'impossible', 'divine'];

const BADGE_KEY_RE = /^[a-z0-9_-]{2,40}$/;

function logError(op, error) {
  Auth.describeError && console.error('[PHOENIX badges] ' + op + ' -> ' + Auth.describeError(error));
}

/**
 * Is the badge schema actually present?
 *
 * The migration is run by hand in Supabase, so a server can be deployed
 * before it. Missing tables must degrade to "badges unavailable" rather than
 * throwing on every request.
 */
function schemaMissing(error) {
  const code = error && error.code ? String(error.code) : '';
  return code === 'PGRST205' || code === '42P01' ||
    /could not find the table|relation .* does not exist/i.test((error && error.message) || '');
}

/* ---------- pure rules (unit-tested without a database) ------------------- */

/**
 * Decide the featured slots a player is allowed to end up with.
 *
 *   - at most three
 *   - no duplicates
 *   - every badge must actually be owned
 *   - THE PHOENIX is refused outright unless this account IS the owner
 *   - for the owner, slot 1 is re-asserted as THE PHOENIX, so it can never be
 *     unequipped no matter what the caller sends
 *
 * Returns { ok, slots } or { ok:false, message }.
 */
function validateFeatured(slots, ownedKeys, isOwner) {
  if (!Array.isArray(slots)) return { ok: false, message: 'That is not a valid badge list.' };
  if (slots.length > MAX_FEATURED) {
    return { ok: false, message: 'You can feature at most ' + MAX_FEATURED + ' badges.' };
  }

  const owned = new Set(Array.isArray(ownedKeys) ? ownedKeys : []);
  const seen = new Set();
  const out = [];

  for (const raw of slots) {
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw !== 'string' || !BADGE_KEY_RE.test(raw)) {
      return { ok: false, message: 'That is not a valid badge.' };
    }
    if (seen.has(raw)) {
      return { ok: false, message: 'A badge cannot be featured twice.' };
    }
    seen.add(raw);

    // The owner badge is checked FIRST, before ownership, so a player can
    // never even learn whether the key exists in their collection.
    if (raw === PHOENIX_KEY && !isOwner) {
      return { ok: false, message: 'That badge cannot be equipped.' };
    }
    if (!owned.has(raw)) {
      return { ok: false, message: 'You do not own that badge.' };
    }
    out.push(raw);
  }

  if (isOwner && out[0] !== PHOENIX_KEY) out.unshift(PHOENIX_KEY);
  if (out.length > MAX_FEATURED) out.length = MAX_FEATURED;

  return { ok: true, slots: out };
}

/* ---------- database access ----------------------------------------------- */

function isAvailable() {
  return Auth.isConfigured();
}

/** Give (and re-assert) THE PHOENIX for an owner account. No-op otherwise. */
async function ensureOwnerBadge(accountId) {
  const { error } = await Auth.client().rpc('ensure_owner_badge', { p_account: accountId });
  if (error) {
    // A missing function means the Phase 2 migration has not been run yet.
    if (!schemaMissing(error) && !/ensure_owner_badge/i.test(String(error.message))) {
      logError('ensure_owner_badge failed', error);
    }
    return false;
  }
  return true;
}

async function listCatalogue() {
  const { data, error } = await Auth.client()
    .from('badges')
    .select('key, name, rarity, description, sort_order')
    .order('sort_order', { ascending: true })
    .order('rarity', { ascending: true });
  if (error) throw error;
  return (data || []).map(b => ({
    key: b.key, name: b.name, rarity: b.rarity,
    description: b.description, divine: b.rarity === 'divine'
  }));
}

async function ownedKeys(accountId) {
  const { data, error } = await Auth.client()
    .from('account_badges').select('badge_key').eq('account_id', accountId);
  if (error) throw error;
  return (data || []).map(r => r.badge_key);
}

async function featuredRows(accountId) {
  const { data, error } = await Auth.client()
    .from('account_featured_badges').select('slot, badge_key').eq('account_id', accountId);
  if (error) throw error;
  return data || [];
}

/**
 * Find an account by username, ignoring case.
 *
 * Case cannot make this ambiguous: Phase 1's `accounts_username_lower` index
 * makes usernames unique ignoring case. `_` and `%` ARE legal characters in a
 * username but are LIKE wildcards, so they are escaped - otherwise searching
 * for `josh_1` could land on a different player entirely.
 *
 * Returns null when nothing matches. Callers must answer identically whether
 * the name was never taken or simply not found, so this cannot be used to
 * enumerate accounts.
 */
async function findAccount(username) {
  username = String(username || '').trim();
  if (!username) return null;

  const pattern = username.replace(/[\\%_]/g, c => '\\' + c);
  const { data, error } = await Auth.client()
    .from('accounts')
    .select('id, username, role')
    .ilike('username', pattern)
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

/** Project a public badge record. Only catalogue fields ever leave the server. */
function toPublicBadge(row) {
  return {
    key: row.key, name: row.name, rarity: row.rarity,
    description: row.description, divine: row.rarity === 'divine'
  };
}

/** Everything the signed-in player needs to render their own badge screen. */
async function getMine(account) {
  if (!isAvailable()) return { ok: false, available: false };

  if (account.role === 'owner') await ensureOwnerBadge(account.id);

  let catalogue, owned, featured;
  try {
    catalogue = await listCatalogue();
    owned = await ownedKeys(account.id);
    featured = await featuredRows(account.id);
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, available: false };
    logError('getMine failed', error);
    throw error;
  }

  const byKey = {};
  for (const b of catalogue) byKey[b.key] = b;

  const ownedPublic = owned.map(k => byKey[k]).filter(Boolean);
  const slots = [null, null, null];
  for (const row of featured) {
    if (row.slot >= 1 && row.slot <= 3 && byKey[row.badge_key]) {
      slots[row.slot - 1] = toPublicBadge(byKey[row.badge_key]);
    }
  }

  return {
    ok: true,
    available: true,
    isOwner: account.role === 'owner',
    maxFeatured: MAX_FEATURED,
    catalogue: catalogue,
    owned: ownedPublic,
    featured: slots,
    // What this account is ALLOWED to award, resolved against the catalogue.
    // Empty for everyone but the owner, and empty until the seed migration has
    // run - so the award panel simply does not appear when it should not.
    awardable: account.role === 'owner'
      ? catalogue.filter(b => isAwardable(b.key))
      : []
  };
}

/** Persist a player's three featured slots. Returns the new slot layout. */
async function setFeatured(account, slots) {
  if (!isAvailable()) return { ok: false, available: false };

  // Always re-assert the owner badge first, so a caller can never win a race
  // against the invariant that THE PHOENIX is featured.
  if (account.role === 'owner') await ensureOwnerBadge(account.id);

  let owned;
  try {
    owned = await ownedKeys(account.id);
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, available: false };
    throw error;
  }

  const decision = validateFeatured(slots, owned, account.role === 'owner');
  if (!decision.ok) return { ok: false, message: decision.message };

  const target = [];
  for (let i = 0; i < MAX_FEATURED; i++) target[i] = decision.slots[i] || null;

  // Write only the slots that actually need to change.
  for (let i = 0; i < MAX_FEATURED; i++) {
    const want = target[i];
    if (want) {
      const { error } = await Auth.client()
        .from('account_featured_badges')
        .upsert({ account_id: account.id, slot: i + 1, badge_key: want },
                { onConflict: 'account_id,slot' });
      if (error) { logError('setFeatured upsert failed', error); throw error; }
    } else {
      // Slot 1 is THE PHOENIX for the owner and is blocked by the database.
      if (account.role === 'owner' && i === 0) continue;
      const { error } = await Auth.client()
        .from('account_featured_badges')
        .delete()
        .eq('account_id', account.id).eq('slot', i + 1);
      if (error) { logError('setFeatured delete failed', error); throw error; }
    }
  }

  const fresh = await getMine(account);
  return fresh.ok ? { ok: true, available: true, isOwner: fresh.isOwner, featured: fresh.featured }
                  : { ok: false, available: false };
}

/**
 * A PUBLIC view of one player's featured badges, looked up by username.
 *
 * Only catalogue-supplied name / rarity / description are returned, plus a
 * server-derived isOwner flag. That flag is what the impersonation notice
 * tells players to trust - it comes from accounts.role, never from input.
 */
async function getProfile(username) {
  if (!isAvailable()) return { ok: false, available: false };

  if (!String(username || '').trim()) return { ok: false, message: 'Enter a username.' };

  const account = await findAccount(username);
  // Same answer whether the account exists or not: no username enumeration.
  if (!account) return { ok: false, message: 'No player with that username.' };

  if (account.role === 'owner') await ensureOwnerBadge(account.id);

  let catalogue, featured;
  try {
    catalogue = await listCatalogue();
    featured = await featuredRows(account.id);
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, available: false };
    throw error;
  }

  const byKey = {};
  for (const b of catalogue) byKey[b.key] = b;

  const slots = [null, null, null];
  for (const row of featured) {
    if (row.slot >= 1 && row.slot <= 3 && byKey[row.badge_key]) {
      slots[row.slot - 1] = toPublicBadge(byKey[row.badge_key]);
    }
  }

  return {
    ok: true,
    available: true,
    profile: {
      username: account.username,
      isOwner: account.role === 'owner',
      featured: slots
    }
  };
}

/**
 * Award an ALLOWLISTED badge to a player, found by username.
 *
 * OWNER ONLY, and the role is checked before anything at all is looked up, so
 * this endpoint cannot be turned into a username oracle by a non-owner.
 *
 * THE PHOENIX can never travel this way: the key has to be on AWARDABLE_KEYS
 * to get past step two, and that list does not contain it. No request-crafting
 * changes that - it is decided in code, not taken from the payload.
 *
 * Awarding twice is not an error. It is the same grant, and the table's
 * primary key already makes it idempotent, so the caller gets a plain success
 * either way.
 */
async function awardBadge(account, username, badgeKey) {
  if (!isAvailable()) return { ok: false, available: false };

  // 1. Role, before any read. Everything below is owner-only work.
  if (!account || account.role !== 'owner') {
    return { ok: false, status: 403,
             message: 'Only the owner of PHOENIX can award badges.' };
  }

  // 2. Allowlist. Refused before the catalogue is even opened, so a bad key
  //    costs one comparison and reveals nothing about what exists.
  if (!isAwardable(badgeKey)) {
    return { ok: false, status: 400, message: 'That badge cannot be awarded.' };
  }

  let catalogue;
  try {
    catalogue = await listCatalogue();
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, available: false };
    logError('awardBadge catalogue failed', error);
    throw error;
  }

  const badge = catalogue.filter(b => b.key === badgeKey)[0];
  if (!badge) {
    // The badge seed migration has not been run yet. Say so plainly instead of
    // failing on a foreign key nobody can read.
    return { ok: false, status: 404,
             message: 'That badge is not available on this server yet.' };
  }

  const target = await findAccount(username);
  if (!target) {
    return { ok: false, status: 404, message: 'No player with that username.' };
  }

  let held;
  try {
    held = await ownedKeys(target.id);
  } catch (error) {
    if (schemaMissing(error)) return { ok: false, available: false };
    throw error;
  }

  const alreadyHad = held.indexOf(badgeKey) !== -1;

  if (!alreadyHad) {
    const { error } = await Auth.client()
      .from('account_badges')
      .insert({ account_id: target.id, badge_key: badgeKey });
    if (error) {
      // Somebody else awarded it in the same instant. The grant exists, which
      // is the only outcome that matters - otherwise this is a real failure.
      const again = await ownedKeys(target.id).catch(() => null);
      if (!again || again.indexOf(badgeKey) === -1) {
        logError('awardBadge insert failed', error);
        throw error;
      }
    }
  }

  return {
    ok: true,
    // The account's stored name, never the string that was typed in.
    username: target.username,
    alreadyHad: alreadyHad,
    badge: { key: badge.key, name: badge.name, rarity: badge.rarity,
             description: badge.description }
  };
}

/**
 * A compact, safe projection of one account's FEATURED badges, for attaching
 * to a match snapshot.
 *
 * Deliberately separate from getMine(): this runs during connection setup, so
 * it must be cheap, and it must NEVER throw. Badges are decoration - a
 * database hiccup must not stop someone joining a room or playing a match, so
 * any failure degrades to "no badges" and is logged instead of propagated.
 *
 * Only `key` / `name` / `rarity` ever leave this function. All three come from
 * the badges catalogue, never from anything a player typed, so a match screen
 * cannot be made to render user-controlled text as a badge.
 */
async function featuredBadges(account) {
  if (!account || !isAvailable()) return [];

  try {
    if (account.role === 'owner') await ensureOwnerBadge(account.id);

    const catalogue = await listCatalogue();
    const featured = await featuredRows(account.id);

    const byKey = {};
    for (const b of catalogue) byKey[b.key] = b;

    // Slot order, then only slots 1..3 that resolve to a real badge.
    const out = [];
    for (let slot = 1; slot <= MAX_FEATURED; slot++) {
      const row = featured.find(r => Number(r.slot) === slot);
      const badge = row && byKey[row.badge_key];
      if (badge) {
        out.push({ key: badge.key, name: badge.name, rarity: badge.rarity });
      }
    }
    return out;
  } catch (error) {
    logError('featuredBadges failed (continuing without badges)', error);
    return [];
  }
}

module.exports = {
  PHOENIX_KEY, MAX_FEATURED, RARITY_ORDER, AWARDABLE_KEYS,
  isAvailable, validateFeatured, isAwardable,
  getMine, setFeatured, getProfile, ensureOwnerBadge, featuredBadges, awardBadge
};
