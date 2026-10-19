# Multiplayer investigation — 18 October 2026

Follow-up: [seven-card test results](other-cards-test-results.md) records actual
server/browser failures for the other cards. The results below describe the
earlier investigation stage, not a claim that those seven cards now work.

## Release status

**Not release-ready. Local changes only; no push, Render deployment, reopening,
or production database operation was performed.** All eight unfinished cards
are excluded from live decks in the working copy. Fresh servers default closed;
an existing saved server-state file can still explicitly specify open. Production
service identity, deployment and maintenance state have not been verified.

## Reproduction and changes

- The actual browser socket handler built overlays but never forwarded snapshots
  to their `onState()` handlers. Nine regression checks failed before repair.
  Delivery, the missing state getter, card switching and disconnect cleanup are
  now covered by tests. These tests use module stubs, not complete minigames.
- The shared overlay/shell positioning styles were absent. Restored scoped,
  responsive modal styles; the browser check confirmed fixed positioning.
- A five-browser local Speed reproduction awarded 15,000 after two Ready clicks,
  before any countdown or GO. The server invented 300ms and 337ms reactions.
- Speed now starts in `ready`, waits for both players, uses a server-controlled
  countdown/random delay and GO, records server receipt times, and rejects
  client-reported reaction times. WebSocket ping/pong measures round-trip latency;
  compensation is capped at 250ms. False starts and missing reactions cannot
  produce a random winner. The countdown timer is cleared from its actual owner.
- A subsequent five-browser check drove the actual card, target, Ready and GO
  buttons against the local server. Both participants saw ready/countdown/GO;
  the server recorded 184ms and 469ms, awarded exactly 15,000 to the faster seat,
  advanced the turn and removed all five overlays. Spectator controls stayed
  hidden; no browser errors were captured. This was an automated UI check with
  fixture hands, NOT a complete match, human timing study or WAN/mobile test.
- Impostor snapshots now project only the receiving player's word and public
  clues after clue submission. Identity, all-word maps and secret vote values
  stay server-side. Submission lists are scoped to the current phase. This is
  a projection fix, not verification of the complete Impostor game.
- Fixed the integration waiter's missing-message indexing error. Removed the
  full-match driver's explicit Speed/Impostor exclusion; the ordinary match test
  currently uses the disabled-card live deck, so it still does not validate all
  22 cards. Open test instances use isolated state files, not production state.

## One-copy-per-hand rule

Requested during this investigation and implemented in the shared rules engine:

- Dealing, normal draws and Phoenix redraws cannot add a held card type.
- Skipped duplicates remain in the deck. If the deck has no different type but
  the discard does, both piles are reshuffled together without losing cards.
- If neither pile can supply a different type, the draw returns no card rather
  than duplicating or looping. Playing a type permits drawing it again later.
- Phoenix ally theft selects only types missing from the recipient's hand. If
  the chosen victim has none, both hands remain unchanged. The shared transfer
  helper refuses duplicate ownership.
- No persistent accounts, inventory, statistics or leaderboards were modified.

## Test results on the final working copy

`npm test` **fails**. It is not an all-green run.

| Check | Result |
| --- | --- |
| Unique-hand checks | 9 passed; 100 repeated-draw seeds, 2–5-player deals, redraws, theft and conservation |
| Interaction regression checks | 15 passed; delivery/projection/Speed unit checks, not all-card gameplay |
| Five-socket Speed flow | Ready does not score; server GO and real submissions award once; two false starts award nothing |
| Main unit suite | 571 passed |
| Three-player effects network suite | 9 passed |
| Multiplayer/admin suite | 57 passed, including unique hands in every five-player match snapshot |
| Badge suite | 26 passed, 31 failed; first account/session setup fails and dependent checks cascade |

The chained npm command stops at badges. Independently run later checks also
reported announcement failures (9 passed, 17 failed) and leaderboard failures
(10 passed, 7 failed), starting with missing sessions. The separate victory
recovery script exited successfully. These authentication failures have not
been classified as pre-existing or fixed.

Reproduce locally:

```text
node tests/unique-hand-tests.js
node tests/interactive-regression-tests.js
node tests/speed-flow-check.js
node tests/interactive-local-server.js speed 4318
```

The last command is a disposable fixture server: it removes Supabase credentials,
uses temporary state and enables only the selected unfinished card in its own
process. Its synthetic hands are not a conservation/full-match test. Never use
this entry point for deployment. The investigation's browser fixture was stopped.

## Remaining release blockers

- Complete browser-verified flows, scoring and results for the other seven cards.
- Impostor input preservation, secret voting/reveal, phase timeouts and enabled
  participant eligibility; privacy projection alone is not sufficient.
- Durable authoritative result delivery to dice/wheel/result animations.
- Linked Fate reward propagation/duration and Ally Swapper's actual member allies.
- Wheel outcomes, acknowledgments, reversed turns and permanent restrictions.
- Speed WAN fairness, mobile input, focus/background behavior, reconnection and
  timeout coverage beyond unit fallback cases. The existing foreground JSON ping
  listener is not a verified resynchronization mechanism.
- Missing new-card particle binaries and unverified sound/visual polish.
- Fix account-related test failures; exercise all 22 cards, allies, 2–5 players
  and many complete matches before any release claim or deployment.
