# PHOENIX background music — sources and licences

Every track in `assets/music/` is a **CC0 1.0 Universal public-domain dedication**
obtained from [OpenGameArt.org](https://opengameart.org).

CC0 places a work in the public domain and imposes **no conditions**: no
attribution is legally required and redistribution is permitted, including
inside a game and inside this repository. That is why these files may be hosted
here. "Royalty-free", "free to use" and CC-BY were **not** treated as equivalent
to CC0 — see *How this was verified* below.

## The tracks

| Setting | Track | Author | Licence | Source page |
|---|---|---|---|---|
| **Epic** (default) | Battle Theme A | cynicmusic | CC0 1.0 | <https://opengameart.org/content/battle-theme-a> |
| Mysterious | Forgoten tomb ambience | kindland | CC0 1.0 | <https://opengameart.org/content/forgoten-tomb-ambience> |
| Retro | 5 Chiptunes (Action) — *level1* | SubspaceAudio (submission creator) | CC0 1.0 | <https://opengameart.org/content/5-chiptunes-action> |
| Calm | Underwater Theme | Cleyton Kauffman | CC0 1.0 | <https://opengameart.org/content/underwater-theme> |

Licence deed: <https://creativecommons.org/publicdomain/zero/1.0/>
Legal code: <https://creativecommons.org/publicdomain/zero/1.0/legalcode>

### Per-track detail

**Epic — Battle Theme A** (`assets/music/epic.mp3`)
From `/content/battle-theme-a`, uploaded by *cynicmusic*. Described by the author
as *"Epic battle theme for RPG. Some pretty epic strings and horns here will add
a lot of excitement to your game or projects!"* Chosen as the default because
"Epic" is the game's own word and this is the most cinematic of the four.
The page carries an optional attribution request (*cynicmusic.com /
pixelsphere.org*). CC0 does not require it; it is honoured anyway.

**Mysterious — Forgoten tomb ambience** (`assets/music/mysterious.mp3`)
From `/content/forgoten-tomb-ambience`, submitted by **kindland**. The author
states *"Works good for tombs, labirynths, etc, with this ambience playing on low
volume"*. *(The title is misspelled on the original page; the filename is kept
as-is for traceability.)*

**Retro — 5 Chiptunes (Action), track 1** (`assets/music/retro.mp3`)
From `/content/5-chiptunes-action`, submitted by **SubspaceAudio** as part of
the 400 Indie Game Music Loops pack. The page describes the five tracks as
seamlessly looping. The submission identifies SubspaceAudio as its creator; the
specific *level1* file metadata does not provide a separate artist credit, so
no other artist is attributed here.

**Calm — Underwater Theme** (`assets/music/calm.mp3`)
From `/content/underwater-theme`. Author's description: *"Bell, flute and
arpeggios… Looped: Yes. Format: MP3, WAV."* and an explicit notice
*"Music by Cleyton Kauffman"*. Looped seamless playback is stated by the author.

## How this was verified

Each submission page was fetched and its **own**
`field-name-field-art-licenses` field was read directly. That field is the
submission's own statement of its licence, and for all four pages it contains
**CC0 and nothing else**.

This check was not a formality. OpenGameArt's search filter was found to be
**unreliable**: a search filtered to CC0 returned *Mysterious Ambience (song21)*,
whose licence field in fact lists **CC-BY 3.0, CC-BY-SA 3.0 and GPL 3.0
alongside** CC0. That track was therefore rejected. Trusting the search result
would have shipped a track under a licence the author never actually offered
unconditionally.

Every track shipped here was confirmed individually against its own page. The
creator listed in each page's metadata is used above; no unverified artist credit
is inferred from other submissions or filenames.

## Re-encoding

The originals were large (1.5–6.5 MB). All four were re-encoded locally with
FFmpeg to **96 kbps stereo, 44.1 kHz MP3**, preserving duration exactly, to keep
the download light for visitors on mobile data:

```
ffmpeg -i original.mp3 -codec:a libmp3lame -b:a 96k -ar 44100 -ac 2 track.mp3
```

Total after re-encoding: **6.4 MB** for four tracks. Each file was then decoded
end-to-end with FFmpeg to confirm it plays without errors.

CC0 permits modification and redistribution, so re-encoding is permitted. No
attribution is required by the licence; the credit table above is given as a
courtesy to the musicians, not as a licence condition.

## Not used

- **OGG-only tracks were rejected** despite being CC0, because Ogg Vorbis is not
  reliably supported by Safari or iOS. All four shipped tracks are MP3.
- No commercial or copyrighted recordings were used anywhere.