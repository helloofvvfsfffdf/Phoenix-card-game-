# PHOENIX Online — existing Render service update

This is an **in-place update** for the existing Render service:

`https://phoenix-card-game-1.onrender.com`

Do not create a Blueprint or a second Render service. No production secrets are
committed here.

## Existing service settings to verify

- Service type: Web Service
- Runtime: Node
- Build command: `npm ci` (or the existing equivalent `npm install`)
- Start command: `npm start`
- Node version: 20 or newer
- Health check path: `/`
- Auto-deploy: enabled only if the existing service is intended to deploy from
  the connected branch

Keep the current service URL and its existing environment variables. Never
replace the Supabase project or reset its database.

## Required environment variables

Verify these are already present in the existing service; do not print or
commit their values:

- `PHOENIX_OWNER_PASSWORD` — at least 24 characters.
- `PHOENIX_MODE_ACCESS_CODE` — 12–256 characters.
- `SUPABASE_URL` — the current production project.
- `SUPABASE_SERVICE_ROLE_KEY` — the current production service-role key.

## Database migration review

Definitely Not Amazon is in-memory and requires **no database migration**.
Existing accounts, progress, badges and multiplayer records remain untouched.

Before release, compare the production Supabase migration history with the
repository. If the earlier achievement work was not applied, review and apply
`sql/card-achievements.sql` using the existing migration process. Do not rerun
destructive or foundational migrations against the production database.

## Safe in-place release sequence

1. Run `npm ci` and `npm test` locally.
2. Commit/push the changes to the branch already connected to the existing
   Render service. Do not change the service name or URL.
3. Watch the existing Render deploy logs for startup/configuration errors.
4. Confirm the service remains healthy at `/`.
5. Confirm `shopping.html?demo=1` loads and the live challenge route opens from
   a real match.
6. Confirm multiplayer uses `wss://` through the existing HTTPS URL.
7. Confirm existing accounts, badges, progress and Supabase-backed endpoints.

The corrected production URL currently serves the older PHOENIX build: its page
still reports the old card catalogue and `/shopping.html` currently returns
404. Deploy the latest files to this existing service; do not create another
service. The Render dashboard must be checked after deployment before release
is considered complete.

## Database and accounts

Run the existing SQL migrations in the production Supabase project before
opening accounts or badges. The shopping challenge itself is in-memory and does
not require a new migration; active challenges are intentionally not persisted.

## Production checks

After the first deploy, verify:

- `GET /` returns the PHOENIX menu.
- A public lobby can be created and joined over HTTPS/WSS.
- A Definitely Not Amazon challenge opens in a second tab.
- Typed PHOENIXBANK credentials are accepted only when correct.
- The Render logs contain no startup secret/configuration errors.

Do not paste production secrets into source files, screenshots, chat, or the
repository.
