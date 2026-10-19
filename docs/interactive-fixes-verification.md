# Interactive fixes and verification — 18 October 2026

## Outcome and release boundary

The previously reproduced seven-card server/UI failures were corrected locally
and retested. **The whole game is not release-ready.** No deployment, push,
production settings change, production database operation or reopening occurred.
All eight new cards remain excluded from public decks. Local maintenance defaults
remain closed; this report does not establish the current production state.

## Corrections

- **RPS:** tied choices clear submissions and allow another secret round on the
  same turn. Final choices and elimination are shown from authoritative results.
- **Betrayal:** the selected opponent participates; the second opponent must be
  legally targetable (including Ghost protection). Reveals use the actual choices,
  not hardcoded Share/Steal icons.
- **Dice:** ties allow fresh rolls; final numeric server rolls reach every client
  and drive the existing dice-cube animation. Acknowledgments do not unlock Roll.
- **Wheel:** only the caster can spin; one spin resolves without hidden spectator
  acknowledgments. Reshuffle recycles/shuffles the deck and discard without
  replacing hands. Reverse changes actual seat traversal and persists into later
  rounds, without granting a seat a second turn within its round. Animation lands
  on the server-selected segment rather than an independently random angle.
- **Linked Fate:** interactive prizes share 50% too, without recursive bonuses.
  Normal-card sharing now runs before turn advancement freezes final standings;
  a deterministic last-turn test verifies that the correct player wins.
- **Swapper:** exchanges the real drafted member allies used by snapshots and
  server ally abilities, rather than only unused player fields.
- **Impostor:** requires four enabled, eligible real seats; invalid, blank,
  oversized, self-target and nonexistent-target submissions are rejected. Draft
  input survives other players' updates; submitted inputs/votes stay locked;
  public clues display during voting. Completed results reveal identity/word pair
  without exposing secret ballots. Idle/incomplete games do not fabricate an
  escaping-impostor prize; submitted partial ballots count at the deadline.
- **Shared lifecycle:** resolved presentation data survives clearing the pending
  interaction. Results stay on screen with a Continue button, or dismiss after
  six seconds. Spectators have no active decision controls. Timers do not close a
  later instance of the same card, and disconnect/leave clears the overlay.
- **Cross-card rules:** all eight interactive cards now honour Curse after their
  effect resolves and update the actor's play counters. Steal a Turn launches a
  real interaction for the card owner instead of silently using simulated local
  resolvers. Alvin burns remain burns, not interaction starts.
- **Cleanup:** closing disconnected/mixed rooms tolerates null sockets and cancels
  pending interaction/countdown timers. This addresses the observed null-socket
  crash. The later blocker pass also implements reconnect, described below.

## Observed tests

| Test | Latest result | Scope |
| --- | --- | --- |
| Targeted socket interactions | **76 passed / 0 failed** | Actual disposable servers; original cases, 2–5 players where legal, nine Wheel outcomes via caster-only spins, ties/retries, scoring, input rejection, all-eight Curse/stolen-turn checks and final Linked Fate winner. Synthetic unique hands and branch RNG. |
| Browser normal flows | **470 passed / 0 failed** | Five actual game pages; all eight cards, RPS retry, UI choices, visible results and the viewport-fit gates (frame and overlay fit horizontally, every visible control ≥44px). Latest runs pass at desktop 380px frames and under phone emulation at 317–319px frames. The earlier seven-card result was 43/43. |
| Browser Dice tie/retry | **9 passed / 0 failed** | Separate controlled-RNG fixture; actual Roll controls, tie, retry and final prize/reveal. |
| Browser stolen-turn flows | **43 passed / 0 failed** | Seven cards through real Steal a Turn UI, five 320px-wide game frames, RPS retry included. |
| Actual elapsed deadlines | **10 passed / 0 failed** | Seven idle interactions, RPS/Dice tied retries and partial Impostor ballot. Unshortened 30/60/120-second timers. Limited no-fabricated-prize/partial-ballot scoring assertions. |
| Natural-deal matches | **4 passed / 0 failed** | Real local 20-round games with 2, 3, 4 and 5 players; no fixed Math.random, no full-hand injection, real allies/Maple. Latest runs: 37/80/95/106 actions. All 21 drawable card types occurred across the runs. |
| Reverse rounds | **14 passed / 0 failed** | Reverse at each possible active seat, 2–5 players; no duplicate turns and direction retained next round. |
| Overlay/privacy/Speed regressions | **18 passed / 0 failed** | Actual online message router in a browser test harness, result lifecycle and privacy/state-machine unit checks. |
| Cleanup regressions | **2 passed / 0 failed** | Actual extracted closeRoom function, null/mixed sockets and timer disposal; not a real ten-minute cleanup soak. |
| Unique hands | **9 passed / 0 failed** | Existing repeated-deal/draw/transfer/conservation checks. |
| Main unit suite | **571 passed / 0 failed** | Existing automated suite. |
| Effects-network / multiplayer-admin | **9 / 57 passed, no failures** | Existing socket suites. |
| Victory recovery | **Passed both scenarios** | Executed independently after the main command stopped at badges. |

