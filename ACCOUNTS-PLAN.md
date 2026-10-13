# PHOENIX — Player Accounts (Phase 1) — Findings & Revised Plan

**Status: Phase 1 IMPLEMENTED (code complete, tests green). Awaiting Render
env vars + owner-claim seeding to go live.**
**Scope shipped: username + password only — recovery email deferred (see §7).**

## 0. What has actually been built

| Piece | File | State |
|---|---|---|
| DB schema (tables, `one_owner`, RLS, triggers, `claim_owner`) | `sql/phase1-accounts.sql` | **Executed by owner in Supabase** |
| Server auth library (bcrypt, sessions, cookies, claim) | `js/auth.js` | Done |
| REST endpoints `register` / `login` / `logout` / `me` / `claim-owner` | `server.js` | Done (throttled per IP) |
| WebSocket auth gate + owner auto-authorisation | `server.js` | Done |
| Sign-in / register screen (shown after the intro) | `js/account-client.js`, `css/account.css`, `index.html` | Done |
| Owner controls hidden from players; no password prompt for owner | `js/account-client.js`, `js/online-client.js` | Done |

**Verification:** `npm test` green (525 unit + 9 live + 55 multiplayer/admin).
Plus a 22-check end-to-end run covering register → cookie → session → WS gate →
owner claim → logout, executed against a local PostgREST stand-in.

**Graceful fallback:** when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are
absent (local dev, `npm test`), `/api/me` reports `available:false`, the sign-in
screen never appears, and the WS gate stays open exactly as before Phase 1. On
Render both vars exist, so the gate is enforced and no fallback applies.

**Still needed to go live:** the Render env vars and the one-time owner-claim
seed (§10). Recovery email and the full owner dashboard remain future work.


## 1. Requirement change

| Before | Now |
|---|---|
| Supabase Auth (email + password) | **Custom username + password** (no email required) |
| Email mandatory | Email **optional** recovery contact |
| — | Recovery email **must be verified** before it can reset a password |
| — | No recovery email → user clearly told recovery may be impossible |
| — | Emails **never publicly visible** |

**Hard constraint from the owner:** *Do NOT generate fake email addresses as a
workaround.* So the common "use the username as a fake @email for Supabase Auth"
trick is forbidden.

## 2. Why Supabase Auth is no longer the right tool

Supabase Auth's password provider **requires an email address or a phone number**
— it has no native username/password mode. The only way to force it to accept a
username is to invent an email the user never gave (e.g. `user@phoenix.invalid`),
which the owner explicitly forbade. Therefore:

- **Supabase Postgres = still used** (persistent database that survives Render).
- **Supabase Auth = NOT used.** Instead we run a **custom, server-side auth
  library** on top of Supabase Postgres.

This satisfies "use a suitable server-side authentication library if necessary"
and "use established authentication libraries."

## 3. Recommended architecture

**Custom server-side authentication on Supabase PostgreSQL.**

- **Password hashing:** `bcryptjs` (pure-JS bcrypt — the established standard,
  no native build issues on Windows/Render). Passwords are never stored or
  transmitted in plain text.
- **Sessions:** **opaque, server-side session tokens** stored in Postgres.
  The browser holds the token in an **httpOnly, Secure, SameSite=Lax cookie**.
  Server-side sessions are **revocable** (logout / reset deletes the row), which
  is more secure than a stateless JWT that lives until it expires.
- **Server validates auth** on every protected action — the client never decides.

### Why server-side sessions (not JWT)
- Revocable on logout/password reset/compromise.
- No token payload readable by the client.
- Fits the existing "one session per connection" `ws` model.

## 4. Database schema (Supabase Postgres)

```sql
-- Accounts. Stable unique id = the primary key.
create table accounts (
  id                  uuid primary key default gen_random_uuid(),
  username            text unique not null,
  password_hash       text not null,
  role                text not null default 'player' check (role in ('player','owner')),
  created_at          timestamptz not null default now(),
  -- Optional recovery email (never broadcast; only the owner sees it in settings).
  recovery_email          text,
  recovery_email_verified boolean not null default false,
  recovery_token_hash     text,           -- hashed, for verify / reset links
  recovery_token_expires  timestamptz,
  -- Reserved for future features (NOT implemented yet):
  badges       jsonb not null default '[]'::jsonb,   -- future: DIVINE "THE PHOENIX"
  achievements jsonb not null default '[]'::jsonb,   -- future
  stats        jsonb not null default '{}'::jsonb    -- future: owner dashboard
);

-- Hard guarantee: at most ONE owner account can ever exist.
create unique index one_owner on accounts (role) where role = 'owner';

-- Server-side sessions (revocable).
create table sessions (
  token_hash text primary key,                 -- sha256 of the opaque token
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
```

- `recovery_email` is **nullable** and **never** included in any lobby/room/state
  payload — only the account owner ever sees it in their own settings.
- `one_owner` makes a second owner **impossible at the database level**.

## 5. Auth flow

**Register** — `POST /api/register {username, password}`
- Validate username (3–22 chars, letters/digits/underscore, unique) and
  password (min 8 chars, basic strength rules).
- Hash with bcrypt → insert `accounts` row → create session → set httpOnly cookie.
- Clear messages on failure (e.g. "That username is taken", "Password too short").

