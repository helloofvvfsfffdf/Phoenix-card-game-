# Public/Private Multiplayer + Owner Controls — implementation notes

Started from clean baseline `00e045c` (working tree clean; 523+9+recovery tests passing).
Big Pickle scoped but wrote nothing before the usage limit.

Source of truth (decisions locked from user):
- Any VISITOR can create a public OR private lobby (no owner password). Public lobbies show
  in a public browser; private lobbies need an invite code.
- Room HOST (creator) controls their own lobby: Start, set rounds, Kick, Close.
- PHOENIX OWNER (server password) has a password-protected admin dashboard over the SAME ws:
  see all rooms (incl. private, counts only), shut down any single room, shut down ALL rooms,
  lock/unlock creation (existing matches + joins keep running while locked), reopen multiplayer.
- Global {multiplayerOpen, creationLocked} persisted to a gitignored state file; survives
  restarts, not redeploy (Render wipes disk on deploy).
- Owner & Friends / creator-only modes (Single Player, Multiplayer Testing, gallery) stay
  UNTOUCHED.
- SECURITY: every control verified server-side; no client-side privilege flag; public list
  never includes private-room codes; owner credentials never leave the admin ws auth;
  destructive admin actions use a confirm step.

## Stages
- [ ] Stage A: server.js (state + durability, open create w/ per-IP rate limit + visibility,
      lobby broadcast, join guard, host kick/close, admin auth + dashboard msgs, ws init +
      throttle, close handler host-transfer).
- [ ] Stage B: index.html + online-client.js + css (public/private create form, lobby
      browser, host kick/close UI, admin panel overlay + confirmations).
- [ ] Stage C: tests (update effects-network + browser checks for no-password create; add
      multiplayer-admin-tests.js covering public/private, host controls, admin powers,
      persistence, spoofing).
- [ ] Stage D: docs (ONLINE_MULTIPLAYER.md).
- [ ] Stage E: backup tag, commit, push, Render redeploy, live verify, report/rollback.

Progress is checkpointed via frequent commits on a feature branch `feat/public-multiplayer`.