Natural-match supply checks include deck, discard, destroyed cards and all active
hands; inactive seats' initial hands remain outside the public snapshot. Each
match also verifies duplicate-free visible hands, finite/nonnegative scores,
agreed completion and a winner with the highest final score. Seeing every
drawable type is **not** exhaustive all-22-card verification: legendary Phoenix
carryover/use, every ally proc/combination and every scoring branch are not proven
by these four matches. Natural matches were repeated during development; the
numbers above are the final run, not an accumulated pass count.

Browser automation invokes the actual game DOM buttons/input controls; it does
not inject snapshots or bypass gameplay with direct WebSocket sends. Five frames
share one desktop browser, so this is not five physical devices, human usability
testing, mobile touch verification, WAN fairness or background-tab testing.
The existing local fixtures do not access Supabase. All ten diagnostic tabs,
including their game frames, were closed after evidence was collected, and the
owned 4318/4319 fixtures were stopped so they cannot keep playing music.

## Follow-up blocker pass

- Legacy feature-test databases now correctly reject nonexistent email columns,
  matching the old production schema rather than falsely advertising migration.
  Their state files are isolated and their servers bind to loopback.
- Fixed a genuine server bug: the initial WebSocket verification decision now
  uses the same migration-aware status as later refreshes. Legacy accounts stay
  usable; migrated, unverified accounts still cannot play.
- Badges **57/57**, announcements **26/26**, leaderboard **17/17**, and modern
  email/security **42/42** passed. An existing full `npm test` run passed before
  extending its gates. A subsequent run exposed leaderboard fixture flakiness:
  natural matches can tie, and the win/badge ledger is asynchronous. The fixture
  now requests a decisive natural match and waits for actual persistence rather
  than assuming the first match always awards a win or the ledger writes inline.
  The expanded final command is being rechecked; do not substitute earlier passes
  for its result.
- Started seats have private, random 256-bit resume tokens, rotated on successful
  resume. Name/code alone cannot reclaim a seat; with accounts enabled the same
  authenticated account is also mandatory. Tokens never appear in another
  player's snapshot. Live seats and replayed/invalid tokens are rejected.
- Unexpected disconnect pauses gameplay and freezes interaction deadlines.
  Submitted choices/ballots survive; all players must return before resumption.
  Interrupted Speed rounds restart readiness and get a new server-owned GO.
  Five-second heartbeats detect silent loss after about 15–20 seconds. All-gone
  cleanup now measures abandonment from disconnect, not match creation time.
- Browser clients automatically reconnect with bounded backoff and use
  tab-scoped session storage to recover after reload. Leave clears the saved
  seat; server restarts do not restore in-memory matches. Foregrounding requests
  an authoritative snapshot. A partial table also expires after the ten-minute
  reconnect grace window (cleanup checks every minute); an expired resume is
  refused immediately. Closing an unfinished room does not record a win. The
  actual cleanup callback passes a modelled-clock cutoff regression, not a real
  ten-minute browser soak.