**Login** — `POST /api/login {username, password}`
- Look up by username, bcrypt-verify the hash.
- On success: create session, set cookie. On failure: generic "Incorrect
  username or password" + **brute-force throttling** (reuse the existing
  `accessCodeRecord` rate-limit pattern).

**Logout** — `POST /api/logout` → delete the session row, clear the cookie.

**Session check** — the browser sends the cookie automatically; the server
resolves `session → account`. Returning players stay signed in (session persists
in the DB).

**WebSocket auth** — on WS upgrade the server reads the httpOnly session cookie,
looks up the session, and tags the connection `ws.account = {id, username, role}`.
`create`/`join` are **refused** unless `ws.account` exists. The display name is
taken from `ws.account.username`; the raw client name is ignored for logged-in
players. (The existing owner/admin `ws.admin` path is unchanged.)

## 6. Optional recovery email + verification

**Add a recovery email** (account settings) — `POST /api/account/recovery-email {email}`
- Store it as **unverified**, generate a random token (store only its **hash** +
  expiry), and email a verification link.
- Until verified, it cannot reset anything.

**Verify** — `GET /api/account/verify?token=…` — marks `recovery_email_verified=true`
and clears the token.

**Request reset** — `POST /api/account/recover {username}`
- Only sends a reset link if the account has a **verified** recovery email.
- If none / not verified: respond that recovery is not possible and **tell the
  user clearly** (this satisfies requirement 6).

**Reset password** — `POST /api/account/reset {token, newPassword}`
- Verify the token hash + expiry, update `password_hash`, delete all sessions
  (force re-login).

**Warning UI** — the register screen and account settings always show a clear
notice when there is **no verified recovery email**: *"Without a verified recovery
email, a forgotten password cannot be recovered."*

## 7. Email-sending dependency (important limitation)

Genuine verification/recovery **requires sending real emails** (to prove the user
owns the address). Supabase does **not** send email for custom auth, so an
**external transactional email service is required**:

- Free-tier options: **SendGrid** (100/day), **Resend** (100/day), **Mailgun**
  (trial), **AWS SES** (free tier from EC2).
- The server needs an API key + a verified sender address. The key lives only in
  Render env vars — never the repo or browser.

**Limitation to be aware of:** without an email service configured, the system
can still **store** a recovery email and show it as "pending verification", but it
cannot **send** the verification/reset email. Those two flows only become fully
functional once an email provider is connected. Everything else (accounts,
login, owner role) works without it.

## 8. Secure OWNER designation (unchanged from the approved discussion)

**One-time Owner Claim Token — server-side, never username-based:**
1. You generate a long random **setup key** → Render env var
   `PHOENIX_OWNER_SETUP_KEY` (server-only).
2. You **register a normal account** (username + password) like anyone else —
   you are a plain player at this point; ownership is **not** given to the first
   registrant and is **not** based on your username.
3. In a secure **"Claim Ownership"** area you enter the setup key.
4. The server checks: key matches **AND** no owner exists yet → sets your
   `role='owner'`, invalidates the key (one-time).
5. Stored in the DB → survives restarts/deployments. The `one_owner` index makes
   a second owner impossible.

## 9. Security summary

- **bcrypt** password hashing (never plain text).
- **Server-side auth validation** on every protected action; the client never
  decides authority.
- **httpOnly, Secure, SameSite=Lax session cookies** (JS cannot read the token).
- **Brute-force throttling** on login/register/claim (reuse the existing
  `accessCodeRecord` pattern).
- **Constant-time** token comparison; tokens stored only as **hashes** with
  expiry.
- **Emails never broadcast** — only the account owner sees their recovery email.
- **No secrets in the repo/browser** — Supabase keys, JWT secret, email key and
  owner setup key are all Render env vars.
- **Minimal data** collected: username + password only (email optional).

## 10. What YOU must set up

1. **Supabase project** (free) → Project URL, **anon key**, and the **service
   role key** (server-side DB access).
2. **Create the tables** (`accounts`, `sessions`) with the `one_owner` index —
   I'll give the exact SQL.
3. **Render env vars:**
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server DB access)
   - `SUPABASE_ANON_KEY` (browser; limited to non-sensitive tables)
   - `PHOENIX_OWNER_SETUP_KEY` (generated — I'll provide a command)
4. **(For email recovery) an email provider** — e.g. a free SendGrid/Resend
   account → API key + verified sender → Render env var `EMAIL_API_KEY`.

## 11. Implementation plan (once approved)

1. Add `bcryptjs` dependency; add auth helpers + rate limiting to `server.js`.
2. Add the REST endpoints (register/login/logout/me/recovery/claim-owner).
3. Add the WS auth gate + display-name-from-account.
4. Build the login/register screen (shown after the cinematic intro when logged
   out) and the account-settings screen with the recovery-email flow + warning.
5. Create the `accounts` + `sessions` tables in Supabase.
6. Set the Render env vars.
7. Tests + full `npm test` green.

## 12. Alternative (if you prefer not to run custom auth)

Keep Supabase Auth but make email optional is **not possible** (it requires
email/phone). The only way to get true username/password with optional email is
the custom server-side approach above. If you'd rather avoid an email provider
for now, we can ship accounts + login + owner first and add the verified-recovery
email flows later — the schema already reserves the columns.

---

**Waiting for your approval before writing any code.**
