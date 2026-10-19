'use strict';
const assert = require('assert');
const { startFakeSupabase, makeBrowser, startServer, stopServer } = require('./security-tests');
const clients = [];
async function wait(predicate) {
  const end = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Fresh account reconnect response timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function action(client, data, type = 'state') {
  const mark = client.events.length;
  client.ws.send(JSON.stringify(data));
  await wait(() => client.events.slice(mark).some(e => e.type === type));
  return client.events.slice(mark).find(e => e.type === type);
}
(async () => {
  const fake = await startFakeSupabase();
  let bundle;
  try {
    bundle = await startServer(fake.url);
    const port = bundle.port;
    async function account(name, verified = true) {
      const browser = makeBrowser();
      const reg = await browser.post(port, '/api/register', { username: name, password: 'password-1234', email: name + '@example.com' });
      assert.strictEqual(reg.data.ok, true, JSON.stringify(reg.data));
      if (verified) assert.strictEqual((await browser.post(port, '/api/account/email/verify', { code: fake.otp.last.code })).data.ok, true);
      return browser;
    }
    async function connect(browser) { const c = await browser.connect(port); clients.push(c); return c; }
    const alice = await account('resumealice'), bob = await account('resumebob');
    const unverified = await account('resumeunverified', false);
    const host = await connect(alice), guest = await connect(bob);
    await action(host, { type: 'create' });
    await action(guest, { type: 'join', code: host.state.code });
    await action(host, { type: 'start', rounds: 10 });
    const saved = { code: host.state.code, token: host.state.resumeToken };
    const original = host.state;
    host.ws.terminate();
    await wait(() => guest.state.paused);
    for (const [name, browser] of [['wrong account', bob], ['signed out', makeBrowser()], ['unverified account', unverified]]) {
      const client = await connect(browser);
      const error = await action(client, { type: 'resume', ...saved }, 'error');
      assert(error.message);
      assert(!client.state, name + ' must not receive a private snapshot');
      assert(guest.state.paused, name + ' cannot unpause the match');
      console.log('PASS resume refused for ' + name + ' even with the real token');
    }
    const resumed = await connect(alice);
    await action(resumed, { type: 'resume', ...saved });
    await wait(() => !guest.state.paused);
    assert.strictEqual(resumed.state.seat, original.seat);
    assert.strictEqual(resumed.state.phase, original.phase);
    assert.strictEqual(resumed.state.players[original.seat].name, original.players[original.seat].name);
    assert.notStrictEqual(resumed.state.resumeToken, saved.token);
    console.log('PASS verified original account restores its exact seat during opening dice');
    const replay = await connect(alice);
    assert.strictEqual((await action(replay, { type: 'resume', ...saved }, 'error')).code, 'resume-invalid');
    assert(!replay.state);
    console.log('PASS old token is refused even for the correct account');
    console.log('Authenticated reconnect: 5 passed, 0 failed');
  } finally {
    clients.forEach(c => c.ws.terminate());
    await stopServer(bundle);
    await fake.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
