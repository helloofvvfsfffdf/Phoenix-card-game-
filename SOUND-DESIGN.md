# PHOENIX — action sound redesign

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

2026-10-10: **400 headless tests + 7 live multiplayer tests pass**. Coverage includes
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
