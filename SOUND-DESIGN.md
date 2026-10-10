# PHOENIX — cinematic sound design

## Current cinematic overhaul

The material gestures below are now the foundation of a **fantasy-game mix**, not
the whole effect. `MAGIC` layers add distinct impact bodies, magical resonances,
creature undertones and spatial shimmer. Four short room reflections replace the
prior two-tap dry room; card audio including tails remains below 1.8 seconds.
No increase in master gain or peak/RMS ceilings was used to create drama.

| Intensity | Design |
| --- | --- |
| 1: regular reward | +10,000 Points gets a longer irregular coin cascade with a light sparkling tail; twelve local golden coins and a restrained aura. |
| 2: special cards and allies | Existing action gestures gain fantasy depth and individually styled auras/ribbons, sparks, flame or mist. No full-screen flash or control lock. |
| 3: match victory | A 4.9-second original brass/choir fanfare with ceremonial pressure impacts, roaring fire and a starlight finale; five-second winner-only theatrical stage. Defeat/draw use quieter 1.7-second codas. |

### Fantasy layer inventory (on top of the material inventory below)

| Effect | Cinematic additions |
| --- | --- |
| Knife | Low strike body and high steel shimmer; sweeping blade streak. |
| Hunter / reflection support | Bow ward resonance/reverse intake; reflection has recoil shimmer and a short impact. No rule changed. |
| Zombie | Deeper growl and low pressure under ragged throat/breath; green fumes. |
| Steal Points / ally Phoenix | Magical suction and pocket shimmer / quicker higher card-snatch sparkle. |
| Judge | Low verdict body and solemn resonance; broad impact rings. |
| Reveal Deck | Airy reveal sparkle and breath; eye-shaped outer ribbon. |
| Skip Everyone | Reverse time intake and braking impact; rotating temporal rings. |
| Phoenix | Rising creature/fire undertone, broad magical resonance and pressure release; enlarged flame aura and embers. |
| Trick | Unstable mask resonance and airy misdirection; skewed illusion ribbon. |
| Steal a Turn | Low control resonance and cord intake; tightened control ribbon. |
| Curse / trigger | Dark murmuring growl and rune resonance / heavier breaking-seal body. |
| Ghost | Soft spectral resonance and diffuse sparkle under the whisper; translucent concentric mist. |
| Alvin / burn | Small ignition resonance / supernatural low flame voice and burning impact, purple rune around the disappearing card silhouette. |
| Ted's Slobbery Surprise / Protective Howl | Soft wet body and extra liquid drops / creature chest and magical ward resonance; droplet aura / concentric howl waves. |
| Tilly's Protective Paws | Warm padded ward resonance and soft interception body. |
| Louie's Quick Reflexes | Fast reverse dodge and sharp sparkle; rapid reflex shield. |
| Simba's Sharp Claws | Close scratch body and abrasive magic tail; triple-rake ribbon. |
| Elsie's Untouchable | Glass-like ward resonance and high sparkle; diamond ribbon. |
| Maple's Sweet Tooth / private rejection | Sugar sparkle and gentle warm resonance / restrained short sparkle reminder. Leaf/sugar motes, never a fictional shield. |
| Victory | Three broad harmonic brass gestures, sustained warm choir model, ceremonial impact/fire and falling starlight. It is a layered musical fanfare, not card notification beeps. |
| Defeat / draw | Fallen-banner cloth, low breath and soft fading resonance / balanced unresolved resonance and settling air. |

All are original synthesis. Brass/choir/animal descriptions identify **models and
creative intent**, not recordings or authentic performances. No third-party SFX
licences or new attribution requirements; music files/licences are untouched.

### Preview and lifecycle

Settings → **Sound Effects Preview** has 29 choices: every non-dormant card/ally
recipe (Hunter reflection support explicitly labelled), plus victory/defeat/draw.
Play replaces the previous preview, Stop cancels it, and changing the selection,
Escape or leaving Settings stops it. Preview does not start a match, invoke game
mechanics, send packets or alter saved preferences. Muted/zero-volume previews
stay silent and explain why. An explicitly requested preview may wait for its
gesture-initiated AudioContext resume; cancelled requests cannot play later.

SFX stay on the existing independent saved volume, 0.18 master scaling, compressor,
0.78 PCM peak ceiling and 0.14 RMS ceiling. The winner fanfare takes priority over
ordinary SFX, with one source rather than a separate live graph for each layer.
The longer fanfare is pre-rendered during available idle time after genuine audio
unlock and cached without playing; unsupported browsers render on demand. Cold
synthesis can cost a few hundred milliseconds on this desktop and potentially
more on low-end devices; physical-device profiling remains outstanding.

