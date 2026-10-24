'use strict';
/**
 * Owner multi-device seating.
 *
 * One account, one seat - except for the verified owner account, which may
 * sit in the same match from several devices at once (multi-device testing).
 * Regular accounts must be refused a second seat; the exception is decided
 * server-side from the session's account role, never from anything a client
 * sends, and it is never revealed to other players.
 */
const assert = require('assert');
const { startFakeSupabase, makeBrowser, startServer, stopServer } = require('./security-tests');

const clients = [];

async function wait(predicate, what) {
  const end = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function action(client, data, type = 'state') {
  const mark = client.events.length;
  client.ws.send(JSON.stringify(data));
  await wait(() => client.events.slice(mark).some(e => e.type === type), type);
  return client.events.slice(mark).find(e => e.type === type);
}

(async () => {
  const fake = await startFakeSupabase();
  let bundle;
  try {
    bundle = await startServer(fake.url);
    const port = bundle.port;

    // Register + verify a fresh account, returned as a browser (cookie jar).
    async function account(name) {
      const browser = makeBrowser();
      const reg = await browser.post(port, '/api/register', {
        username: name, password: 'password-1234', email: name + '@example.com'
      });
      assert.strictEqual(reg.data.ok, true, JSON.stringify(reg.data));
      assert.strictEqual(
        (await browser.post(port, '/api/account/email/verify', { code: fake.otp.last.code })).data.ok,
        true
      );
      return browser;
    }

    async function connect(browser) {
      const client = await browser.connect(port);
      clients.push(client);
      return client;
    }

    const one = await account('seatplayerone');
    const two = await account('seatplayertwo');
    const ownerAcct = await account('seatowner');

    // Promote to owner exactly the way the security suite does: the role
    // lives on the database row and is re-read on every socket handshake.
    fake.state.accounts.find(a => a.username === 'seatowner').role = 'owner';

    /* ---- a regular account gets ONE seat ---------------------------------- */

    const host = await connect(one);
    await action(host, { type: 'create' });
    const roomCode = host.state.code;

    const secondDevice = await connect(one);
    const refused = await action(secondDevice, { type: 'join', code: roomCode }, 'error');
    assert(/already playing/i.test(refused.message), 'second seat must be refused: ' + refused.message);
    assert(!secondDevice.state, 'the refused connection must never see a snapshot');
    assert.strictEqual(host.state.players.length, 1, 'the room must still hold exactly one member');
    console.log('PASS a regular account is refused a second seat in the same match');

    const stranger = await connect(two);
    await action(stranger, { type: 'join', code: roomCode });
    assert.strictEqual(stranger.state.players.length, 2, 'a different account joins normally');
    const refusedAgain = await action(secondDevice, { type: 'join', code: roomCode }, 'error');
    assert(/already playing/i.test(refusedAgain.message));
    assert.strictEqual(host.state.players.length, 2, 'still exactly two seats');
    console.log('PASS the refusal is stable while a different account joins fine');

    /* ---- the owner gets as many seats as devices --------------------------- */

    const dev1 = await connect(ownerAcct);
    // The account message follows the session lookup, so it lands shortly
    // AFTER the socket is open - wait for it rather than race it.
    await wait(() => dev1.events.some(e => e.type === 'account'), 'the account message');
    const accountMsg = dev1.events.find(e => e.type === 'account');
    assert(accountMsg && accountMsg.account.role === 'owner', 'the owner session must carry the owner role');
    await action(dev1, { type: 'create' });          // owner create -> private owner room
    const ownerCode = dev1.state.code;

    const dev2 = await connect(ownerAcct);
    await action(dev2, { type: 'join', code: ownerCode });
    assert.strictEqual(dev2.state.players.length, 2, 'the owner account may take a second seat');
    assert.strictEqual(dev1.state.players.length, 2, 'and the first device sees the new participant');

    const names = dev2.state.players.map(p => p.name);
    assert.deepStrictEqual(
      names, ['seatowner', 'seatowner'],
      'both seats display the same account username: ' + JSON.stringify(names)
    );
    console.log('PASS the owner account sits in the same match from two devices, same username');

    /* ---- the exception stays owner-only, in an owner room too ------------- */

    // A fresh regular account (nobody is seated in the owner room yet) may
    // join it once - but its second device is refused there exactly as in a
    // public room. The check runs before the match starts, while the room is
    // still in its lobby, so the refusal is the seat check's and not a
    // "match already running" answer.
    const three = await account('seatplayerthree');
    const regA = await connect(three);
    await action(regA, { type: 'join', code: ownerCode });
    assert.strictEqual(regA.state.players.length, 3, 'a regular account may join an owner room once');

    const regB = await connect(three);
    const refusedInOwnerRoom = await action(regB, { type: 'join', code: ownerCode }, 'error');
    assert(/already playing/i.test(refusedInOwnerRoom.message),
      'a regular account stays one-seat even in an owner room: ' + refusedInOwnerRoom.message);
    assert.strictEqual(dev1.state.players.length, 3, 'the owner room keeps exactly three members');

    // The regular guest leaves again - the match itself runs on the owner's
    // two seats alone. The leaver hears nothing after a leave, so the wait
    // is on the host's view of the room.
    regA.ws.send(JSON.stringify({ type: 'leave' }));
    await wait(() => dev1.state.players.length === 2, 'the regular guest to leave');
    console.log('PASS the exception stays owner-only, even inside an owner-created room');

    /* ---- the two seats are ordinary, independent participants -------------- */

    await action(dev1, { type: 'start', rounds: 10 });
    assert.notStrictEqual(dev1.state.phase, 'lobby', 'match starts with both owner seats present');

    // Drive the full opening to the deal: turn-order dice, ally-order dice
    // (ties simply reroll), then the ally draft. A roll or pick from
    // whoever must wait is refused harmlessly and retried on the next pass.
    for (let i = 0; i < 60; i++) {
      const phase = dev1.state.phase;

      if (phase === 'turnDice' || phase === 'allyDice') {
        dev1.ws.send(JSON.stringify({ type: 'roll' }));
        dev2.ws.send(JSON.stringify({ type: 'roll' }));
      } else if (phase === 'draft') {
        const picker = dev1.state.draftTurn === 0 ? dev1 : dev2;
        const ally = dev1.state.availableAllies && dev1.state.availableAllies[0];
        assert(ally, 'the draft always offers at least one ally');
        picker.ws.send(JSON.stringify({ type: 'chooseAlly', ally }));
      } else {
        break;                              // dealt - the match is under way
      }

      await action(dev1, { type: 'ping' });
      await action(dev2, { type: 'ping' });
    }
    assert(dev1.state.started, 'the match is under way after the opening');
    await action(dev2, { type: 'ping' });

    // Seats are reassigned to the dice turn order at the deal, so the two
    // devices simply have to end up on DIFFERENT seats - never the same one.
    assert.notStrictEqual(dev1.state.seat, dev2.state.seat,
      'the two devices sit on different seats');
    assert([0, 1].includes(dev1.state.seat) && [0, 1].includes(dev2.state.seat),
      'both seats are real seats in the match');
    assert.notStrictEqual(dev1.state.resumeToken, dev2.state.resumeToken,
      'each connection is its own participant, not a mirrored session');

    const hand1 = JSON.stringify(dev1.state.hand || []);
    const hand2 = JSON.stringify(dev2.state.hand || []);
    assert(dev1.state.hand && dev1.state.hand.length, 'device 1 has its own hand');
    assert(dev2.state.hand && dev2.state.hand.length, 'device 2 has its own hand');
    assert.notStrictEqual(hand1, hand2, 'the two seats hold different hands - state is independent');

    const seatBeforePing = dev2.state.seat;
    await action(dev2, { type: 'ping' });
    assert.strictEqual(dev2.state.seat, seatBeforePing, 'pinging keeps each device on its own seat');
    console.log('PASS both owner seats are independent: own seat, own hand, own resume token');

    console.log('Owner multi-device seating: 5 passed, 0 failed');
  } finally {
    clients.forEach(c => { try { c.ws.terminate(); } catch (e) { /* gone */ } });
    await stopServer(bundle);
    await fake.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
