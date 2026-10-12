# Public Multiplayer + Owner Controls — implementation notes

Started from clean baseline `00e045c` (working tree clean; 523+9+recovery tests passing).

Source of truth (decisions locked from user):
- Any VISITOR can create a lobby (no owner password). CREATE LOBBY takes an OPTIONAL
  invite code: blank = public (auto 6-char code, listed in the public browser);
  a 3-6 char code = private (hidden, joinable only with that exact code). The old
  PUBLIC/PRIVATE radio was removed.
- Room HOST (creator) controls their own lobby: Start, set rounds, Kick, Close.
- PHOENIX OWNER (server password) has a password-protected admin dashboard over the SAME ws:
  see all rooms (incl. private, counts only), shut down any single room, shut down ALL rooms,
  lock/unlock creation (existing matches + joins keep running while locked), reopen multiplayer.
- Global {multiplayerOpen, creationLocked} persisted to a gitignored state file; survives
  restarts, not redeploy (Render wipes disk on deploy).
- PUBLIC VERSION allies: emoji + randomly generated animal names, re-rolled EVERY match,
  decided by the SERVER so every player sees the same creatures; abilities unchanged. The
  public screens must never render a portrait or a catalogue name.
- Owner & Friends is ALSO an online mode again (Stage H): password-gated private rooms with
  the real allies, never listed, never sent publicAllies. Single Player, Multiplayer Testing
  and gallery keep the real portraits + names (they never receive the public map).
- SECURITY: every control verified server-side; no client-side privilege flag; public list
  never includes private-room codes; owner credentials never leave the admin ws auth;
  destructive admin actions use a confirm step.

## Public ally identities (design)

- server.js generates `room.publicAllies = { <id>: {name, emoji} }` for the six draftable
  allies + maple at room creation (unique names, unique emojis) and includes the map in
  EVERY `state` message. `allyShown(room,id)` is the single source for shared text.
- All server-generated text (draft "chose X", Phoenix/Ted/Maple logs, the Maple play-block
  error) goes through `allyShown`, so the log never prints a catalogue name.
- online-client.js `allyInfo()` prefers the public name/emoji and substitutes catalogue
  names inside ability descriptions with the room's public names (abilities read the same,
  no real names). Draft + victory render an emoji span (no `<img>`), seats + log use the
  public name. effects-client.js captions ally effects with the public name; victory-scene.js
  prints `winner.allyName` when present.
- Owner modes send no `publicAllies`, so every fallback keeps the real catalogue unchanged.

## Stages
- [x] Stage A: server.js (state + durability, open create w/ per-IP rate limit + optional
      invite code, lobby broadcast, join guard, host kick/close, admin auth + dashboard msgs,
      ws init + throttle, close handler host-transfer; admin dispatch moved BEFORE the
      ws.member gate so admin_auth works without being in a room).
- [x] Stage B: index.html + online-client.js (optional-code create form, lobby browser,
      host kick/close UI, admin panel overlay + confirmations).
- [x] Stage C: public ally identities — server map + publicised server text; client public
      rendering (draft/seats/log/maple/victory/effects/victory-scene) with owner fallbacks.
- [x] Stage D: tests — multiplayer-admin-tests.js now 41 tests (blank-code public, custom
      private code, invalid/duplicate code, public identity map uniqueness/consistency/no
      leak, fresh draft log); match-showcase-tests.js adds two PUBLIC rendering tests;
      effects-network-tests.js updated for the code protocol. ALL PASSING.
- [x] Stage E: docs (ONLINE_MULTIPLAYER.md updated for optional codes + public allies);
      full npm test green (525 unit + 9 live + 41 admin + victory-recovery).
- [x] Stage F: committed 0a1d1c6 + pushed origin/main; Render redeployed; live verified on
      https://phoenix-card-game.onrender.com — new create form (0 radios, optional code +
      hint), blank=public listed / custom=private hidden / invalid + duplicate refused /
      join by custom code works, per-room publicAllies unique + identical for all players +
      no name/portrait leak, and a real 2-player UI match showed emoji draft tiles (no img),
      seats "Ally: Viper"/"Ally: Raven", ability text "block Viper", and a log reading
      "chose Viper"/"Raven blocked Viper's theft" with no catalogue name on either client.
- [x] Stage G: the "leaving a lobby" bug — on the live host the client's WebSocket close frame
      was delayed ~10s by the proxy, so a lobby the player had already left stayed listed.
      The browser now sends an explicit `{type:'leave'}` before closing (delivered instantly)
      and the server removes the member through one shared `leaveRoom()` used by both the
      leave message and the close handler (backstop). `lobbySnapshot()` lists only
      `phase==='lobby'` rooms (a started match is no longer advertised as joinable), the
      start handler refreshes the lobby, and the admin logout fixed an undeclared variable.
      Added 7 tests incl. explicit leave, drop backstop, started-match hidden + kept for the
      grace window (48 admin tests). Committed d1a291f + pushed; Render redeployed.
- [x] Stage H: restore the original **Owner & Friends** online mode as a separate mode on the
      ONLINE MULTIPLAYER screen (user request: the public feature had replaced it).
      - server.create branches on a non-empty `ownerPassword`: password-validated create
        makes a PRIVATE owner room (`mode:'owner'`, auto code, NO `publicAllies`, never
        `broadcastLobby`ed, still gated by multiplayerOpen/creationLocked, owner-password
        IP lockout shared with the admin dashboard). Empty/missing password = the public
        path, unchanged. `snapshot()` and `admin_rooms` carry `mode`.
      - client: `join('ownerCreate')`/`join('ownerJoin')` read the owner panel fields and
        send the password; `setMode()` switches PUBLIC MULTIPLAYER / OWNER & FRIENDS tabs;
        room heading shows an OWNER & FRIENDS / PUBLIC MULTIPLAYER badge. Existing public
        IDs and behaviour untouched (all public tests unchanged).
      - isolation is structural: owner rooms have no `publicAllies` (client renders real
        portraits/names/abilities via the existing owner fallback) and `visibility:'private'`
        keeps them out of `lobbySnapshot`.
      - tests: 7 new Owner & Friends checks (wrong password refused, owner room private+no
        publicAllies, hidden from browser, join by code + real ally ids, owner log uses real
        names, no publicAllies mid-draft) → 55 admin tests. Full npm test green.
- [x] Stage I: an **OWNER DASHBOARD** option on the main menu (user request: the admin
      dashboard existed but was only reachable from inside the multiplayer screen, and was
      effectively invisible on the website). Added `#menu-owner` to the main menu; it and the
      multiplayer SERVER button both call one `PhoenixOnline.openAdmin()` that prompts for the
      password and sends `admin_auth`. The panel is STILL revealed only when the server answers
      `admin_state` — so the menu option is password-gated at the server, not in the client (and
      the existing per-IP lockout applies). Opening from the menu hides the menu and scrolls the
      panel to the top; Logout restores the menu. Wrong-password/lockout errors are surfaced on
      `#menu-feedback` (the multiplayer feedback line is hidden on the menu). No new CSS — the
      user asked not to style it. Full npm test still green (525 unit + 9 live + 55 admin +
      victory-recovery).

Progress is checkpointed via frequent commits on `main` (Render auto-deploys on push).