Automatic victory is server-confirmed multiplayer only. First/reconnect snapshots
are baselines; stream/terminal latching prevents replay. The normal final screen
remains after the skippable stage. Music still resumes immediately at match end,
without ducking, a delay, or saved-preference changes. Reduced motion uses a
static crest/title; disabled visuals allocate no stage. See CINEMATIC-EFFECTS.md.

### Current validation (2026-10-10)

**446 headless tests and 9 live multiplayer tests pass.** Added coverage includes
all preview choices, pending preview cancellation, audio peaks/RMS, idle warmup,
server winner vs own seat, defeat/draw, finished baselines, repeats/stale states,
five-second lifetime, skip, focus preservation, reduced motion, disabled visuals,
page/connection cleanup and unchanged immediate match-end music restoration.

An opt-in native headless Edge check (`node tests/cinematic-browser-check.js`)
passed all 29 real Web Audio previews, UI Play/Stop/mute/zero-volume controls, and
a real three-player match with a confirmed browser-player victory. It also checked
normal cleanup/repeated final snapshot suppression, desktop winner decorations,
375px device-metrics layout, skip, and native system reduced-motion emulation.
No browser errors; all audio output was silenced deliberately at the destination.
The screenshot was visually reviewed. The check uses a separate temporary profile
and no autoplay bypass. Set `PHOENIX_BROWSER_URL` for a running local server and
`PHOENIX_BROWSER_OWNER_PASSWORD` for the optional live match; `BROWSER_EXE` can
select Chrome/Edge. Do not supply production credentials.

These are functional playback, signal, concept and visual checks—not a human
listening verdict or physical mobile-device test. Professional-sounding realism,
speaker/headphone balance and low-end-device performance still need listening
and hardware review. No claim of authentic animal/instrument recordings is made.

## Previous material-design foundation

## Intent and provenance

Replace electronic notification-like note runs with short, recognisable material
gestures. All effects are **original procedural synthesis**, not field recordings,
real animals, real speech, or sampled commercial Foley. No third-party SFX assets
or dependencies were introduced; no new attribution requirements. Existing music
and its licences are unchanged.

`js/sound-design.js` contains the concepts, layer timing and pure PCM renderer.
`js/effects.js` selects recipes only for whitelisted presentation keys.
`js/effects-client.js` plays one cached buffer per event. Nothing reads a hand,
card identity, player name, secret curse mark or log to generate sound.

## Complete implemented inventory and creative rationale

| Card / outcome | Concept | Action and animation fit |
| --- | --- | --- |
| +10,000 Points | Coins drop, bounce and settle | A tangible reward, with irregular metal-body resonances instead of a success melody; fits rising gold motes. |
| Knife | Fast blade swish, abrasive steel scrape, dry strike | Movement before contact; concise enough for the slash. No gore. |
| Hunter | Bow tension, taut string release, trailing air | A hunting tool readied as a ward, not a new damaging attack or gunshot. |
| Zombie | Ragged low throat groan under breathy rasp | Formant-shaped rough pulse excitation makes a creature-like presence, not a low beep; fits toxic mist. |
| Steal Points | Coins scrape and scatter into a rustling pocket | Steals a score stash, distinct from the ally's one-card theft. |
| Judge | Two wooden gavel knocks; second has a heavier body | Firm verdict matched to the gold impact. Only active outcomes get this verdict. |
| Reveal Deck | Three crisp card-fan flicks and soft fabric | Opening a hand, not drawing or announcing its contents. |
| Skip Everyone | Three accelerating clockwork ticks, scrape-brake and catch | Skips past other turns; speeds up then stops with the rotating time ring. |
| Phoenix | Air intake, broad fire roar, low pressure and ember finish | A large legendary eruption; slower and wider than Alvin's close burn. |
| Trick | Cloth mask slides on, reverse suction, sly snap | Disguise and misdirection, not a scoring/attack notification; fits the illusion seal. |
| Steal a Turn | Cord tightens, ratchet catches, string locks | The player takes control of a choice, not literally an extra turn; physical puppet-control metaphor with clockwork elements fits the existing time ring. |
| Curse | Dry scratching, low inharmonic ritual seal, breath | An ominous mark being placed, with no indication of which card is marked. |
| Ghost | Airy, unvoiced whisper dissolves | Untargetable spectral presence; no intelligible words or identity. |
| Alvin: inspection | Cards part, small ignition catches and crackles | Anticipates burning without depicting completed destruction. |
| Alvin: completed burn | Brittle paper crackle, close flame, ash flutter | Destruction sounds only on the existing completed-burn event; more intimate and papery than Phoenix. |
| Curse: triggered | Seal cracks, guttural exhalation | Consequence rather than another placement sound; fits impact rune. |
| Hunter reflection support | String recoils, fast return rush, short impact | Only if the existing engine emits it. Current legality prevents the normal Zombie-to-Hunter route; no mechanic enabled. |
| Inert / no change | Quiet unresolved knock and cloth fall | No fire, full attack or triumphant verdict for an outcome that did not happen. |

