/* Phoenix - leaderboard browser tests
 * ---------------------------------------------------------------------------
 * The browser half of the leaderboard, driven against the same stub DOM every
 * other browser test here uses. What is being proved:
 *
 *     - nothing is fetched until the board is actually opened
 *     - opening it draws the rows the SERVER sent, ranked, with medals for the
 *       top three and plain numbers after
 *     - a username is drawn as characters and never becomes markup, so nobody
 *       can register a name that draws an element onto somebody else's screen
 *     - the owner cannot be added here: this file draws exactly the rows it is
 *       given and invents nothing
 *     - an empty board and a server without the migration each say something
 *       calm, rather than showing an error or a blank box
 */
'use strict';

var browser = require('./music-player-tests').browser;

function board(rows, available) {
  return {
    ok: available !== false,
    available: available !== false,
    players: rows
  };
}

function harness(payload, replyTo) {
  var b = browser({ track: 'off', volume: 0.25 });
  b.requests = [];

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
    b.requests.push({ url: url, opts: opts });
    var reply = replyTo ? replyTo(url, opts) : payload;
    return resolve({
      status: 200,
      ok: true,
      json: function () { return resolve(reply); }
    });
  };

  b.loadScript('leaderboard-client.js');
  return b;
}

module.exports = function (test, equal, deepEqual, assert) {
  test('nothing is fetched until the leaderboard is opened', function () {
    var b = harness(board([]));
    equal(b.requests.length, 0,
      'the menu is not paying for a board nobody has asked to see');

    b.nodes['menu-leaderboard'].onclick();
    equal(b.requests.length, 1, 'opening it asks for the board once');
    equal(b.requests[0].url, '/api/leaderboard');
    equal(b.nodes['leaderboard-overlay'].hidden, false, 'and the board appears');
  });

  test('the rows the server sent are drawn, ranked, with medals', function () {
    var b = harness(board([
      { rank: 1, username: 'alice', wins: 7 },
      { rank: 2, username: 'bob', wins: 4 },
      { rank: 3, username: 'carol', wins: 2 },
      { rank: 4, username: 'dave', wins: 1 }
    ]));
    b.nodes['menu-leaderboard'].onclick();

    var list = b.nodes['leaderboard-list'];
    equal(list.children.length, 4, 'one row per ranked player');
    deepEqual(list.children.map(function (li) { return li.children[1].textContent; }),
      ['alice', 'bob', 'carol', 'dave']);
    deepEqual(list.children.map(function (li) { return li.children[0].textContent; }),
      ['\u{1F947}', '\u{1F948}', '\u{1F949}', '4'],
      'medals for the top three, plain numbers after');
    deepEqual(list.children.map(function (li) { return li.children[2].textContent; }),
      ['7 WINS', '4 WINS', '2 WINS', '1 WIN'],
      'and one win reads as one win');
    equal(b.nodes['leaderboard-empty'].textContent, '', 'a filled board leaves no notice');
  });

  test('a username is drawn as characters and never becomes markup', function () {
    var nasty = '<img src=x onerror="alert(1)">theowner';
    var b = harness(board([{ rank: 1, username: nasty, wins: 3 }]));
    b.nodes['menu-leaderboard'].onclick();

    var name = b.nodes['leaderboard-list'].children[0].children[1];
    equal(name.textContent, nasty, 'every character survives, as text');
    equal(name.children.length, 0, 'and not one element was created from it');
  });

  test('this file draws exactly the rows it is given and adds nobody', function () {
    // Whatever a caller hoped, the board is only ever the server's rows.
    var b = harness(board([
      { rank: 1, username: 'alice', wins: 2 },
      { rank: 2, username: 'bob', wins: 1 }
    ]));
    b.nodes['menu-leaderboard'].onclick();

    var drawn = b.nodes['leaderboard-list'].children;
    equal(drawn.length, 2, 'the owner is not among them, and cannot be put there');
    deepEqual(
      Array.prototype.map.call(drawn, function (li) { return li.children[1].textContent; }),
      ['alice', 'bob']
    );
  });

  test('a board with no wins says so, rather than sitting empty', function () {
    var b = harness(board([]));
    b.nodes['menu-leaderboard'].onclick();

    equal(b.nodes['leaderboard-list'].children.length, 0, 'no rows are invented');
    equal(b.nodes['leaderboard-empty'].textContent,
      'No wins recorded yet. Win an online match to appear here.');
  });

  test('a server without the migration says so quietly, and never errors', function () {
    var b = harness({ ok: false, available: false });
    b.nodes['menu-leaderboard'].onclick();

    equal(b.nodes['leaderboard-list'].children.length, 0);
    equal(b.nodes['leaderboard-empty'].textContent,
      'The leaderboard is not available on this server yet.');
  });

  test('closing and reopening the board keeps working', function () {
    var b = harness(board([{ rank: 1, username: 'alice', wins: 5 }]));
    b.nodes['menu-leaderboard'].onclick();
    equal(b.nodes['leaderboard-overlay'].hidden, false);

    b.nodes['leaderboard-close'].onclick();
    equal(b.nodes['leaderboard-overlay'].hidden, true, 'the close button closes');

    b.nodes['menu-leaderboard'].onclick();
    equal(b.nodes['leaderboard-overlay'].hidden, false, 'and it opens again');
  });
};
