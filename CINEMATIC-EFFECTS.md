# PHOENIX cinematic effects

Presentation only. Card rules, chances, durations, ally availability, turn order,
victory conditions, authentication and invitation handling are not changed.

## Card coverage

All 14 catalogue entries have distinct colours, symbols and generated sounds.
The original card faces and artwork are not replaced.

| Card / outcome | Visual | Original synthesized sound |
| --- | --- | --- |
| +10,000 Points | Rising gold star and motes | Bright ascending three-note chime |
| Knife | Angled steel slash | High metallic scrape and falling strike |
| Hunter | Green ward crest | Resonant two-note ward |
| Zombie | Toxic green mist | Descending low ominous pulse |
| Steal Points | Violet generic token travels from victim to actor | Rising transfer tones and filtered whoosh |
| Judge | Gold judgment impact | Low-high resonant verdict and impact texture |
| Reveal Deck | Cyan eye opens | Clear two-note reveal shimmer |
| Skip Everyone | Lavender rotating time ring | Short looping time motif |
| Phoenix | Orange-gold rising flame seal and embers | Four-octave rising fire swell and noise rush |
| Trick | Purple skewed illusion seal | Detuned mysterious three-note motif |
| Steal a Turn | Blue hourglass/time ring | Ascending control motif |
| Curse | Violet cursed rune | Descending dissonant tones |
| Ghost | Pale spectral mist | Airy ascending tones |
| Alvin, inspection | Warm reveal seal | Soft two-note anticipation |
| Alvin, completed destruction | One generic card-back silhouette burns away | Falling burn tones and filtered fire texture |
| Curse, triggered | Violet impact rune | Low two-note impact |
| Hunter reflection, if emitted by engine | Green ward response | Three-note reflection response |

Judge's inert/no-victim result, an already-held Hunter, an empty Alvin/Curse
target and a zero-point Steal use a dim stationary seal and subdued short tone;
they do not depict an outcome that did not occur. Alvin's burn runs only after
the chooser completes destruction, not when the initial card is played.

## Ally coverage and existing implementation gaps

| Actual server outcome | Visual | Original synthesized sound |
| --- | --- | --- |
| Phoenix: Sneaky Snatcher succeeds | Gold anonymous card-back transfer | Three-note theft flourish and whoosh |
| Tilly: Protective Paws blocks theft | Purple shield crest | Two-note paws ward |
| Ted: Slobbery Surprise activates | Blue expanding slobber blob and droplets | Low bubbly three-note glissando |
| Ted: Protective Howl blocks theft | Blue howl ward | Rising/falling howl motif |
| Louie: Quick Reflexes blocks theft | Blue reflex shield | Fast descending response |
| Simba: Sharp Claws blocks theft | Orange claw shield | Sharp two-note metallic response |
| Elsie: Untouchable blocks theft | Pink diamond shield | Bright high two-note shimmer |
| Maple: neutral Sweet Tooth activates | Mint leaf rune, on affected seat | Sweet ascending chime |
| Maple: server rejects a restricted aggressive move | Private mint leaf rune, actor only | Short descending restriction chime |

The actual server only implements Phoenix's theft, these anti-theft defenses,
Ted's fog and neutral Maple's restriction. It does **not** execute Tilly's
advertised Trouble Maker, Louie's Puppet Master, Simba's Card Sabotage, or
Elsie's advertised Louie/Maple defenses. Distinct visual/sound definitions for
the dormant active abilities exist (purple impact, blue control rune, orange
slash, pink ward), but are intentionally not triggered speculatively.
Implementing their game mechanics requires a separate authorized change.

Maple has **no protection/shield ability** in this repository. Sweet Tooth still
rolls independently at 40%, restricts one player for three rounds, does not
stack, and enforces nice cards on the server. Ted still hides the affected
player's own card faces for three rounds. Hunter reflection is defensive
presentation support only: current legality rules prohibit aiming Zombie at a
Hunter, so that reflection branch is not normally reachable.

## Audio provenance and settings