| Implemented ally outcome | Concept | Identity and animation fit |
| --- | --- | --- |
| Phoenix: Sneaky Snatcher | One card whisked out, quick air movement, tucked into fabric | Sneaky paper theft, not legendary fire or score coins. |
| Tilly: Protective Paws | Two padded paw thumps and a low warning | A physical interception accompanying the purple shield; not Trouble Maker elimination. |
| Ted: Slobbery Surprise | Thick wet splat, falling liquid bubbles, soft smear | Covers the cards with slobber, matching blob/droplets rather than an electronic bubbling melody. |
| Ted: Protective Howl | Chesty bark opening into a short rising howl | Rough pulse/formant model; recognisably animal-inspired, not claimed to be a real dog recording. |
| Louie: Quick Reflexes | Quick dodge gust and a card slapped back | Fast evasive interception; separate from puppet control. |
| Simba: Sharp Claws | Three abrasive claw rakes and raspy breath | Close scraping gesture with three distinct contacts, not Knife's single blade strike. |
| Elsie: Untouchable | Repel gust meeting glass-hard resonance | Inharmonic glass barrier fits the diamond shield. Not a musical victory chime. |
| Maple: Sweet Tooth | Wrapper crinkles and two sugary crunches | Personality-led sweet treat metaphor for nice-cards-only restriction. Not a fictional shield or attack. |
| Maple: private restriction feedback | Gentle wrapper squeeze and closed-lid tap | Same family, quieter reminder; only the already-authorised actor receives it. |

The server does not execute Tilly's Trouble Maker, Louie's Puppet Master, Simba's
Card Sabotage or Elsie's other advertised defences. Existing dormant presentation
keys retain material recipes, but **no trigger or ability was added**. They are
not included in browser gameplay checks as if they were implemented.

## Engineering and creative review

- Replaced evenly spaced oscillator notes with deliberately staggered material
  layers, sharp contacts, noise friction, inharmonic damped bodies, string motion,
  liquid pitch drops and rough glottal/formant excitation.
- Reviewed every concept against catalogue rules and existing animation. Related
  sounds share materials but differ in order, rhythm, colour and envelope.
- Rebalanced fire after signal review: reduced isolated crackle peaks and brought
  the sustained flame body forward. Capped sustained vocal energy so warnings
  and Ted's howl do not overwhelm shorter material effects.
- Peak limit 0.78 before the unchanged volume-scaled master/compressor; RMS capped
  at 0.14. Brief onset/release envelopes and two short room reflections avoid
  abrupt edges and a long reverberation wash. Durations including tails <=1.3s.
- One source per event, three simultaneous voices maximum. Oldest voice is
  stopped/disconnected when capped. Buffers are reused by key/outcome and dropped
  on page exit/context recreation. No downloads or network audio services.
- Match music/fade, controls, saved keys/defaults, reduced-motion handling,
  authoritative event timing, deduplication, privacy and cleanup are unchanged.

## Verification and honest limits

Prior material-only validation, 2026-10-10: **400 headless tests + 7 live multiplayer tests passed**. Coverage includes
every actual card/ally event, server mutation-to-event mapping, secrecy, repeated
snapshots/reconnect baselines, independent music/SFX preferences, mute/zero volume,
three-voice cap, buffer reuse and cleanup. New PCM tests check every catalogue
recipe at 8, 44.1 and 48 kHz for finite/non-silent samples, bounded peaks, DC and
short ended tails, plus determinism and quieter inert outcomes.

Chromium exercised all 26 non-dormant presentation recipes, including reflection
support, with running Web Audio and real buffer sources. Each produced nonzero
PCM, one voice and eventual cleanup. First-use rendering measured 3–31ms on this
desktop; buffers are cached thereafter. Muting, zero volume, reduced motion,
match-music pause/resume and independent saved preferences worked. Desktop (912px)
and a 375px same-origin frame had no Settings overflow and returned to menu.
No browser console errors. Temporary test tab/server were closed.

Browser test output was deliberately silenced at the destination to avoid stray
music. This is **functional playback and signal/concept review, not a human
listening verdict**. I cannot certify that players will identify every effect
without seeing it, or that synthetic animal sounds are fully convincing. Human
listening on headphones/phone speakers and physical mobile-device performance
remain outstanding; the desktop frame is a layout check, not real mobile audio.
