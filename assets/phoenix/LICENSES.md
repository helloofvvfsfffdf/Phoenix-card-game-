# Phoenix experiment media — source and licence record

Verified 2026-10-10. These licences apply to these assets only, not existing music
or unrelated PHOENIX assets. No original/raw multi-gigabyte footage is bundled.

## Photographed fire footage

- Creator: **Jolon Dann**.
- Collection: **Fire Stock Footage and Transitions - 300 FPS**, uploaded 2024-06-09.
- Source page: https://archive.org/details/fire-footage-300-fps
- Metadata evidence: https://archive.org/metadata/fire-footage-300-fps
- Metadata states `creator: Jolon Dann` and
  `licenseurl: https://creativecommons.org/publicdomain/zero/1.0/`.
- Description says shot on Lumix GH6 at 1080p/300fps, edited in DaVinci Resolve.
- Selected original: `Jolon's Fire Stock Footage/Individual Explosions/L-R Fire Explosion00001.mov`.
- Bundled derivative: `fire-surge.mp4`, resized to 960×540/24fps, H.264, audio
  removed, web faststart. `fire-poster.jpg` is a frame at 1.25 seconds.
- No claim that the edited distribution clip itself plays at 300fps: original
  delivery is approximately 24fps with a slow-motion photographed fire element.

## Recorded fire sound

- Creator: **ahriik**.
- Title: **fire ambience, flames, crackles, pops, burning**, sound 508110,
  published 2020-03-09.
- Source/licence page: https://freesound.org/people/ahriik/sounds/508110/
- Page explicitly lists **Creative Commons 0** with the CC0 licence link and
  describes a Sennheiser MKH-50 / Zoom F4 recording.
- Public high-quality preview URL published by that page:
  https://cdn.freesound.org/previews/508/508110_6657854-hq.mp3
- We used that openly published compressed preview, **not** the login-gated
  original WAV, and do not claim lossless master quality.
- `fire-roar.mp3` layers trimmed, filtered and slowed/reversed parts of the
  recording with an original procedural pressure/noise layer, staged and faded.
  It is a designed fantasy-fire mix, not an unaltered field recording.

Both source works are released under **CC0 1.0 Universal**:
https://creativecommons.org/publicdomain/zero/1.0/
No attribution is required by CC0; creator/source credits are retained voluntarily.
CC0 includes a public-domain dedication and fallback licence without warranties;
the source pages are the evidence of the creators' stated licence, not a guarantee
of third-party rights clearance beyond that evidence.

## Original artwork and reproducibility

`phoenix-hero.svg` is original vector artwork authored for this experiment; no
stock bird/logo was copied. Scene lighting, trails and embers are original code.
`scripts/build-phoenix-media.js` reproduces the video/poster/mix with local ffmpeg.
`manifest.json` records source and derivative SHA-256 hashes and derivative sizes.
Runtime assets are served from this local project; no CDN, tracker, login or
external media request is made during gameplay.
