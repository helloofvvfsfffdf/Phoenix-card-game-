# Phoenix-only photographed-fire experiment

Branch: `experiment/phoenix-fire-takeover`. This builds on the existing cinematic
branch; no other card, animal ability, balance, authentication or turn logic is
redesigned. Nothing is pushed, merged or deployed.

## Try it

Refresh the local app and open **Settings → Experience Phoenix cinematic**.
The dedicated button works without earning the legendary card and does not
create a game, grant a card, emit a move or alter scores. **Return to game**, the
existing **Stop** control and Escape dismiss the preview. The ordinary sound
selector's Phoenix entry previews the new sound without taking over the screen.
Saved SFX volume/mute and visual-effect preferences are respected separately.

## Direction and sequence

- 0–1.25s: the table fades behind a dark, full-viewport stage; an enormous
  feathered Phoenix rises through photographed fire and glowing embers.
- 1.25–3.35s: sustained filmed fire fills the viewport and is also composited
  inside the original bird silhouette. A layered recorded fire roar, slowed
  rumble, reversed intake and original pressure release replace the old short
  synth chirp. No repeated white flashes or camera shake.
- 3.35–4.4s: lighting and stage fade out; normal gameplay returns. If the Phoenix
  ends a multiplayer game, the existing victory/defeat stage waits until this
  scene ends. Music still restores immediately on the confirmed match end.

**Rules timing:** the server resolves the card before broadcasting its public
event. The scene's 1.25s impact marks the presentation of that confirmed outcome,
not a delayed gameplay mutation. Moving the actual server resolution into a
client animation callback would compromise synchronization, so it is not done.
There is no animation acknowledgment, turn lock or speculative outcome. Normal
board state updates continue underneath; Skip can expose the result immediately.

Only the `phoenix` legendary-card event triggers this scene, never
`ally-phoenix`. The existing public journal cursor suppresses repeats/reconnect
history, and the whole batch is consumed before presentation. Phoenix takes
priority over ordinary effects in the same batch, even with more than eight
events. Local rules events also trigger one scene for the card's multiple log
entries. A live event received while Settings is already open retains the
existing noninterrupting Settings behavior (sound only).

## Assets, accessibility and budget

CC0 photographed fire by Jolon Dann and CC0 recorded fire by ahriik are locally
bundled, trimmed and transformed. See `assets/phoenix/LICENSES.md` for source
pages, licence evidence, credits, limitations and reproducible build details.
The recording is the site's public high-quality compressed preview, not the
login-gated WAV. The Phoenix vector artwork is original, not a stock logo.
This is a filmed-fire/vector-art composition, not a rendered 3D creature.

Video, poster and mix total **649,839 bytes** (about 635KiB), plus the small SVG.
There is one muted, audio-free 960×540 video decoder, one Canvas2D scene capped
at 24fps and 750,000 pixels, and 36 mobile / 80 desktop embers. No WebGL, large
sprite atlas, full-screen live-board blur or per-particle DOM is required.
Save-Data avoids video preloading/creation and uses the poster instead.

Reduced motion is a **1.8-second static illustration/poster** with no moving
canvas or video. Visuals Off permits independently enabled audio. Recorded PCM
is decoded through the existing SFX master/compressor, never a new loudness
bypass; its pre-encoding peak is 0.68, RMS 0.1044. Decode/download failure uses
an original Phoenix-only fire synthesis fallback. Video playback failure uses
the poster. Hiding the page, leaving/disconnecting, preference/motion changes,
Stop and Skip cancel the stage/timers/sounds. Page exit releases cached media.
The stage does not steal focus; the dismissal button is keyboard accessible.

## Validation (2026-10-10)

- **458 headless tests passed**, including unchanged non-Phoenix/ally/result
  recipe hashes, media hashes/budget, actual local rules resolution, public
  event privacy, all-observer delivery, replay suppression, reduced motion,
  event-batch priority, preview dismissal, timers/voices and disconnect cleanup.
- **9 live multiplayer tests passed** for the existing server/rules integration.
- Native isolated-profile Edge: all **29** sound previews, real decoded
  recorded mix, playing filmed-fire stage, 1280×900 and 375×812 layout, natural
  end, Skip, native reduced-motion emulation and no browser errors.
- Real three-player server matches earned the card through gameplay and played
  it legally in a subsequent match. Separate successful runs observed the
  cinematic as the actor and as an opponent; all three recipients got exactly
  one Phoenix journal event, points transferred exactly, repeated terminal
  snapshots did not restart the stage, and music/celebration lifecycle passed.
  This opt-in check needs a legitimately earned card; ties do not award one and
  existing process-global holders can affect the setup. Prefer a fresh isolated
  test server. No production earning logic was changed to facilitate testing.
- Desktop screenshot reviewed: photographed full-screen flame coverage and
  enormous bird silhouette are materially different from the prior circular
  CSS seal. Browser audio output was muted during automated checks.

Run `npm test`. For optional native Edge integration, start an isolated local
server and set `PHOENIX_BROWSER_URL`, `PHOENIX_BROWSER_OWNER_PASSWORD` and
`PHOENIX_FIRE_CHECK=1`, then run `node tests/cinematic-browser-check.js`.

**Still requires human assessment:** the sound's dramatic quality and visual
art direction, real speakers/headphones, physical mobile hardware, codec
behavior outside tested Edge, battery usage and low-end frame rates. Pixel,
asset and particle caps are safeguards, not measured performance guarantees.
