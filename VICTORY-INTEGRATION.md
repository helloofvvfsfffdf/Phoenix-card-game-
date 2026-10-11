# Approved Effekseer victory — game integration

Branch: `feat/effekseer-victory-integration`, created from the clean local
`experiment/phoenix-fire-takeover` branch before editing. The prior work remains
at `10b9980`. No push, merge or deployment is performed.

## Same animation, not a redesign

The exact approved **Boss Death** binary and **Simple Turbulence Fireworks**
sample, their five referenced textures, **Effekseer 1.80.7** runtime and
**GSAP 3.15.0** are bundled in `assets/victory/`. Their hashes match the local
successful preview; no effect nodes, textures, resource values or binaries are
edited. Asset/runtime payload: **1,663,862 bytes (~1.59 MiB)**.

`js/victory-scene.js` preserves the tested camera, rendering target, viewport
cap, particle instance scales/positions, GSAP easing/stagger/durations, text
design and launch schedule:

| Time | Event |
| --- | --- |
| 0s | Boss Death orb/explosion, scale 2.8 |
| 3.15s | Stop opening; first fireworks, (0,3), scale 1.6 |
| 3.28s | Crest reveal |
| 3.42s | Eyebrow reveal |
| 3.58s | Staggered VICTORY lettering |
| 4.20s | Gold divider reveal |
| 4.28s | Fireworks (-11,3), scale 1.3 |
| 4.48s | Correct winner and ally reveal |
| 4.80s | Tagline reveal |
| 4.82s | Fireworks (11,5), scale 1.4 |
| 5.58s | Fireworks (-6,8), scale 1.2 |
| 6.20s | Fireworks (7,9), scale 1.3 |
| 6.80s | Champion phase |
| 7.00s | Return-to-results control reveal |
| 7.70s | Settle background halo |
| 9.70s | Sequence ends; normal results remain |

Only integration changes: scoped DOM/CSS, actual winner/ally text, local bundle
paths, single automatic play rather than a preview loop, Skip/Return-to-results
in place of prototype playback options, and lifecycle/failure cleanup.

## Trigger and identity

Multiplayer still uses the existing **observed active → finished authoritative
snapshot** cursor. It compares the confirmed winner ID with the viewer's seat
ID, not scores, local guesses, card animations or a fabricated effect message.
The winning viewer gets this sequence; opponents keep the subdued defeat stage.
Completed initial/reconnect snapshots are baselines, not celebrations. Repeated
or stale snapshots and disconnect resets cannot rearm a terminal stream.

The winner name and drafted ally come from the same confirmed public player
record as the existing result screen. They are rendered with `textContent`,
and only the six playable ally IDs are accepted. Private hands/log details are
not passed to the cinematic. No new network messages or game fields are added.

Local UI renders pass the actual engine state to a separate per-state completion
latch. The local human's selected ally and pass-and-play AI ally already shown
on the tester are reused; an AI with no assigned ally is not falsely given one.
Local ties don't produce a winning sequence. The local creator-mode UI has
pre-existing missing access-overlay/script/API wiring on this branch; that
unrelated access/authentication issue is not changed to facilitate this task.
Local lifecycle is covered by headless integration tests, not a claimed native
local-menu end-to-end pass.

The Phoenix-card takeover, if already running at the winning transition, finishes
first, then presents the queued winner identity. Music still restores immediately
on the actual match-end snapshot. Existing music/SFX settings, fanfare, controls,
cards, rules, private information, and ally implementation status are unchanged.

## Deployment, mobile and failures

- `index.html` includes local vendor scripts and scoped scene stylesheet.
- The existing static server allowlist gains only `.wasm`, `.efk`, `.efkefc`
  MIME entries; no gameplay, socket, authentication or winner logic changes.
- No local Downloads/temp path or CDN request occurs in production playback.
  The wasm URL and texture-relative paths point into committed game assets.
- The same tested 1440px long-edge / 1.25 DPR cap and WebGL2→WebGL fallback are
  retained. A single canvas/context renders only while the scene is active.
  Assets preload during active gameplay and cache for the page lifetime.
- Reduced motion uses the approved opacity-only GSAP announcement with no
  particle launches or rays. Visuals Off respects independent enabled SFX.
- Skip, Escape, leaving, disconnect and motion/preference changes
  cancel the active GSAP timeline/ticker, remove the canvas and stop sounds.
  Normal completion does the same at 9.7s. Page exit releases cached native
  effects/context; pending resource callbacks settle before native destruction.
- Hiding a player tab pauses an active victory rather than discarding it. The
  same particles/timeline resume on return without catch-up or repeated launches.
  A newly confirmed win received in a hidden tab waits for visibility; initial
  completed/reconnect snapshots still do not celebrate. Leaving cancels queued
  wins. Other transient card effects still stop when hidden.
