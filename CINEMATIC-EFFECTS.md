# PHOENIX cinematic effects

Presentation only. Card rules, chances, ability durations, ally availability, turn order,
victory conditions, authentication and invitation handling are not changed.

## Card coverage

All 14 catalogue entries have distinct colours, symbols and generated sounds.
The original card faces and artwork are not replaced.

| Card / outcome | Visual | Original synthesized sound |
| --- | --- | --- |
| +10,000 Points | Rising gold star and motes | Coins landing, bouncing and settling |
| Knife | Angled steel slash | Blade swish, steel scrape and sharp dry strike |
| Hunter | Green ward crest | Bow tension and resonant string release |
| Zombie | Toxic green mist | Ragged throat groan and breathy rasp |
| Steal Points | Violet generic token travels from victim to actor | Coin scrape/scatter and pocket rustle |
| Judge | Gold judgment impact | Two wooden gavel knocks, heavy verdict |
| Reveal Deck | Cyan eye opens | Crisp card fan opening |
| Skip Everyone | Lavender rotating time ring | Accelerating clockwork ticks and brake |
| Phoenix | Orange-gold rising flame seal and embers | Flame intake, broad fire roar and embers |
| Trick | Purple skewed illusion seal | Cloth mask, reverse suction and snap |
| Steal a Turn | Blue hourglass/time ring | Puppet cord, catching ratchet and lock |
| Curse | Violet cursed rune | Ritual scratch, resonant seal and murmuring breath |
| Ghost | Pale spectral mist | Unvoiced whisper dissolving into air |
| Alvin, inspection | Warm reveal seal | Card parting and small crackling ignition |
| Alvin, completed destruction | One generic card-back silhouette burns away | Close paper combustion, flame and ash |
| Curse, triggered | Violet impact rune | Seal crack and guttural exhalation |
| Hunter reflection, if emitted by engine | Green ward response | String recoil, return rush and impact |

Judge's inert/no-victim result, an already-held Hunter, an empty Alvin/Curse
target and a zero-point Steal use a dim stationary seal and quiet knock/cloth fall;
they do not depict an outcome that did not occur. Alvin's burn runs only after
the chooser completes destruction, not when the initial card is played.

## Ally coverage and existing implementation gaps

| Actual server outcome | Visual | Original synthesized sound |
| --- | --- | --- |
| Phoenix: Sneaky Snatcher succeeds | Gold anonymous card-back transfer | Single-card whisk and tuck |
| Tilly: Protective Paws blocks theft | Purple shield crest | Padded paw thumps and low warning |
| Ted: Slobbery Surprise activates | Blue expanding slobber blob and droplets | Thick wet splat and drippy bubbles |
| Ted: Protective Howl blocks theft | Blue howl ward | Chesty bark into short howl |
| Louie: Quick Reflexes blocks theft | Blue reflex shield | Fast dodge and card slap |
| Simba: Sharp Claws blocks theft | Orange claw shield | Three claw rakes and raspy warning |
| Elsie: Untouchable blocks theft | Pink diamond shield | Repel gust and glass-hard resonance |
| Maple: neutral Sweet Tooth activates | Mint leaf rune, on affected seat | Wrapper crinkle and two sugary crunches |
| Maple: server rejects a restricted aggressive move | Private mint leaf rune, actor only | Wrapper squeeze and closed-lid tap |

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

No third-party sound assets were added. `js/sound-design.js` renders original
layered procedural Foley into PCM; `js/effects-client.js` caches and plays it with
Web Audio buffer sources. Material resonances, textured transients, crackling fire
and formant-shaped vocal/breath models replace the old note sequences. Legacy
note metadata in `DEFINITIONS` is retained to avoid changing the visual catalogue,
but is not played. There are no sampled recordings or third-party SFX licences
to attribute. Full concepts, provenance and review limits: [SOUND-DESIGN.md](SOUND-DESIGN.md).
Existing music assets and their licensing
in `MUSIC-LICENSES.md` are unchanged.

- `phoenix.effects.v1`: enabled flag, sound volume (default 35%), visual mode.
- Music keeps `phoenix.music.v1`, all four tracks, Disabled and Epic at 25% for
  new browsers. No preference migration or overwrite.
- Sound and visuals can be disabled independently. Zero sound volume creates no
  voices. Mute stops existing voices. Settings write failures are reported.
- A separate, conservative master gain, short material envelopes, compression and
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
The result celebration is below Settings in the stacking order and never locks
game input. The Settings preview selector auditions 26 non-dormant card/ally
recipes (including clearly labelled Hunter reflection support), plus victory,
defeat and draw codas. Play/Stop, selection changes, Escape and Settings exit stop
or replace previews. Previewing never sends a move or enables an unfinished ally.

## Automatic match music

Background music is reserved for the menu, gallery, multiplayer lobby, dice and
ally draft. An authoritative snapshot with `started: true`, `phase: playing`
and `over: false` activates the multiplayer silence gate. The local match uses
the real engine's `over` state and active game view. Entering gameplay fades the
single existing music element to zero over 450 ms, then pauses it. This temporary
policy never writes Disabled or zero volume into the player's saved preferences.