- Reconnect tests: **14/14** local socket cases, **5/5** authenticated-account
  cases, **10/10** real-browser checks. A further partial secret-ballot reconnect
  case and a stolen-turn chooser case have been added to the expanded default
  gate. Browser evidence includes
  automatic socket recovery, automatic page-refresh recovery, private-word and
  submitted-clue retention, visible pause, disabled actions and completing votes
  through real DOM controls. Not physical-device/WAN proof.
- Impostor now has separate **60-second clues and 60-second secret-ballot**
  deadlines. Missing clues become explicit placeholders, then voting opens with a
  fresh deadline; no ballots means no fabricated prize. A visible countdown uses
  the projected server deadline; pause/reconnect freezes and rearms the phase.
  Restored submissions remain locked. Updated unshortened timeouts **10/10** pass,
  including 120 seconds for a fully idle round and 60 seconds for a partial ballot.
- After these phase changes, targeted card sockets **76/76** and ordinary
  five-frame browser checks **43/43** pass again.

No production database was used and no authentication requirement was weakened.

## Mobile and touch pass

The game and all eight interactive overlays were made playable at phone-sized
viewports and verified with a dedicated driver, `tests/mobile-browser-check.js`
(`npm run test:mobile`, plus `npm run test:mobile:desktop` for the desktop
control run). It drives headless Edge with real device metrics — 375×812,
device-pixel-ratio 3, touch emulation with `Input.dispatchTouchEvent` — against
the disposable loopback fixture only. This supersedes the earlier
"mobile touch verification" gap for the automated scope below; it is still not
a physical-device test.

- **Layout.** A width-based mobile layer in `css/interactive.css` (after the
  reduced-motion block) fits every overlay at 320–430px: the Dice cube was
  refactored to a `--dice-size` custom property and shrinks to 74px; the Speed
  GO circle becomes a 124px touch target; RPS/Betrayal choice rows wrap and
  shrink; Impostor vote buttons stack full-width; the clue input stays ≥16px
  tall so iOS does not zoom, with a 44px minimum. Overlays respect notched
  safe areas via `env(safe-area-inset-*)` padding, and all shell
  buttons/inputs use `touch-action: manipulation` so a tap registers on first
  touch (no 300ms double-tap-zoom delay, no long-press text selection). A real
  gap this pass found: game-screen action buttons (`.online-primary`,
  `.online-move`, `#online-back`, `#online-copy`) sat at 41px tall outside the
  overlay shell; `css/online.css` now enforces `min-height: 44px`.
- **Gates in the ordinary harness.** `tests/other-cards-browser-check.html`
  renders responsive frames (`width: min(100%, 380px)`), so the same page
  yields 380px frames on desktop and ~317–319px frames under phone emulation.
  Every real overlay state now runs `viewportFit()` on every player: the frame
  must not scroll sideways, the overlay shell must fit with no internal
  horizontal scroll, every visible control must stay inside the frame, and
  every visible control must be ≥44px. Speed was added as the eighth card
  (Ready → server GO → both react → 15,000 points). These assertions are
  viewport-agnostic, so the same run proves desktop and phone layouts.