- Runtime/download/GPU failure uses a static, correct winner/ally announcement,
  never changes game state, and has bounded loading/exit timers. Context loss is
  handled without replaying the orb or sending any gameplay command.
- Stage entry does not steal keyboard focus. Skip is keyboard accessible and
  returns focus to the existing result/game control if it held focus.

Licences and retained notices: `assets/victory/LICENSES.md` (CC0 samples, MIT
Effekseer, GSAP Standard No Charge licence—not MIT); hashes in `manifest.json`.

## Validation — 2026-10-11

- **468 headless tests passed**; **9 live multiplayer tests passed**. New checks
  cover exact effect/timing constants, bundled hashes/size, safe winner identity,
  local completion/ties, online winner/ally, defeat separation, duplicate/reconnect
  suppression, reduced motion, Skip/focus, preference changes and cleanup.
- `tests/victory-game-browser-check.js`: native isolated-profile Edge completed
  genuine three-player server matches (normal legal moves, no injected scores or
  forced result). Verified full **desktop** and **375×812 mobile-sized** wins:
  **JOSHUA & PHOENIX**, then **JOSHUA & TED**. Both rendered the Boss Death opening
  and all five fireworks launches at the tested times, animated the actual name/
  ally, and cleaned up at the end. Framebuffer pixels visibly changed; screenshots
  were reviewed. A third actual reduced-motion win and Skip also passed.
- Winner and both opponents received their correct viewer-specific result;
  repeated actual final snapshots did not replay; leaving stopped the stage;
  no JavaScript errors were recorded.
- An additional actual win exercised WebGL context loss: the correct winner/
  ally remained in a static fallback and leaving cleaned it up without errors.
- All ten bundled assets were fetched through the actual server and matched
  their manifest hashes; WASM had `application/wasm` MIME. `server.js` remained
  inaccessible (404), preserving the static server boundary.
- Existing `tests/cinematic-browser-check.js` passed: all **29** native Web Audio
  previews, real multiplayer/music lifecycle, desktop/mobile result layout,
  Skip, native reduced motion and no browser errors.

Run `npm test`. For native actual-game validation, start an isolated local server,
set `PHOENIX_BROWSER_URL` (default `http://localhost:3141`) and
`PHOENIX_BROWSER_OWNER_PASSWORD`, then run:
`node tests/victory-game-browser-check.js`.

Physical phones/tablets, iOS/Safari, low-end GPU frame rates and subjective
speaker/headphone listening are not tested by desktop viewport emulation.

## Follow-up: early disappearance / unavailable turn (2026-10-11)

Fix branch: `fix/victory-lifecycle-and-forced-choices`.

The owner reported a split-second appearance in PC Edge, without intentionally
switching tabs. That exact no-switch failure has **not** been reproduced. A
20-second idle period in a real match did not reproduce a GSAP sleep/timing
failure. Do not claim that the original report's cause is proven.

Two concrete lifecycle defects were corrected: hiding the active winner tab used
to cancel the stage, and a newly confirmed win arriving while hidden was discarded.
Both are now handled as described above. Stop diagnostics record reason, timeline
time, end phase, rendered frames and document visibility, and print
`[PHOENIX victory ended]` to the browser console without names, hands or codes.
`PhoenixVictoryScene.diagnostics()` retains the latest reason/time for diagnosis
if the owner sees the original early-dismissal problem again. Settings → Sound
Effects also shows `Last victory: <reason> at <time>s (<phase>)`, so a console is
not required to report an early dismissal. Effects, assets,
launch times and announcement animations are unchanged.

The reported Bob turn issue also remains unidentified from the report alone, but
investigation found and fixed real forced-choice defects:

- Maple's play restriction must not block the card **being destroyed** by Alvin.
  The old server/UI could grey out every destruction option if the chooser became
  restricted at a round boundary, deadlocking the outstanding choice.
- A stolen-turn move uses the **target's** Maple restriction, not an unrelated
  restriction on the chooser. Server options, UI restrictions and validation now
  use one shared `blockedForAction` helper. Normal play remains restricted.
- The turn banner and highlighted actor previously showed the ordinary current
  player (such as Bob) while a different player actually had the mandatory choice.
  They now identify the authoritative chooser and say whether they must destroy
  a card or choose a stolen-turn move. The non-chooser waits; authorization is
  not bypassed to let the wrong player act.

Validation: **475 headless + 9 live multiplayer tests passed**, including real
rule-generated Alvin/Steal-a-Turn choices and the actual snapshot/client functions.
Native Edge real-game checks passed a 20-second idle match, a separate-tab pause
of **11 seconds**, full resumed sequence, desktop/mobile viewport wins, reduced
motion, a real hidden-tab win queued until return, graphics-context-loss fallback,
duplicate suppression and cleanup. Stop diagnostics include both timeline time
and actual on-screen seconds (excluding paused time).
