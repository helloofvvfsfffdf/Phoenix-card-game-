# Live showcase UI, confirmed dice, text-only ally seats

Branch: `feat/match-showcase-and-dice`, based on merged local `main` (`609e2fe`).

## Requested presentation

`css/match-showcase.css` applies the atelier's serif headings, dark glass-like
surfaces, grid floor, muted borders, card emblems and cinematic halo language to
the actual online/local match surfaces, with the requested purple tint. The real
table retains every player and all existing controls, hands, pile counts, logs,
rounds, targeting and mandatory choices. It is **not** a fictional demo table.

`js/match-showcase.js` adds GSAP phase entrances, authorized hand dealing, discard
flips, live-score count/pulse transitions and current-actor highlights. Existing
approved Effekseer card effects/GSAP choreography remain integrated. Cosmetics
never dispatch a move, disable play, choose a target or modify rules/state.
Score tweens are display-only and settle to the authoritative final score on
cleanup; their accessible label always reports that confirmed score.

SVG card emblems come from the approved showcase art. Only cards already rendered
with a legitimate `data-card` get decorated. Ted-concealed cards are not unmasked;
private revealed hands remain in the original authorized UI, never copied into
public presentation. No fictional scores or demo hands are added to matches.

## Ally display

- Online match seats and local testing player profiles no longer show ally photos.
- A player shows **Ally: Phoenix**, the existing ability title and the exact
  catalogue description from `js/allies.js`.
- Ally selection/drafting retains its pictures and ability descriptions.
- Existing gallery artwork and victory champion illustration are not profile
  avatars and remain intact. No animal images/assets are deleted.
- No ally mechanics, probabilities, dormant abilities or selection rules changed.

## Dice

Six physical CSS die faces with correct pips and GSAP 3-D tumbling land on the
server-confirmed integer. No client RNG, speculative result or sound is used.

The server adds a small public `dice.lastRoll` record: `id`, `phase`, `seat`,
`value`. It is written **after authorization**, separately from the existing
`dice.rolls` ordering logic, and survives a tied-group reset or final-roll phase
transition. Rolling/ties/draft ordering continue using the original rules.
Initial/reconnect baselines, stale/repeated IDs and hidden-tab events never
replay historical rolls. Animations do not gate the next player or draft.

Reduced mode shows a static confirmed die/result; Disabled skips it. Hiding,
leaving, disconnect, preference changes and page exit kill animations/timers.
Existing running older servers can animate observed ordinary roll changes as a
compatibility fallback, but **restart is needed** for the full final/tie-roll
record. Restart must be approved because it clears the user's in-memory rooms.

## Performance / result priority

No infinite UI animation, full-table blur, new particle runtime or sound asset.
Existing particle resolution/instance caps stay in force. Interpolation/tweens
are bounded and replaced on fresh snapshots; result presentation settles them
instead of animating the table behind victory. The victory sequence's approved
effects, launch labels, durations and announcement text are unchanged.

A regression check caught an opening callback at 0.200 s while later victory
launches were on schedule, matching the previously documented startup clock
jitter. `victory-scene.js` now synchronizes the public GSAP root ticker **while
its timeline is still paused**, before anchoring time zero. This is clock
synchronization, not altered timings or a relaxed test tolerance. The complete
real-game victory suite passed with the established 20-second warm-up afterward.
An additional no-warm-up attempt could not produce a browser-player win in seven
random real matches, so it did not establish full cold-start coverage.

## Validation

- **499 headless + 9 live multiplayer tests passed.** New tests cover public dice
  sanitization, baseline/duplicate handling, identical-number tie rerolls, all six
  faces/rotations, the actual server's final/tie resets, pictured drafting and
  text-only live ally labels with catalogue descriptions.
- `node tests/match-showcase-browser-check.js`: real server/native Edge passed
  both dice phases and final-roll transitions, correct rendered faces, purple
  match theme, SVG cards, pictured ally draft, text-only seats, actual card/target
  clicks, Settings, mobile overflow, reduced/off and cleanup. Screenshots are in
  `%LOCALAPPDATA%/Temp/opencode/phoenix-showcase-*.png`.
- `node tests/card-game-browser-check.js`: all **14 real card effects** visibly
  rendered across **5 complete five-player matches / 400 authorized moves**, with
  legitimately earned Phoenix, input pass-through and lifecycle checks.
- Existing native victory suite passed desktop/mobile real wins, exact launch
  timings, tab pause/resume, hidden finish, reduced motion, Skip and GPU fallback.

Native tests use isolated servers; the user's port-3000 rooms were not reset for
testing. No push, deploy or automatic merge into `main` is performed. Physical
mobile/Safari/low-end GPU measurements remain unverified. Existing music/SFX
preferences are preserved; no new sounds were added.

## Victory recovery follow-up

The user reported a text-only victory in Edge with Full Cinematics selected.
That specific tab's graphics diagnostic was unavailable, so its exact cause is
not established. Investigation found that failed victory prewarming cached a
rejected promise forever, and lost WebGL contexts were reused on later wins.
The renderer now retries failed prewarming after a five-second cooldown (to
avoid retries on every snapshot), permits an immediate retry on confirmed
victory, and recreates a lost context. Timed-out or cancelled loading callbacks
cannot make a stale renderer ready. Resource destruction remains deferred until
native asset callbacks settle. No match, timing, asset, audio or motion rules
were changed for this recovery fix.

Settings now includes the actual victory rendering/loading error when available.
`node tests/victory-recovery-check.js` covers transient load failure, bounded
retry, context recreation, late timeout completion and resource disposal.
The native victory regression now checks another real animated win after
context loss and another after an injected temporary asset failure.
The time-zero orb is launched synchronously before timeline playback (including
resume from an initially hidden loading state), rather than waiting for a late
first frame. The time-zero timeline callback is idempotent; effect timing and
the approved sequence are otherwise unchanged.

Validation after the follow-up: 499 headless tests, 9 multiplayer checks and
the new recovery checks pass. The expanded native Edge suite passed with
**zero warm-up**, including actual desktop/mobile wins, both recovery wins,
exact launch timings, visible moving particles, hidden-tab lifecycle and no JS
errors. Earlier attempts encountered an opening callback at 0.150 s before the
synchronous launch fix, accumulated test-room limits, and the former seven-match
random-win limit; these are not counted as passes. The real-match test now allows
twenty attempts to obtain a legitimate browser-player win, without forcing
scores or results. The user's port-3000 server was not restarted for this fix;
only front-end files changed, so a hard refresh loads it. Temporary recovery
servers on ports 3144/3145 were stopped after testing.

The user subsequently reported the same symptom on localhost:3000: a short
circle/“Phoenix rises” presentation followed by the normal trophy/ally results
panel, not the approved orb/fireworks scene. The exact cause remains unresolved;
successful isolated tests do not establish a fix for that user's browser tab.
Settings now has a silent **Test victory visuals** action using the real victory
scene without changing game state, and **Copy cinematic diagnostic** with loading
errors, effective/system motion, renderer state and the latest result-gateway
summary. Player identity, card-event history, room codes, hands and credentials
are excluded from the copied report. Renderer/effective-motion status appears
even if no victory successfully starts, and refreshes when Settings opens.
Validation: 500 headless + 9 multiplayer + recovery checks pass; native Edge
confirmed the actual silent preview and copyable sanitized diagnostic. A native
dice run concurrent with the headless suite missed its wall-clock sampling
window (GSAP time was 0.805 s at 1.3 s wall time); its independent rerun passed.
