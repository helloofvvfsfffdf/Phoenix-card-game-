# Seven-card test results — 18 October 2026

> Historical pre-fix investigation. The subsequent implementation and retest
> results are in [interactive-fixes-verification.md](interactive-fixes-verification.md).
> Failures below describe the earlier build, not the latest retested working copy.

**Not release-ready.** This follow-up tests the seven new cards other than
Speed. No gameplay fixes, public enablement, deployment, reopening or production
database operations were made during this testing task. Existing working-copy
changes were preserved.

## Real-server checks

Two runs of 30 targeted tests each produced the same **17 passes / 13 failures**.
Each case starts a disposable real server, creates a room through WebSockets,
completes dice and ally drafting, and sends decisions from actual participants.
Most cases have five players; the minimum-player case has three. Fixture hands
contain unique card types. Deterministic test-only RNG reaches specific branches.

| Card | Passed / failed | Confirmed findings |
| --- | --- | --- |
| Rock Paper Scissors | 2 / 1 | Non-tied result, elimination, secrecy and outsider/duplicate rejection work in these checks. A tie ends the interaction instead of repeating. |
| Betrayal | 4 / 1 | All four Share/Steal payout combinations match the stated amounts. The server ignores the opponent selected by the caster. |
| Dice Challenge | 1 / 2 | Higher roll receives 20,000. A tie ends rather than rerolls, and authoritative numeric rolls never reach the clients for animation. |
| Wheel of Fortune | 7 / 4 | Caster spin leaves the interaction stuck in `spun`; other players can spin too. Reshuffle does not recycle cards; reverse does not change actual turn order. |
| Linked Fate | 1 / 1 | Normal bonus sharing gives the partner 5,000. A 20,000-point interactive dice prize gives the partner zero instead of 10,000. |
| Ally Swapper | 0 / 1 | Acknowledgments finish the card, but every snapshot retains the original drafted allies. |
| Impostor | 2 / 3 | Private-word projection, complete clue/vote flow and caught/escaped payouts pass. A three-player room is allowed to start; invalid clue formats and nonexistent vote targets are accepted. |

**Wheel caveat:** its seven passing checks concern isolated effects reached by
synthetically sending `spin` from non-casters (the server converts those to
acknowledgments). The real UI does not provide those acknowledgments. They are
not seven playable Wheel outcomes. The permanent evil-card restriction check
passed, contrary to an earlier unverified suspicion. The elimination check
verifies the initial flag, not all three missed turns.

The tests intentionally fail on the broken requirements. They do not silently
avoid cards or reinterpret an error as a successful move. A revision barrier
requires a fresh state from every client after each accepted action. Invalid
actions must produce a rejection, not merely another broadcast.

## Real-browser checks

Two runs through five actual game pages produced **23 passes / 18 failures**
each across 41 assertions. The repeat used bounded page-readiness checks and
allowed time for an in-card result animation, with the same outcome. These are
same-origin browser frames loading the full game,
not mocked DOMs or injected game states. Automation clicks the actual cards,
target pickers, choices, Roll/Spin/Acknowledge buttons, clue inputs and vote buttons.

- RPS, Betrayal, Dice, Linked Fate, Swapper and Impostor can finish their normal
  decision paths; all five clients receive completion and turn advancement.
- Wheel remains pending after the caster presses Spin. No fabricated non-caster
  actions were sent in the browser test to make that flow look successful.
- RPS, Betrayal, Dice, Linked Fate and Swapper expose active decision controls to
  spectators. This is misleading UI, not proof those spectators can bypass server
  validation: the RPS outsider-rejection check passes.
- Dice's Roll button is re-enabled by its acknowledgment snapshot.
- RPS/Betrayal/Dice/Impostor close their overlays without showing their intended
  in-card result/reveal. Public log results do arrive; this is not a claim that
  no result text exists anywhere on the page.
- Impostor erases an unfinished clue when another player submits, re-enables
  already submitted clue/vote controls, and does not display the collected clues
  during voting. The caught-impostor payout still reaches the correct players.
- Normal Linked Fate sharing works through the browser. Swapper still leaves
  actual ally identities unchanged.
