# Approved card cinematics during gameplay

The owner approved all fourteen gallery studies and requested merging
`feat/card-cinematics-preview` into local `main`, with real-game validation and
no new sound effects. Local `main` was an ancestor of the feature branch; no
divergent main edits/conflicts required manual resolution. The branch includes
the earlier victory integration and lifecycle/forced-choice fixes, preserving
that complete feature history rather than cherry-picking only preview files.

## Runtime integration

`js/card-cinematic-scene.js` adapts the exact approved effect binaries, colours,
emblems, durations and GSAP hero/card movements to a transparent match overlay.
It deliberately omits the gallery's invented scores, hand cards and player states.
Actual UI/state continue updating exclusively from the existing rules/server.
`js/card-cinematic-art.js` copies the approved SVGs; tests compare all fourteen
against the preview source. No effect binary or texture was re-exported/redesigned.

`js/effects-client.js` routes confirmed whitelisted card events to the adapter in
both online and local rules-event paths. Other ally effects retain their existing
presentation. Journal cursor/baseline/deduplication logic and server protocol are
unchanged. Nothing is triggered by speculative card selection or rejected moves.

- Public effect input remains only `key`, `actor`, `target`, `outcome`.
- Reveal/Alvin never paint an actual/private hand in the public cinematic; existing
  authorized choice UI still does its job without animation delays.
- Alvin inspection and confirmed one-card destruction are separate visual phases.
- Curse placement never identifies a specific card. Its confirmed trigger is
  queued behind the card's normal cinematic, not before normal resolution.
- Inert outcomes stop particles before destructive sublayers and explicitly say
  no change. Reflection retains unchanged-score wording from the actual rules.
- Audience-neutral actor wording avoids telling spectators that an opponent's
  gain belongs to them. Judge's unknown automatic recipient is never invented.
- Phoenix now uses the approved wing effect during matches; its finished result
  waits for that cinematic before the unchanged winner announcement. The existing
  Settings filmed-fire preview and silent website opening remain intact.

## Input, lifecycle and bounded work

The root and **every descendant** have `pointer-events:none`; no input lock,
disabled controls, focus grab, score edits, turn waits or mutations of live cards
or seats. The overlay is transparent and below Settings/result celebrations.
GSAP animates only disposable clones, not the real cards a player must click.

One card canvas/context, one active native effect, at most three cached binaries,
maximum 486 particles, ≤960-pixel largest buffer dimension, DPR ≤1.25, rendering
capped at 30 fps. New confirmed actions replace older transient presentation
rather than letting a stale backlog block play. Curse follow-up queue is capped
at two and clears on replacement/cleanup. Leaving, disconnect, preference changes,
hiding, Escape and page exit clean up, with finished/reconnect baselines never
replaying. Native resource destruction waits for in-flight effect loads.

`js/particle-runtime.js` coalesces Effekseer's global initialization callbacks so
card and victory renderer preparation cannot clobber each other. Victory calls
that shared promise, but its effects, sequence timings, camera, announcement,
winner identity, tab-pause and Skip behaviour are unchanged. No vendor files edited.

Reduced/off preferences and system reduced motion still take precedence. Reduced
mode uses a short static result badge with no particles/flights. WebGL/load/context
failure falls back to the badge instead of wedging gameplay.

## Audio and menu

No sound assets, recipes, synthesis layers or sound timing were added. Existing
music/SFX preferences and existing configured sounds are preserved. The isolated
preview gallery remains fully silent.

The main menu's **Card Cinematics** button opens `card-effects.html`. This public
effect-study catalogue is not the existing private invitation Gallery; private
rooms, mode access, owner authentication and gallery invitations are unchanged.
The website opening still reuses the requested filmed-fire Settings preview.

## Validation

`npm test`: **490 headless + 9 real multiplayer tests passed**. New coverage includes
all fourteen routes, strict privacy fields, defaults/reduced/off, duplicate/baseline
suppression, Alvin/curse phases, Phoenix→winner ordering, one runtime initialization,
exact approved SVG identity and non-blocking/no-audio renderer boundaries.

`node tests/card-game-browser-check.js` launches its own random-port server and
native Edge. It plays complete real five-player matches, selecting only server-
authorized moves from actual dealt hands. Phoenix is earned by finishing a game;
no score/hand/result injection. All fourteen cards reached the production renderer
in **two matches / 156 authorized moves** in the initial run, then **two matches /
150 moves** in the final run. The final test requires visible particle framebuffer
pixels for **each of the fourteen cards**, input pass-through and leave cleanup.
Controlled supplemental
events test reduced/off, hiding, mobile layout and GPU context loss; the menu
button is actually clicked to verify navigation. No owner credentials required;
the user's port-3000 match/lockout state is not touched by this test.

`node tests/victory-game-browser-check.js` passed complete real desktop/mobile wins,
winner/ally identity, exact orb/fireworks launch schedule, tab pause/resume, hidden
finish, reduced motion, Skip, context loss, duplicate suppression and cleanup.
It uses the previously documented 20-second warm-up; the preview document's
unresolved cold-start callback-tolerance observation is not claimed fixed here.

The existing `node tests/card-gallery-browser-check.js` also passed all fourteen
separate gallery studies and the website opening. Physical mobile/Safari/low-end GPU
measurements remain outside native desktop Edge and viewport emulation coverage.

No push or deployment is authorized by this merge request.
