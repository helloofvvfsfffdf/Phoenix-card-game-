# PHOENIX — work report

**Date:** 22 October 2026
**Branch:** `feature/immersive-3d` (pushed to `origin`)
**Base:** `main` is untouched at `5e501b4`. Nothing has been deployed.
**Working 3D table:** `http://127.0.0.1:3000/immersive.html`

---

## 1. What was completed

### Priority 1 — the 3D repair

**The characters were being placed by a pose that was not their pose.**
`playAnimation()` fades an animation in over 0.25 s. The placement code
measured the hips immediately after asking for the sitting clip, while that
fade was at ~6% weight — so it measured the **standing bind pose** (hips at
95.7 cm) instead of the **sitting pose** (hips at 55.6 cm). The character
was dropped ~0.36 m below the chair and the animation yanked it up into the
seat about a second later. That was the "running and teleporting".

Fixed by `js/immersive/seating.js`:

- the pose is measured from the **settled** clip (no fade, mixer stepped by
  hand), in **metres**, from the **bones** — never from the bounding box,
  because `Box3.setFromObject()` on a SkinnedMesh returns the bind pose and
  not the pose on screen;
- the hips are **locked to the cushion every frame**, so a fade, a drift or
  a change of animation can never move a player off their chair again;
- all **five** characters are loaded and seated; the local player's own body
  is in the room for everybody else to see and hidden for the player, whose
  camera is at their real eye height (1.359 m, measured from the model);
- the cinematics use the room's own seat positions instead of a circle they
  made up, and people walk on the floor instead of through it.

**Measured after the fix:** all five characters' hips at **0.735 m** — the
top of the cushion; heads at 1.267–1.304 m, above the table at 1.012 m;
toes 0.207–0.242 m (the bar-stool position, see §4); nothing through the
floor; no drift over time.

### Priority 2 — real multiplayer

The mock is gone. `js/immersive/multiplayer.js` is a real client of the
**same server** the 2D game uses: the same socket, the same messages, the
same session-cookie auth, the same resume token (kept in the same place
the 2D game keeps it, so a player can move between the two tables).

- one state object, replaced on every `type: 'state'` message, exactly as
  the 2D client keeps it;
- the client never decides what is legal — it only sends what the server
  already said was legal;
- `js/immersive/table-ui.js`: the lobby, the open-rooms list, the table,
  the scores, whose turn it is, and the picker that asks who a card is
  aimed at;
- `js/immersive/interactions.js`: the bridge to the overlays that ask the
  players a question — the same overlays the 2D game uses, so a challenge is
  answered the same way at either table;
- the server's own effect journal drives the cinematics, so every player
  sees the same show and a reconnect does not replay it.

### Priority 3 — a cinematic for every card

All **38** cards in `js/cards.js` have their own show, in
`js/immersive/cinematics.js`, built from the shared verbs (stand, sit,
walkTo, lookAt, react, cameraFocus) and the new `js/immersive/effects3d.js`
(sparks, rings, beams, numbers flying through the air, flares, the camera
shaking, points travelling from one player to another).

Each show shows what its card actually does: the Steal sends the points
across the table; the Zombie drains the target's score in green mist; the
Hunter puts a ward round the player; the Phoenix sets the table on fire
and takes every other player with it; the Judge dims the room, gives the
verdict and walks the prisoner to the cell; the Knife is a blade of light
and no blood; the Nothing does an enormous build-up and then absolutely
nothing.

A card that did nothing at all — a Steal that took no points, a Judge that
did not fire — is not given a show it has not earned. The Judge says so
when it does not fire. Reduced motion is honoured: the camera does not
swing about and the words do not linger.

### Priority 4 — playable

Selection, targeting, drawing, playing, scores, turns, joining, leaving,
the lobby, the loading and error screens. The server remains the only
authority.

### The extra work asked for today

- **Lights in the map.** `js/immersive/map-lights.js` puts back the lights
  Blender's area lights could not carry in the glTF: one real light for
  each fitting the room names — the three ceiling panels, the wall strips,
  the cyan rim round the table, the signs on the far wall, the red lamp on
  the cell door, the snack machine's shelves — in the fitting's own colour.
  The scene's own lights were turned down to match.
- **The laptops show the PHOENIX Bank**, carrying the same identity the
  menu has in its **top left corner** (THE CARD GAME / PHOENIX / RISE ·
  PLAY · SURVIVE) with the room code, the round and the owner's name, the
  balance, the notification band, the objective, the LEAVE MATCH button,
  and a result screen when the match is over. The screens were also turned
  to **face their owner**: the room's laptops were boxes, so the direction
  they faced was whatever way the box had been turned, and every screen was
  showing its back.
- **The Mimic's video plays on the laptop.** A video cannot be painted onto
  a texture, so the player is put in the page and the page is fitted to the
  screen in the room — the four corners of the screen are worked out in the
  world, projected onto the page, and the mapping that takes a square onto
  a quadrilateral exactly (the same mapping a camera uses) is written as
  one `matrix3d`. The video tilts with the lid, is the right shape from
  every seat, and its sound is turned down with the distance to it.
