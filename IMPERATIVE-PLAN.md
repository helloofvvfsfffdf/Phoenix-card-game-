# PHOENIX — the 3D repair, the multiplayer, and the card cinematics

## What was wrong, measured

Everything below was measured in the browser against the real map and the
real models, not guessed.

### The characters were placed by a pose that was not their pose

`playAnimation()` fades an animation in over 0.25 s. The placement code
measured the character's hips straight after asking for the sitting clip,
while that fade was still at ~6% weight — so it measured the **standing
bind pose** (hips at 95.7 cm) instead of the **sitting pose** (hips at
55.6 cm). The character was then dropped ~0.36 m below the chair and the
animation yanked it up into the seat as the fade completed.

That is the "running and teleporting": the legs thrashed below the floor
while the body snapped upwards about a second after the model loaded.

**Fix:** the hips are measured from the *settled* pose (no fade, mixer
stepped), and — more importantly — they are **locked to the seat every
frame** (`js/immersive/seating.js`). A fade, a drift or a change of
animation can never move a player off their seat again.

### The map's chairs are taller than the characters' sitting pose

| Thing | Height |
|---|---|
| Room floor | 0.000 m |
| Table playing surface (upper felt) | 1.012 m |
| Seat cushion top | 0.735 m |
| Character hips, standing (bind pose) | 0.928 m |
| Character hips, Mixamo *Sitting Idle* | 0.537 m |
| Character hips in the **old, broken** placement | 0.373 m |
| Character toes, in the old placement | −0.122 m (below the floor) |

The map is a **bar-height** table (1.012 m) with **bar stools** (0.735 m) —
a coherent design: a 1.72 m person's feet dangle ~0.25 m off a bar stool
floor, exactly as they do in real life.

The Mixamo *Sitting Idle* is a **normal chair** pose (hips 0.537 m, feet
flat on the floor). So the character and the chair disagree by 0.198 m,
and that gap has to go somewhere.

**The rule that was chosen:** the **cushion wins**. The hips go on the
cushion, the thighs lie on it, and the lower legs hang — the bar-stool
look. The alternative (feet on the floor, hips 0.2 m under the cushion)
puts the body *inside* the chair, which is what the user reported as
"floating heads" and sinking.

The seat lock then keeps the hips exactly on the cushion, whatever the
animation does.

### Other faults found and fixed

- `Box3.setFromObject()` on a `SkinnedMesh` returns the **bind-pose**
  bounds, not the posed ones. Any measurement of a character taken that
  way is meaningless. All measurements now come from the bones.
- The map's lights are Blender **area lights**, which glTF cannot carry.
  The room is lit by the scene instead, dimly, because the room is a neon
  one and its own strips do most of the work.
- `playAreaPoint()` returned only a height and dropped the play area's x
  and z, so played cards landed in the middle of the table rather than on
  the room's own marked areas.
- The seat height was read from the cushion's **local** bounding box, so a
  chair that had been moved in Blender gave the wrong answer. It is now
  read in **world** space.

## The plan

### Stage 1 — repair the 3D (Priority 1)
- `js/immersive/seating.js` (new): measure a character's seated pose from
  the animation, seat them, and lock them to the seat every frame.
- All **five** characters are loaded and seated (the local player's own
  body is hidden from their own eyes, and the camera sits at their head).
- The camera's eye height comes from the character, not from a constant.

### Stage 2 — real multiplayer (Priority 2)
- `js/immersive/multiplayer.js`: a full WebSocket client against the
  **same server** the 2D game uses — `ws://<host>`, the session cookie for
  auth, the same message vocabulary (`create`, `join`, `start`, `roll`,
  `chooseAlly`, `move`, `interact`, `leave`, `resume`).
- One state object, replaced on every `type: 'state'` message, exactly as
  the 2D client does it.
- The server remains the only authority: the client renders `state.moves`
  and never decides what is legal.
- A lobby panel, a scoreboard, the turn, the names, the room code.

### Stage 3 — a cinematic for every card (Priority 3)
- All **38** cards in `js/cards.js` get their own 3D cinematic, built from
  the shared verbs plus new ones: particles, light flashes, camera moves,
  score transfers, card flights, character gestures.
- Driven by the server's own effect journal (`state.effects`), so every
  player sees the same show, and a reconnect does not replay it.
- Reduced motion is honoured, and a failed cinematic falls back to the
  caption alone.

### Stage 4 — playable (Priority 4)
- Select, draw, play, target, score, turn, join, leave, victory, defeat,
  back to the menu, loading and error screens.

### Stage 5 — tests (Priority 5)
- Node tests for the multiplayer client and the cinematic registry.
- The headless-browser check extended to the seats, the camera and the
  real server.
- The 2D suite must stay green.

## Rules being kept

- The 2D game is not touched.
- No AI opponents in 3D — the server sends real players only.
- No rule is changed. The cinematic only *shows* what the server decided.
- No secrets committed. Nothing deployed.