All playback paths share this gate: track/volume changes, global audio recovery,
first gestures, repeated snapshots and in-match Settings cannot start music.
Disconnect does not clear a known active match. A returning active snapshot stays
silent; an authoritative match-end snapshot or explicit match exit restores the
saved track/volume and reuses the same audio element (and position if the track is
unchanged). Disabled stays disabled. If resumed playback is rejected, the existing
enable-audio button remains available. Leaving during the fade cancels it so a
stale timer cannot pause menu music later. Hiding a tab pauses a match immediately;
back-forward-cache restoration respects the retained match gate.

SFX remain independent and enabled according to `phoenix.effects.v1`, including
when music is Disabled or temporarily paused. Reduced motion does not mute SFX.
The cinematic overhaul preserves every trigger and game rule, enhancing the
visuals with bounded auras, ribbons, coins, sparks and flame/spectral layers.
Paper, metal, wood, cloth, fire and vocal-like sounds now have fantasy resonances,
controlled impact bodies and short spatial reflections, not just literal Foley.
Each actually implemented event has a distinct recipe. Dormant ally abilities are
still not activated. A three-voice cap, conservative master gain, compression and
short envelopes keep peaks controlled. Muted sounds allocate no voices.

Some mobile browsers enforce hardware/system volume rather than HTML media
volume; on those devices the 450 ms pause still applies but the native music fade
may not be audible. No browser policy is bypassed to force playback or fading.

## Multiplayer, privacy and lifecycle

### Five-second confirmed victory

Only an observed active-to-finished **server state snapshot** arms the new result
celebration. The client's seat ID is compared with the server's existing winner
ID; scores are never used to guess a winner. Existing ties (`winner: null`) get a
balanced draw coda. Winner: five seconds of golden beam sweeps, three staggered
firework blooms, Phoenix-inspired feather sparks, confetti, embers, a rising
VICTORY title and a layered brass/choir/fire fanfare. Defeat: a 2.4-second quiet
spectral banner and low coda, no fireworks or victory sound. The normal server
winner/standings screen renders underneath and remains after the overlay clears;
its heading now correctly distinguishes the viewer's victory, defeat or draw.

Skip button and Escape dismiss the celebration and stop its audio. It is a
non-modal, pointer-transparent region (only Skip handles input), does not steal
focus, and sits below Settings. Reduced mode/system preference uses a static
title/crest, no moving beams or particles. Disabled visuals create no stage;
SFX remain independent. The full stage is bounded to 101 decorative nodes on
desktop and 63 on narrow screens, plus a fixed message/skip structure. Smooth,
single-run opacity envelopes and small staggered bursts avoid strobing and
full-screen flashes. Hiding, page exit, disconnect, skip and changing motion mode
clean up the stage and sources.

Initial/reconnect snapshots are baselines, including completed matches: no old
celebration or fanfare is replayed. Terminal stream IDs stay latched across cursor
reset; repeats, stale snapshots and resumed finished baselines cannot celebrate
again. No server, rules, winner selection, turn logic or auth changes. Automatic
celebrations are multiplayer-only, as required by the server-confirmation gate;
the local engine's existing winner screen remains unchanged.

The fanfare stops ordinary SFX when it starts; later journal IDs still advance
without overlapping it. The music gate continues to release immediately at the
server's match end—there is no five-second music delay, saved preference write,
ducking or soundtrack replacement. Muted fanfares are not replayed after unmute.

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

Original cinematic validation on 2026-10-10: **327 headless tests and 7 live multiplayer tests passed,
zero failed**. Desktop checks also verified both Settings entry points, same-game
return/focus restoration, Escape, concurrent music, generated fire audio, settings
persistence after reload and no console errors. The 375px layout check verified
online Settings return, no horizontal overflow and zero remaining resources.

Match-audio validation on 2026-10-10: **367 headless tests plus 7 live multiplayer
tests passed, zero failed**. A Chromium browser also ran a real three-player room
through lobby, dice, draft, gameplay, in-match settings and match end. Music played
before gameplay, faded/paused at its authoritative start, stayed paused through
track/volume changes, and restored Mysterious at the saved 41% on match end. SFX
voices ran while music was paused and cleaned up afterward. A simulated autoplay
rejection exposed recovery; subsequent interaction restored playback. A 375px
same-origin frame verified no settings overflow, match pause, return resume and
Disabled remaining silent. Browser output was silenced deliberately to avoid
leaving test music audible; these are functional checks, not subjective listening
or physical-device validation. Test tabs and temporary servers are closed afterward.
# Phoenix-only quality experiment

The approved Effekseer winning-screen study is now integrated on
`feat/effekseer-victory-integration`. See `VICTORY-INTEGRATION.md` for the exact
9.7-second schedule, bundled assets, winner/ally identity, lifecycle and validation.
This supersedes the earlier five-second CSS winner stage described below; all
other card/ally designs remain unchanged.

The `experiment/phoenix-fire-takeover` branch replaces only the legendary Phoenix
card's small overlay with locally bundled photographed fire, original giant
bird artwork and a 4.4-second full-screen stage. See `PHOENIX-EXPERIMENT.md` for
the preview button, authoritative timing, licensing and validation. All other
card/ally/result designs described below remain unchanged.
