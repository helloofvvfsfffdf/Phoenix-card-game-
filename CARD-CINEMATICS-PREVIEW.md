# PHOENIX card cinematic atelier

Preview: **http://localhost:3000/card-effects.html**. All 14 cards are available
individually, with replay, pause, a sequential tour, outcome selection, rendering
quality and reduced-motion controls. This is an isolated fictional demonstration,
not a game mode: no match state, auth, sockets, live hands, rules mutations, sound
or music. The main game does not load the new card gallery/controller/effects.

## Authoring and semantics

Card catalogue/text: `js/cards.js`. Mechanics were checked against resolvers,
pending choices and curse triggering in `js/rules.js`. Original authored artwork
and editable projects live under `assets/card-cinematics/`; the procedural author
is `scripts/build-card-cinematics.js`. These are **new Effekseer compositions**,
not renamed downloaded sample effects. GSAP drives card arrival, hero movement,
announcements, table transitions and outcome-specific demonstrations.

| Card | Visual language | Semantic guardrail |
| --- | --- | --- |
| +10,000 Points | Mint halo, ascending coins, gold stars | Actor gains exactly 10,000 |
| Knife | Cold diagonal slash, steel fragments | 1-round elimination; score stays |
| Hunter | Emerald double bow ward, feather dust | Reflects Zombie only; already-held variant |
| Zombie | Necrotic vapour and toxic seal | Direct hit resets target; reflection eliminates actor without resetting either score |
| Steal Points | Violet curved streams and travelling coins | All points transfer; nobody eliminated; zero-point variant |
| Judge | Celestial verdict seal, descending light | 50% activation; banishes most evil for 3 rounds; failed/no-evil variants have no banishment |
| Reveal Deck | Cyan iris scan, private card fan | Fictional actor-only hand; no removal |
| Skip Everyone | Amber turn wheel returning to actor | Others skip; actor plays again; no elimination |
| Phoenix | Burning wing arcs, feather cascade, legendary seal | All opponents’ points taken and all eliminated; only one fictional hand clears/redraws; no invented resurrection |
| Trick | Mirrored rose masks, violet veil | Alias only; points/effects stay |
| Steal a Turn | Counter-rotating clock and choice binding | Target still takes/draws their turn; actor chooses a legal card |
| Curse | Violet runes around whole hand | Never marks/reveals which card; trigger is after normal card resolution |
| Ghost | Pale feather boundary, spectral outline | Untargetable this round; existing effects remain |
| Alvin | Ginger paw constellation, claws, final embers | Private reveal then mandatory choice; only one card destroyed forever; empty-hand variant |

Hand labels and scores are deliberately fictional, never read from any game.
Outcome selection demonstrates possibilities; it is not a random rules simulator.
Phoenix's demonstration includes fictional extra opponents contributing 60,000.

## Performance / lifecycle

- One WebGL canvas/context; one playing Effekseer instance, maximum 486 particles.
- All fourteen binaries plus eight textures total 2,075,341 bytes; the existing
  bundled runtimes are reused, not downloaded from a CDN or duplicated.
- At most two cached effect resources. Lazy load only the selected binary;
  late loads cannot replace the selected scene. Resource disposal waits for loads.
- Rendering capped at 30 fps (24 on Low), DPR and largest buffer dimension capped
  at 1120 Balanced / 800 Low / 1440 High. No background/idle particle rendering.
- Stopping, selecting another card or finishing kills the GSAP sequence/ticker
  and all particles. Page exit releases native assets/context. Hidden tabs pause
  and resume without catch-up. Escape stops playback/tour.
- Reduced motion uses a short static card explanation with no particle draws,
  card flights, camera shake or spinning. WebGL failure retains the explanation.
- Current effects are preview-only; future integration must anchor them to
  confirmed public events, preserve private reveals and keep pointer input live.
  Long hero presentations are for inspection, not a proposed input-blocking wait.

## Requested website opening

Separately, `js/opening-cinematic.js` reuses the exact existing Settings **Phoenix
rises** filmed-fire stage as a silent 4.4-second welcome on page opening. It does
not replace the new legendary-card study or the approved victory screen. Only
intro labels differ: welcome text, no card-play/winner claim, and a Skip button.
Saved Disabled visual preference skips it; reduced motion uses the existing
1.8-second static variant. Escape, menu actions, hiding and page exit dismiss it.
An initially hidden page waits until visible; it never opens over a non-menu view.
No new sound code or sound effect is added.

## Rebuild / validate

Set `EFFEKSEER_EXE` to an Effekseer 1.80.7 `Effekseer.exe`, then run:

```
node scripts/build-card-cinematics.js
npm test
node tests/card-gallery-browser-check.js
```

Native Edge test runs against port 3000 by default; override `PHOENIX_GALLERY_URL`
for an isolated server. No password is needed. It verifies actual visible and
changing framebuffer pixels for all fourteen binaries, reflection/Judge outcomes,
Curse privacy, single-card Alvin destruction, pause/hidden tabs, mobile overflow,
reduced motion, rapid selection, graphics-context fallback and disposal. It also
checks the actual website intro, Skip/Escape, visual preferences and cleanup.
Screenshots/measurement JSON are saved under `%LOCALAPPDATA%/Temp/opencode/`.

Physical phones, Safari/iOS, low-end GPU performance and subjective quality
approval are not established by desktop Edge/viewport emulation. The owner should
review each study before any new card effects are integrated into the main game.

Validation on 2026-10-11: **481 headless + 9 live multiplayer tests passed**;
native Edge gallery and website-opening checks passed. The existing real-game
victory suite passed with its previously used 20-second idle warm-up, including
desktop/mobile wins, tab pause, hidden-at-finish, reduced motion and fallback.
Additional cold-start runs without that warm-up missed the suite's ±120 ms
opening-callback tolerance (one recorded Boss Death callback at 0.434 s; all five
firework callbacks in that run were on schedule). That is an unresolved cold-start
timing observation, not evidence of the earlier disappearing-screen bug and not
hidden by relaxing the test. No victory scene, timing, runtime or asset was edited;
the existing test now includes launch diagnostics in its assertion message.