No third-party sound assets were added. `js/effects-client.js` generates every
sound using Web Audio oscillators and original deterministic procedural noise.
The note/waveform recipes are in `js/effects.js`; there are no sampled recordings
or third-party licences to attribute. Existing music assets and their licensing
in `MUSIC-LICENSES.md` are unchanged.

- `phoenix.effects.v1`: enabled flag, sound volume (default 35%), visual mode.
- Music keeps `phoenix.music.v1`, all four tracks, Disabled and Epic at 25% for
  new browsers. No preference migration or overwrite.
- Sound and visuals can be disabled independently. Zero sound volume creates no
  voices. Mute stops existing voices. Settings write failures are reported.
- A separate, conservative master gain, gentle note envelopes, compression and
  a three-voice limit bound audio peaks. Sound never changes the music element.
- Context creation/resume happens synchronously on genuine clicks/keypresses.
  Blocked sounds reuse the global music/audio recovery button. No autoplay policy
  bypass. Old sounds are not replayed belatedly after unlocking.
- Missing Web Audio is reported in Settings; visuals and gameplay still work.

Settings is available from the single-player match header and the multiplayer
header (including lobby/dice/draft). It is an accessible modal with background
input disabled, a focus loop and Escape/Return to Match. Closing it restores the
same screen and focus; it never recreates a game, reconnects a socket or restarts
music. Multiplayer continues to receive authoritative updates while it is open;
game overlays are suppressed over Settings, without replaying them on return.

## Multiplayer, privacy and lifecycle

Server-confirmed card events and completed ally mutations append to a bounded
64-event room journal. Snapshots expose only stream ID, sequence and events with
`id`, `key`, public actor/target seat and active/inert outcome. Neither private
hand contents, destroyed/stolen identities, curse marks, options nor engine log
strings are copied into the effect channel. Tokens are anonymous shapes, never
clones of a private card face. The first snapshot/reconnect is a baseline;
subsequent event IDs play once. Repeated/stale packets are ignored.

An existing public-log privacy leak was also closed: private draw/reveal/burn
details are retained only for the authorized actor, and are suppressed while
that recipient is under Ted's fog. Other recipients get generic public text.
Existing recipient-specific hands and pending-choice options are unchanged.

Single-player uses completed engine batches, not selection clicks; rerenders do
not replay them. Up to three overlays/voices run simultaneously. Older ones are
removed under load. Normal overlays finish within 1.5 seconds and reduced-mode
overlays within 650 ms, with fallback timers even if animation events fail.
Particles are limited to eight per overlay. All overlays are pointer-transparent,
ARIA-hidden and independent of game progression. Tab hiding, room exit and page
unload clear resources; page unload closes the sound context.

System reduced-motion overrides Full. Reduced mode has only a short opacity
fade, no travel, rotation, scaling or particles. Disabled visuals allocate no
overlay. There is no screen shake, full-screen flash or intense flashing.

## Verification

`npm test` runs the original suite plus cinematic/controller tests and a real
three-client WebSocket match on a temporary port with random test credentials.
The child server and sockets are stopped afterward. Coverage includes every
card, each ally's presentation identity, every implemented ally handler, privacy,
network deduplication, persistence, mute/zero-volume, reduced motion, resource
cleanup and preservation of gameplay/music behavior.

Desktop Chromium browser checks include real settings clicks, Web Audio unlock,
a completed local card play, no duplicate on rerender, and resource cleanup.
A same-origin 375px-wide iframe checks real narrow-layout CSS, settings overflow,
reduced-mode particles, mute and cleanup. This is layout testing, not physical
mobile/device testing. Native Edge/Chrome/Firefox and mobile Safari still require
manual device validation; actual autoplay policies vary by browser and profile.

Validation on 2026-10-10: **327 headless tests and 7 live multiplayer tests passed,
zero failed**. Desktop checks also verified both Settings entry points, same-game
return/focus restoration, Escape, concurrent music, generated fire audio, settings
persistence after reload and no console errors. The 375px layout check verified
online Settings return, no horizontal overflow and zero remaining resources.
