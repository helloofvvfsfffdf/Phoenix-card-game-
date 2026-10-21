# PHOENIX — the immersive (3D) table

The first-person 3D card table: a room, a table, five seated people, and
your own hands holding a fan of cards you can pick up and play.

It runs on its own page and uses **mock data**. Nothing in it talks to the
game server, and nothing in it can affect a real match. The 2D game is
untouched.

## Running it

```bash
npm start
# then open http://localhost:3000/immersive.html
```

Any static server works too (`npx serve .`).

## What you can do in it

| | |
|---|---|
| **Look around** | Drag with the mouse, or with one finger. You are seated: you cannot stand up, walk, or look behind yourself. |
| **Pick a card** | Click or tap a card in your hand. It lifts out of the fan. |
| **Play a card** | Click or tap it again, or press **PLAY CARD**. It flies to the middle of the table. |
| **Draw a card** | **DRAW** takes the next card from the mock deck into your hand, up to seven. |
| **The phone** | Bottom left: your own PHOENIX Bank phone, with your balance and a LEAVE MATCH button. Every other player has one on the table in front of them. |
| **Quality** | Low, Medium or High — the pixel ratio and the shadows. |
| **Look speed** | How fast the camera turns. |
| **Reduced motion** | Turns off the breathing, the swaying, the blinking, the card flights and the balance swings. |

## The files

| File | What it is |
|---|---|
| `immersive.html` | The page: the stage, the HUD, the loading line and the no-WebGL message. |
| `css/immersive.css` | The page around the 3D stage. |
| `js/immersive/scene.js` | The renderer, the camera and the lights. |
| `js/immersive/room.js` | The room: the floor, the walls, the ceiling, the door, the windows, the fireplace, the table, the chairs, the deck and the furniture. |
| `js/immersive/characters.js` | The five stylised people, their rig, and their idle movement. |
| `js/immersive/hand.js` | Your own arms and hands, the fan of cards, the card faces and the picking. |
| `js/immersive/mixamo.js` | The Mixamo characters: the FBX loader, the rig, and the animation library. |
| `js/immersive/phone.js` | The PHOENIX Bank phone and its stand. |
| `js/immersive/props.js` | The Mimic poster, the developer's notepad and the jail cell. |
| `js/immersive/textures.js` | Every surface, painted on a canvas: the floorboards, the wallpaper, the wood, the leather, the rug, the poster, the notepad and the bank screen. |
| `js/immersive/geometry.js` | The shapes: rounded boxes, turned parts, frames, panelled doors and a merge for the parts that never move. |
| `js/immersive/prototype.js` | The wiring: the mock match, the camera controls, the HUD and the frame loop. |
| `assets/mixamo/character.fbx` | The Mixamo character: the skeleton, the body, the clothes, the hair and the textures, exactly as it was downloaded. |
| `assets/mixamo/animations/` | The thirteen animations, taken out of their downloads as keyframes. |
| `vendor/three/` | Three.js r186 (MIT) and the FBX loader, vendored so the page has no external dependency. |
| `tools/extract-mixamo-animation.js` | Takes the animation out of a Mixamo download and leaves a small file of keyframes. |
| `tests/immersive-browser-check.js` | A headless-browser check that proves the page renders, holds seven cards, and picks and plays one. |

## The Mixamo characters

The character is a real Mixamo model, loaded with Three.js's own FBX loader:
the skeleton, the body, the clothes, the hair and the textures all come
straight out of the file, and the rig is left exactly as it was, so the
characters can be posed, stood up or walked later.

A Mixamo download is about fifty megabytes, almost all of it the model and
its textures, which the game already has. The animations are therefore taken
out separately, as small files of keyframes:

```bash
node tools/extract-mixamo-animation.js "C:/path/Sitting Idle.fbx" \
     assets/mixamo/animations/sitting-idle.json
```

The thirteen animations that came with the models are already in
`assets/mixamo/animations/`: sitting idle, sitting clap, sitting laughing,
reaction, angry, taunt, defeated, dying, hit to head, kick to the groin,
shoved with spin, jumping down and running.

Two things are worth knowing if you add another model:

- The character and the animation files disagree about the digit the binary
  FBX format uses for the ":" in `mixamorig:Spine`, so the tracks are
  re-aimed at the bones that are really there before they are played.
- A model with no sitting animation is not bent into a sitting shape by
  hand. It stands beside its chair, and says so.


## The check

```bash
npm run test:immersive
```

It needs the server running on port 3000 (`npm start`), and it writes
screenshots to your temp folder.

## How it is drawn

Everything is drawn in code. There is no model file, no texture file and
nothing to download, so the art is one style all the way through and there
is no licence to chase. The surfaces are painted on 2D canvases at run time
(floorboards with a grain and a knot, a damask wallpaper, worn leather, a
patterned rug, the poster, the notepad and the bank screen), and the
furniture is built from lathed profiles and rounded boxes rather than from
cubes and cylinders.

## What is NOT here yet

The multiplayer, the character picker, the animal allies, the Mimic's phone
cinematic and the victory and defeat effects in 3D are later milestones, and
none of them are started.