- **Real touch proof.** After the eight-card flows, the driver starts a manual
  two-player match and plays a full Speed Challenge through CDP touch taps on
  the real DOM controls: tap the Speed card, tap the target picker, both tap
  Ready (each confirmed by the server's per-phase `submitted` list), wait for
  the server-owned `react` phase, then both tap the GO circle. The server
  measured 387ms vs 433ms, awarded exactly 15,000 points, and the result text
  was visible in the overlay. Because the driver waits for the server GO
  before tapping, no tap can be a false start; the server independently
  measures reaction times.
- **Menu at phone size.** The real website (`/`) was checked at 375px after
  skipping the opening cinematic: no sideways scrolling and every menu action
  button ≥44px and inside the viewport.
- **Results.** Mobile run: **470/470** harness checks plus the touch Speed
  Challenge and menu checks, zero uncaught page errors. Desktop control run
  (`--desktop`, 1440×1080): **470/470** with 380px frames and the menu checks —
  the responsive work introduces no desktop regression. A natural Dice tie
  (1 in 6) was observed to fail the harness on one run; the harness now
  re-rolls natural ties like the forced-tie path instead of treating them as
  failures.

**Honest limits:** CDP emulation is not a physical phone. Real-device touch
latency, iOS Safari/Android browser differences, safe-area behaviour on an
actual notched device, thumb reach during live multiplayer, and 320px-wide
devices were not exercised on hardware. Evidence JSON and screenshots:
`phoenix-mobile-check.json` / `phoenix-desktop-check.json` and
`phoenix-mobile-*.png` under
`C:\Users\Joshua Hopkins\AppData\Local\Temp\opencode` (copies in
`docs/evidence/`).

## Remaining verification/polish

- Reconnect now exists and is locally tested. Longer interruption soaks, resumed
  ally-draft/final-round cases and real-time ten-minute expiry still need dedicated
  coverage. A stolen-turn forced chooser now has a dedicated local socket case.
- All 22 catalog cards now ship original compiled Effekseer 1.80.7 particle
  binaries built by `scripts/build-card-cinematics.js` (the eight interactive
  cards were added; proven shipped binaries are never recompiled without
  `FORCE_REBUILD=1`). Headless-Edge gallery validation renders actual particles
  for every card. The mobile/touch gap is now covered by emulation and synthetic
  touch as described above; remaining polish gaps are real physical devices,
  WAN latency, background tabs and accessibility/usability, which need dedicated
  gameplay checks.
- Legendary Phoenix carryover/use and exhaustive all-card/ally combinations are
  not established by the natural-match runs above.
- The correct production Render service, its current deployment/logs and actual
  production maintenance state have not been inspected or changed by this pass.
- No public release approval is implied by any passing local result.

## Reproduction/evidence

```text
npm test
npm run test:other-cards
npm run test:card-timeouts
npm run test:reconnect
npm run test:security
npm run test:mobile
npm run test:mobile:desktop
node tests/interactive-natural-match-tests.js
node tests/reverse-turn-tests.js
node tests/room-cleanup-regression-tests.js
node tests/victory-recovery-check.js
node tests/interactive-local-server.js all 4318 '0.1,0.8'
```

While that last disposable fixture is running, open
`http://127.0.0.1:4318/tests/other-cards-browser-check.html` for ordinary UI checks;
add `?forced=1` for stolen turns. For the Dice tie check use a separate fixture
with RNG `0.4,0.4,0.1,0.8`, page query `?diceTie=1`, and invoke
`runOtherCardBrowserChecks(['dice'])`. These are local test facilities, not a
production enablement API.

For the mobile pass, start `node tests/interactive-local-server.js all 4320`
and run `PHOENIX_BROWSER_URL=http://127.0.0.1:4320 node tests/mobile-browser-check.js`
(add `--desktop` for the desktop control run). The driver spawns its own
headless Edge against loopback only and refuses any non-loopback URL.

For the reconnect browser flow, load `tests/reconnect-browser-check.js` on that
same isolated browser-check page and call `runReconnectBrowserChecks()`. It closes
its player frames afterward to stop music. Do not run it concurrently with the
ordinary card checks.

Machine-readable final network/timeout/natural-match reports and console logs
are under `C:\Users\Joshua Hopkins\AppData\Local\Temp\opencode`:
`phoenix-other-cards-fixes-network.json`, `phoenix-fixes-timeouts.json`,
`phoenix-natural-matches.json`, `phoenix-fixes-full-test.log`,
`phoenix-fixes-announcements.log`, `phoenix-fixes-leaderboard.log`.
Follow-up evidence uses the `phoenix-blockers-` prefix in that same directory:
`full-test.log`, `badges.log`, `announcements.log`, `leaderboard.log`,
`security.log`, `reconnect.json`, `cards.json` and `timeouts.json`. The mobile
pass writes `phoenix-mobile-check.json`, `phoenix-desktop-check.json`,
`phoenix-mobile-*.png` and `phoenix-mobile-regression-full-test.log` in that
same directory, with the JSON and screenshots also copied to `docs/evidence/`.
