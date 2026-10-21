# PHOENIX — the immersive (3D) table

The first-person 3D card table: a room, a table, people sitting round it,
and your own hands holding a fan of cards you can pick up and play.

It runs on its own page. The gameplay is still mock data, so nothing here can
affect a real match — and the 2D game is untouched.

## Running it

```bash
npm start
# then open http://localhost:3000/immersive.html
```

## The room

The room is a **map**: somebody made it in Blender, it is loaded as it was
made, and the places the game needs are read out of it by the names of the
objects — the cushions are the seats, the laptop bases say where the laptops
stand, the felt is the table, the deck is the deck and the cell's door is the
cell.

The map says where things are. The card system says what they do. The two
never talk, so the next rooms can be dropped in without a card being
touched.

**Map 01: Modern Gaming Lounge** — `assets/maps/modern-gaming-lounge.glb`,
made in Blender as `PHOENIX Neon Lounge`. It is the neon room: the strip
lights, the wall display, the snack machines, the oval table and the cell in
the corner.

To add a room: put the file in `assets/maps/`, add it to `MAPS` in
`js/immersive/maps.js`, and set `data-map` on the body in `immersive.html`.

## The people

Four Mixamo characters, one for each seat the player is not in, with their
skeletons, clothes, hair and textures, sitting in the map's own chairs with
the real sitting animation. The first seat is the local player's: they are
the camera.

The characters are converted from the original fifty-megabyte downloads into
glTF files of a tenth the size, with the pictures made a sensible size:

```bash
node tools/convert-character.js "C:/path/character.fbx" \
     assets/mixamo/characters/ash.glb 1024
```

The raw downloads are not in the repository, and the originals in Downloads
are never touched.

## The laptops

Every seat has an open laptop on the table in front of it, turned to face its
owner and low enough to hide neither the table nor the cards. The screen is
the PHOENIX Bank: the player's own balance, a green or red band when it
moves, a LEAVE MATCH button, and the place the game's objective and the
Mimic's video appear.

## The cinematics

The **CINEMATICS** button in the corner plays the card cinematics in turn,
so they can be watched without a table of real players. The framework is in
`js/immersive/cinematics.js` and the stage directions in
`js/immersive/director.js`.

A cinematic never decides anything. The server has already decided what a
card did; the cinematic only shows it.

## The check

```bash
npm run test:immersive
```

It needs the server running on port 3000, and it writes screenshots to your
temp folder.

## The files

| File | What it is |
|---|---|
| `immersive.html` | The page: the stage, the HUD, the caption and the no-WebGL message. |
| `css/immersive.css` | The page around the 3D stage. |
| `js/immersive/maps.js` | The rooms, and the anchors read out of them. |
| `js/immersive/scene.js` | The renderer, the camera and the lights. |
| `js/immersive/characters.js` | The five stylised people and their rig. |
| `js/immersive/hand.js` | Your own arms and hands, the fan of cards and the picking. |
| `js/immersive/laptop.js` | The laptop and its live screen. |
| `js/immersive/cinematics.js` | The shared animation framework and the card cinematics. |
| `js/immersive/director.js` | The stage: who is where, the lights, the caption, the video. |
| `js/immersive/textures.js` | Every surface, painted on a canvas at run time. |
| `js/immersive/geometry.js` | The shapes: rounded boxes, turned parts, frames. |
| `js/immersive/prototype.js` | The wiring: the map, the people, the cards, the camera. |
| `tools/convert-character.js` | Turns a Mixamo download into a small glTF file. |
| `tools/inspect-fbx.js` | Shows what is inside a Mixamo file. |
| `vendor/three/` | Three.js r186 (MIT), the FBX and glTF loaders, the exporter. |
| `tests/immersive-browser-check.js` | The headless-browser check. |

## What is NOT here yet

The 3D table is not yet connected to the live game: it plays a mock match.
The multiplayer connection, the standing and walking animations, the jail
arrest and the rest of the card cinematics are the next pieces of work.