- **The end of a match.** The player's own laptop shows VICTORY or DEFEAT,
  who won, and the table as it ended; the view is **locked onto that
  screen** and the mouse cannot turn away from it; and the game's own
  victory and defeat shows play over the top, as they do in the 2D table.

---

## 2. The tests, and their results

| Suite | Command | Result |
|---|---|---|
| The 2D game (all of it) | `npm test` | **exit 0** — 81 expansion, 13 expansion-network, 57 badge, 26 announcement, 17 leaderboard, 51 security, 5 reconnect, and the rest: all passed, 0 failed |
| The 3D table in a browser | `npm run test:immersive` | **PASS** (exit 0) — the room draws, the five people sit on their chairs with their hips on the cushion and their heads above the table, the hand is the server's, a card is picked and played, the target picker sends the right move, the Mimic's video is fitted to the laptop screen, the result appears on the laptop and the view locks onto it |
| The 3D table over a real socket | `npm run test:immersive-net` | **11 passed, 0 failed** |
| Every card's cinematic | `npm run test:immersive-cinematics` | **PASS** — all 38 plays, no throws, everybody back on their chair afterwards |

**No test is failing.** The only failures during the work were faults the
new tests *found*, and they were fixed:

- Betrayal assigned to a `const` and threw every time it was played;
- a show could leave somebody on their feet (the Judge walks its prisoner
  to the cell and never sat them down) — now every show ends by putting
  everybody still in the round back on their chair;
- the director was holding a **stale list of the laptops** (the list was
  replaced rather than filled in, so the director's copy was always empty);
- the screen map referred to a function that did not exist;
- the check measured the room between two frames, before the seat lock had
  run.

---

## 3. Files changed

**New:** `js/immersive/seating.js`, `js/immersive/effects3d.js`,
`js/immersive/screen-map.js`, `js/immersive/map-lights.js`,
`js/immersive/multiplayer.js`, `js/immersive/table-ui.js`,
`js/immersive/interactions.js`, `tests/immersive-cinematics-check.js`,
`tests/immersive-multiplayer-tests.js`, `IMPERATIVE-PLAN.md`.

**Changed:** `js/immersive/prototype.js`, `cinematics.js`, `director.js`,
`maps.js`, `mixamo.js`, `scene.js`, `textures.js`, `laptop.js`,
`props.js`, `hand.js`, `css/immersive.css`, `immersive.html`,
`tests/immersive-browser-check.js`, `package.json`, `.gitignore`.

**Deleted:** `js/immersive/room.js` (the procedural room, replaced by the
map).

---

## 4. Remaining issues

1. **The feet dangle 0.22 m above the floor.** The map's chairs are
   **bar stools** (the cushion is at 0.735 m) and the Mixamo *Sitting Idle*
   is a **normal chair** pose (the hips 0.537 m above the floor, the feet
   flat on it). The two disagree by 0.198 m, and the cushion wins — the
   body is on the seat, which is what a player sees. **If the cushions in
   Blender are lowered to about 0.55 m, the characters' feet will reach the
   floor and the seating will be exact**, with no code change: the whole
   seating is measured from the map.
2. **The victory and defeat shows take over the whole screen** in 3D, so
   the laptop underneath is hidden while they play. They have a **Skip**
   button, and the view is still locked on the laptop afterwards. A smaller,
   in-room version of the show would be better.
3. **The characters still mostly turn their heads.** The user said this
   plainly: the +10,000 effect is the benchmark, and the other cards are
   "just your character turn". The shows have effects, camera moves and
   captions, but the *performances* are thin — most cards need the people to
   do something: stand, walk, reach for a card, recoil, slump, rise. That
   is the next piece of work, and it is a piece of work, not a bug.
4. **The characters are heavy** — four at 8–10 MB. Re-exporting the models
   at a smaller texture size, or converting these at 512, would fix it.
5. **The map has no lights of its own** — the ones added here are placed by
   name. If the ceiling panels or strips move in Blender, the lights follow
   them, but a fitting with a new name would need a new rule.
6. **The interactive overlays are the 2D ones**, so they look like the 2D
   game rather than like the room.
7. **The 3D page is not yet reachable from the menu** — it is a separate
   page. The mode choice at lobby creation (Milestone 3) is not done.
8. The room's **poster and notepad** are still on the walls; they can be
   taken out on request.

---

## 5. Not verified

- **Two real players at one 3D table** was tested over sockets (two
  clients, a real match, a real card played), and in a browser with one
  client; it was **not** tested with two people on two machines at once.
- **The Mimic's video was not watched to its end** in the headless browser:
  the player is created and fitted to the screen, but the headless browser
  has no network access to YouTube, so the picture itself was not seen
  playing.
- **The victory and defeat shows were seen running** (the defeat screen
  was captured in the browser check) but the **victory** one was not
  captured, because the check ends the match as a defeat.
- The **2D game was not played by hand** — it was checked by its own test
  suite, which is green.
