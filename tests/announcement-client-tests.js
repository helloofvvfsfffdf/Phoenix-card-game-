/* Phoenix - announcement browser tests
 * ---------------------------------------------------------------------------
 * The browser half of announcements, driven against the same stub DOM every
 * other browser test here uses. What is being proved:
 *
 *     - the corner card on the main menu shows the NEWEST post, as words
 *     - an announcement containing HTML is shown as literal text and never
 *       becomes markup, so nobody can post a working tag into the menu
 *     - with nothing to say, or a server without the migration, the card stays
 *       hidden rather than showing an empty box or an error
 *     - the archive lists the window newest first, each post with its date
 *     - the owner's composer sends the words and NOTHING else: no role, no
 *       username, nothing this file chose for itself
 */
'use strict';

var browser = require('./music-player-tests').browser;

/** A POST or GET captured from the stubbed fetch. */
function sent(requests, method) {
  return requests.filter(function (r) {
    return r.opts.method === method;
  });
}

/**
 * A page with the announcement module on it.
 *
 * `box.payload` is what the server says. `test()` is synchronous, so the
 * module's fetch is answered by a thenable that resolves inline - the same
 * chain shape fetch gives it, minus the waiting.
 */
function harness(payload, replyTo) {
  var b = browser({ track: 'off', volume: 0.25 });
  b.requests = [];

  // The stub replaces Date with a {now()} shim, which is all the music
  // controller needs. Turning a timestamp into something a person can read
  // needs the real one.
  b.context.Date = Date;

  function resolve(value) {
    if (value && typeof value.then === 'function' && value.__sync) return value;
    return {
      __sync: true,
      then: function (fn) { return resolve(fn(value)); },
      catch: function () { return resolve(value); }
    };
  }

  b.context.fetch = function (url, opts) {
    opts = opts || {};
    b.requests.push({
      url: url,
      opts: opts,
      body: opts.body ? JSON.parse(opts.body) : null
    });
    var reply = replyTo ? replyTo(url, opts) : payload;
    return resolve({
      status: 200,
      ok: true,
      json: function () { return resolve(reply); }
    });
  };

  // Loading the script fires its DOMContentLoaded wiring, which fetches the
  // list and paints the card.
  b.loadScript('announcement-client.js');
  return b;
}

function archive(payload) {
  return {
    ok: true,
    available: true,
    windowDays: 30,
    maxLength: 400,
    announcements: payload
  };
}

module.exports = function (test, equal, deepEqual, assert) {
  test('the main-menu corner card shows the newest announcement, as words', function () {
    var b = harness(archive([
      { body: 'Season two begins tonight.', createdAt: '2026-10-14T09:00:00.000Z' },
      { body: 'An older post.', createdAt: '2026-10-01T09:00:00.000Z' }
    ]));
    var card = b.nodes['menu-announcement'];

    equal(card.hidden, false, 'the card is revealed');
    equal(b.nodes['menu-announcement-body'].textContent,
      'Season two begins tonight.', 'the NEWEST post is the one shown');
    equal(b.nodes['menu-announcement-stamp'].textContent, '14 OCT 2026',
      'dated in UTC so every device agrees');
  });

  test('HTML inside an announcement is shown as literal words, never as markup', function () {
    var nasty = '<img src=x onerror="alert(1)"><b>I am the owner</b>';
    var b = harness(archive([{ body: nasty, createdAt: '2026-10-14T09:00:00.000Z' }]));
    var body = b.nodes['menu-announcement-body'];

    equal(body.textContent, nasty, 'every character survives, as text');
    equal(body.children.length, 0, 'and not one element was created from it');

    // The same is true of the archive, which is where the risk really lives.
    var item = b.nodes['announcement-list'].children[0];
    equal(item.children[1].textContent, nasty, 'the archive prints it too');
    equal(item.children[1].children.length, 0, 'with no markup either');
  });

  test('nothing to say, or a server without the migration, leaves the card hidden', function () {
    var empty = harness(archive([]));
    equal(empty.nodes['menu-announcement'].hidden, true, 'an empty list shows no card');

    var unavailable = harness({ ok: false, available: false });
    equal(unavailable.nodes['menu-announcement'].hidden, true,
      'an unavailable server shows no card, and no error');
  });

  test('the archive lists the window newest first, each post with its date', function () {
    var b = harness(archive([
      { body: 'Newest.', createdAt: '2026-10-14T09:00:00.000Z' },
      { body: 'Middle.', createdAt: '2026-10-08T09:00:00.000Z' },
      { body: 'Oldest.', createdAt: '2026-09-20T09:00:00.000Z' }
    ]));

    var list = b.nodes['announcement-list'];
    equal(list.children.length, 3, 'one entry per post');
    deepEqual(list.children.map(function (li) { return li.children[1].textContent; }),
      ['Newest.', 'Middle.', 'Oldest.']);
    equal(list.children[0].children[0].textContent, '14 OCT 2026');
    equal(list.children[2].children[0].textContent, '20 SEP 2026');
    equal(b.nodes['announcement-empty'].textContent, '',
      'a filled archive leaves no empty notice behind');
  });

  test('the owner composer sends the words and nothing else', function () {
    var b = harness(archive([]), function (url, opts) {
      if (opts.method === 'POST') {
        return { ok: true, announcement: { body: 'A new season!', createdAt: '2026-10-14T09:00:00.000Z' } };
      }
      return archive([]);
    });

    b.nodes['announce-body'].value = '  A new   season!  ';
    b.nodes['announce-post'].onclick();

    var posts = sent(b.requests, 'POST');
    equal(posts.length, 1, 'exactly one post went out');
    deepEqual(Object.keys(posts[0].body).sort(), ['body'],
      'the request carries the words and nothing this page chose for itself');
    equal(posts[0].body.body, 'A new   season!', 'trimmed, but otherwise untouched');
    equal(b.nodes['announce-body'].value, '', 'the box is cleared once it is posted');
    equal(b.nodes['announce-feedback'].textContent,
      'Posted. It is on the main menu now.');
  });

  test('an empty box posts nothing at all', function () {
    var b = harness(archive([]));
    b.nodes['announce-body'].value = '   ';
    b.nodes['announce-post'].onclick();

    equal(sent(b.requests, 'POST').length, 0, 'nothing was sent');
    equal(b.nodes['announce-feedback'].textContent, 'Write an announcement first.');
  });
};