- The completed paths captured no browser exceptions or rejected valid UI
  decisions, and their hand snapshots remained duplicate-free. Absence of an
  exception is not a passing gameplay result.

## Real elapsed idle-timeout recovery

**7 passed / 0 failed.** No timers were shortened or simulated. Each case had five
connected sockets, played its card and submitted no participant decisions. All
five clients eventually received a cleared interaction and advanced turn; no
resolver exception was logged.

| Cards | Configured timeout | Observed elapsed time |
| --- | --- | --- |
| RPS, Betrayal, Dice, Linked Fate, Swapper | 30 seconds | 30,010–30,019 ms |
| Wheel | 60 seconds | 60,028 ms |
| Impostor | 120 seconds | 120,020 ms |

This verifies the idle escape hatch, **not correct resolution or presentation**.
In particular, Wheel's eventual timeout does not fix the normal spin flow that
waits for acknowledgments the browser does not offer. Disconnect/reconnect
recovery was not tested by leaving five sockets connected and idle.

## Requested Wheel label readability change

After the gameplay test runs, the Wheel's visual presentation was changed only:
unskewed, high-contrast short labels, matching numbered full descriptions at
16px, a stationary legend outside the rotating graphic, a stationary pointer,
and slower decorative spinning. Outcome IDs, input messages and server resolution
were not changed. The gameplay failures above remain unresolved.

The actual overlay module passed **16/16 visual layout assertions** in desktop
and narrow browser frames (558px and 318px content viewports): all nine labels
match, no horizontal overflow, no label overlap at rest or clipped label text,
full descriptions at least 16px, 18.7:1 description contrast, and a legend/pointer
that do not rotate with the wheel. This is not mobile-device or gameplay proof.

Visual-only preview: `http://127.0.0.1:4318/tests/wheel-readability-check.html`
while the disposable fixture is running. A narrow-height panel scrolls vertically
to keep every outcome description available without shrinking its text.

## Coverage limits

These are individual interaction checks with controlled hands/RNG, not many
complete random-deal matches. Mobile-device behavior, WAN latency, disconnects,
reconnections, full linked duration, all elimination durations, sound/particle
polish and every combination of allies remain unverified. Passing normal
Impostor scoring does not remove its validation/UI failures.

## Reproduction

```text
npm run test:other-cards
npm run test:card-timeouts
node tests/interactive-local-server.js all 4318 "0.1,0.8"
```

For the last command, open
`http://127.0.0.1:4318/tests/other-cards-browser-check.html` and press **Run seven
cards**. The fixture strips Supabase credentials and uses a temporary server
state. Enabling cards and overriding randomness happens only inside this test
process. Do not deploy this entry point. Stop the fixture after testing.

The new failing network checks are included in `npm test`, before the
account-related suites, so a test run cannot claim release readiness while
skipping these cards. The longer real-time timeout checks have a separate script.
The latest `npm test` run passed the unique-hand checks, 15 interaction checks,
Speed flow, 571 unit tests, 9 effects-network checks and 57 multiplayer/admin
checks, then exited with the same 13 other-card failures. Later account-related
suites were not reached by that run.

Machine-readable network reports from this run are in the approved temporary
directory as `phoenix-other-cards-network.json` and
`phoenix-other-cards-network-repeat.json`; elapsed-timeout results are in
`phoenix-other-cards-timeouts.json`. Browser assertion details are available
as `window.otherCardBrowserStatus` on the diagnostic page.

## Additional server cleanup crash

After all browser scenarios had left their rooms, the shared disposable server
crashed during its idle-room cleanup. The observed exception was
`TypeError: Cannot set properties of null (setting 'member')` at
`server.js:2131`, inside `closeRoom()`, and the process exited with code 1.
Disconnected seats retain a member whose `ws` is null, but this function
unconditionally assigns `member.ws.member`.

`node tests/room-cleanup-regression-tests.js` exercises that actual function with
the disconnected-member shape. This is an additional unresolved stability
blocker, separate from the 30 card assertions and seven idle-interaction timeouts.
The shared browser fixture is no longer running following that crash.
