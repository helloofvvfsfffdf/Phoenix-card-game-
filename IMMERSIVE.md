# PHOENIX — the immersive (3D) table

**Milestone 1: a standalone prototype.** It is a first-person 3D card table:
a room, a table, five seated placeholder people, and your own hands holding a
fan of cards you can pick up and play.

It runs on its own page and uses **mock data**. Nothing in it talks to the
game server, and nothing in it can affect a real match. The 2D game is
untouched.

## Running it

The prototype is a static page, so any web server will do. The quickest way
is the project's own server:

```bash
npm start
# then open http://localhost:3000/immersive.html
```

The server needs its usual environment variables (`PHOENIX_OWNER_PASSWORD`,
`PHOENIX_MODE_ACCESS_CODE`) even though the prototype itself never uses
them. A bare static server works too:

```bash
npx serve .        # then open http://localhost:3000/immersive.html
```

## What you can do in it

| | |
|---|---|
| **Look around** | Drag with the mouse, or with one finger. You are seated: you cannot stand up, walk, or look behind yourself. |
| **Pick a card** | Click or tap a card in your hand. It lifts out of the fan. |
| **Play a card** | Click or tap it again, or press **PLAY CARD**. It flies to the middle of the table. |
| **Draw a card** | **DRAW** takes the next card from the mock deck into your hand, up to seven. |
| **Quality** | Low, Medium or High — the pixel ratio and the shadows. |
| **Look speed** | How fast the camera turns. |
| **Reduced motion** | Turns off the breathing, the swaying, the blinking and the card flights. |

## The files

| File | What it is |
|---|---|
| `immersive.html` | The page: the stage, the HUD, the loading line and the no-WebGL message. |
| `css/immersive.css` | The page around the 3D stage. |
| `js/immersive/scene.js` | The renderer, the camera, the lights, the room, the table, the chairs, the deck, and the quality presets. |
| `js/immersive/characters.js` | The five placeholder people, built from primitives, with their idle movement, blink, draw and play animations. |
| `js/immersive/hand.js` | Your own arms and hands, the fan of cards, the card faces drawn on a canvas, and the picking. |
| `js/immersive/prototype.js` | The wiring: the mock match, the camera controls, the HUD and the frame loop. |
| `vendor/three/` | Three.js r186 (MIT), vendored so the page has no external dependency. |
| `tests/immersive-browser-check.js` | A headless-browser check that proves the page renders, holds seven cards, and picks and plays one. |

## The check

```bash
node tests/immersive-browser-check.js
```

It needs the server running on port 3000 (`npm start`), and it writes
screenshots to your temp folder.

## What is NOT here yet

This is Milestone 1. The multiplayer, the character picker, the animal
allies and the Mimic's phone cinematic are Milestones 2 to 5, and none of
them are started.
