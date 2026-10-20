/* PHOENIX presentation data and public-event boundary. No game mutations. */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('./sound-design') : root.PhoenixSoundDesign);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixEffects = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Sound) {
  'use strict';
  var KEY = 'phoenix.effects.v1';
  // label, symbol, colour, movement, waveform, note sequence (Hz), duration.
  var DEFINITIONS = {
    bonus: ['+10,000 Points', '✦', '#ffd46a', 'rise', 'sine', [523, 659, 784], 0.5],
    knife: ['Knife', '╱', '#d8e8ff', 'slash', 'sawtooth', [1500, 350], 0.22],
    hunter: ['Hunter ward', '⌖', '#b6ef87', 'shield', 'triangle', [330, 660], 0.5],
    zombie: ['Zombie', '☠', '#8ce879', 'mist', 'sine', [110, 82, 65], 0.65],
    steal: ['Steal Points', '✧', '#c49bff', 'transfer', 'triangle', [220, 440, 880], 0.45],
    judge: ['Judge', '⚖', '#ffe2a4', 'impact', 'triangle', [196, 98, 392], 0.65],
    reveal: ['Reveal Deck', '◉', '#88e4fa', 'reveal', 'sine', [740, 988], 0.5],
    skipall: ['Skip Everyone', '↻', '#e2c0ff', 'orbit', 'triangle', [440, 554, 440], 0.4],
    phoenix: ['Phoenix rises', '✺', '#ffb54e', 'flame', 'sawtooth', [110, 220, 440, 880], 1.1],
    trick: ['Trick', '◇', '#d8a2ff', 'illusion', 'sine', [466, 440, 622], 0.55],
    stealturn: ['Steal a Turn', '⌛', '#89b9ff', 'orbit', 'triangle', [294, 440, 587], 0.55],
    curse: ['Curse', '⛧', '#c69bff', 'rune', 'sine', [147, 139, 110], 0.65],
    ghost: ['Ghost', '◌', '#d5f1ff', 'mist', 'sine', [392, 523, 784], 0.7],
    alvin: ['Alvin chooses', '♨', '#ffac70', 'reveal', 'triangle', [330, 494], 0.45],
    'alvin-burn': ['Alvin burns one card', '▱', '#ff874a', 'burn', 'sawtooth', [260, 130, 65], 0.7],
    // new cards
    dice: ['Dice Challenge', '\u{1F3B2}', '#ffd700', 'rise', 'triangle', [440, 554, 659], 0.5],
    rps: ['Rock Paper Scissors', '\u270A', '#ff6b6b', 'impact', 'sawtooth', [330, 440, 587], 0.5],
    betrayal: ['Betrayal', '\u{1F3AD}', '#9b59b6', 'illusion', 'sine', [220, 330, 440], 0.6],
    speed: ['Speed Challenge', '\u26A1', '#00d4ff', 'slash', 'sawtooth', [880, 1100, 1320], 0.35],
    wheel: ['Wheel of Fortune', '\u{1F3A1}', '#ff9500', 'orbit', 'triangle', [330, 440, 554, 659], 0.8],
    linkedfate: ['Linked Fate', '\u{1F517}', '#00ff88', 'transfer', 'sine', [392, 523, 659], 0.5],
    impostor: ['Impostor', '\u{1F575}', '#8e44ad', 'mist', 'sine', [196, 247, 330], 0.7],
    swapper: ['Ally Swapper', '\u{1F504}', '#ff4081', 'orbit', 'triangle', [440, 587, 784], 0.5],
    'wheelofmisfortune': ['Wheel of Misfortune', '\u{1F3AD}', '#8b0000', 'orbit', 'sawtooth', [110, 220, 165], 0.8],
    musicalchairs: ['Musical Chairs', '\u{1F3B5}', '#7ec8e3', 'orbit', 'sine', [523, 659, 784, 523], 0.9],
    russianroulette: ['Russian Roulette', '\u{1F3AF}', '#c0392b', 'impact', 'sawtooth', [220, 165, 110], 0.8],
    memorymayhem: ['Memory Mayhem', '\u{1F9E0}', '#b39ddb', 'illusion', 'sine', [440, 587, 698], 0.7],
    bankrobbery: ['Bank Robbery', '\u{1F3E6}', '#ffd700', 'transfer', 'triangle', [196, 392, 587], 0.8],
    pointswap: ['Point Swap', '\u{1F501}', '#66d9e8', 'transfer', 'sine', [330, 660, 330], 0.6],
    hostage: ['Hostage Situation', '\u{1F52B}', '#e74c3c', 'impact', 'sawtooth', [110, 110, 82], 0.9],
    president: ['President', '\u{1F396}\uFE0F}', '#ffd16b', 'shield', 'triangle', [523, 659, 784], 0.8],
    mimic: ['The Mimic', '\u{1F3AD}', '#9b59b6', 'illusion', 'triangle', [440, 392, 330], 0.7],
    dehydrated: ['Dehydrated', '\u{1F4A7}', '#5dade2', 'orbit', 'sine', [587, 523, 440], 0.8],
    nothing: ['Nothing', '\u{1F610}', '#95a5a6', 'mist', 'sine', [220, 196], 0.5],
    reverseofdoom: ['The Uno Reverse of Doom', '\u{1F500}', '#8e44ad', 'impact', 'sawtooth', [330, 262, 196], 1.0],
    support: ['Customer Support', '\u{1F3DE}', '#f5b041', 'reveal', 'triangle', [349, 392, 440], 0.7],
    'joshuasurvey': ['Joshua Survey', '\u{1F4CB}', '#ffd16b', 'reveal', 'sine', [440, 554, 659], 0.8],
    'trailer': ['Did You Like the Trailer?', '\u{1F3AC}', '#ff4081', 'impact', 'sawtooth', [220, 330, 440], 1.0],
    'enjoyingthetrailer': ['Enjoying the Trailer', '\u{1F3AD}', '#ff7ab3', 'impact', 'sawtooth', [220, 330, 440, 220], 1.0],
    'curse-trigger': ['Curse triggered', '⛧', '#b682ef', 'impact', 'triangle', [220, 110], 0.5],
    'hunter-block': ['Hunter reflection', '⌖', '#c6ffab', 'shield', 'triangle', [660, 880, 330], 0.45],
    'ally-phoenix': ['Phoenix · Sneaky Snatcher', '▱', '#ffd05e', 'transfer', 'triangle', [392, 587, 784], 0.45],
    'ally-tilly': ['Tilly · Trouble Maker', '✹', '#c18bff', 'impact', 'triangle', [349, 233, 466], 0.5],
    'ally-ted': ['Ted · Slobbery Surprise', '●', '#91d3ff', 'slobber', 'sine', [180, 270, 135], 0.5],
    'ally-louie': ['Louie · Puppet Master', '⌘', '#75baff', 'rune', 'triangle', [247, 370, 494], 0.55],
    'ally-simba': ['Simba · Card Sabotage', '≋', '#ffb96f', 'slash', 'sawtooth', [820, 410, 205], 0.35],
    'ally-elsie': ['Elsie · Untouchable', '♢', '#ffb4d4', 'shield', 'sine', [698, 880, 1047], 0.55],
    'ally-maple': ['Maple · Sweet Tooth', '🍁', '#7ae4b4', 'rune', 'sine', [659, 784, 988], 0.55],
    'block-tilly': ['Tilly · Protective Paws', '♢', '#c18bff', 'shield', 'triangle', [349, 698], 0.4],
    'block-ted': ['Ted · Protective Howl', '◔', '#91d3ff', 'shield', 'sine', [196, 392, 294], 0.5],
    'block-louie': ['Louie · Quick Reflexes', '⌘', '#75baff', 'shield', 'triangle', [740, 494], 0.25],
    'block-simba': ['Simba · Sharp Claws', '≋', '#ffb96f', 'shield', 'sawtooth', [880, 587], 0.3],
    'block-elsie': ['Elsie · Untouchable', '♢', '#ffb4d4', 'shield', 'sine', [1047, 1319], 0.5],
    'maple-restriction': ['Maple · Nice cards only', '🍁', '#7ae4b4', 'rune', 'sine', [988, 659], 0.4]
  };
  function soundRecipe(key, inert) {
    if (key === 'victory' || key === 'defeat' || key === 'draw') return Sound.recipe(key, false);
    if (!Object.prototype.hasOwnProperty.call(DEFINITIONS, key)) return null;
    return Sound.recipe(key, inert);
  }
  // The allies are NOT in the preview list. Their effects still happen in a
  // match - they are simply not something you can audition on their own, and
  // the list is for the CARDS.
  var DORMANT = ['ally-tilly', 'ally-louie', 'ally-simba', 'ally-elsie'];
  function isAllyEffect(key) {
    return key.indexOf('ally-') === 0 || key.indexOf('block-') === 0 || key === 'maple-restriction';
  }
  // The OWNER-ONLY cards are not in the list either: they belong to the owner
  // server, and this list is for everybody.
  var OWNER_ONLY = ['joshuasurvey', 'trailer', 'enjoyingthetrailer'];
  function isOwnerOnlyEffect(key) {
    return OWNER_ONLY.indexOf(key) !== -1;
  }
  function previews() {
    return Object.keys(DEFINITIONS).filter(function (key) {
      return DORMANT.indexOf(key) < 0 && !isAllyEffect(key) && !isOwnerOnlyEffect(key);
    }).map(function (key) {
      return { key: key, label: DEFINITIONS[key][0] + (key === 'hunter-block' ? ' (reflection support)' : '') };
    }).concat([{ key: 'victory', label: 'Victory fanfare' }, { key: 'defeat', label: 'Defeat coda' }, { key: 'draw', label: 'Draw coda' }]);
  }
  function matchResult(s) {
    if (!s || s.type !== 'state' || s.started !== true || s.phase !== 'playing' || s.over !== true ||
        !Array.isArray(s.players) || !Number.isInteger(s.seat) || !s.players[s.seat]) return null;
    if (s.winner === null) return 'draw';
    if (typeof s.winner !== 'string' || !s.players.some(function (p) { return p.id === s.winner; })) return null;
    return s.players[s.seat].id === s.winner ? 'victory' : 'defeat';
  }
  // The first snapshot (including a reload/reconnect into a finished room) is
  // a baseline. Only an observed active -> finished authoritative transition
  // celebrates. Terminal streams remain latched across resets and stale states.
  function endCursor() {
    var stream = null, sequence = -1, armed = false, finished = new Set();
    return {
      reset: function () { stream = null; sequence = -1; armed = false; },
      consume: function (s) {
        var p = s && s.effects;
        if (!s || s.type !== 'state' || !p || typeof p.stream !== 'string' || !p.stream ||
            !Number.isInteger(p.sequence) || p.sequence < 0) return null;
        if (stream !== p.stream) {
          stream = p.stream; sequence = p.sequence;
          armed = s.started === true && s.phase === 'playing' && s.over === false;
          if (s.over === true) finished.add(stream);
          if (finished.size > 32) finished.delete(finished.values().next().value);
          return null;
        }
        if (p.sequence < sequence || finished.has(stream)) return null;
        sequence = p.sequence;
        var result = matchResult(s);
        if (result) {
          finished.add(stream);
          var wasArmed = armed; armed = false;
          return wasArmed ? result : null;
        }
        if (s.started === true && s.phase === 'playing' && s.over === false) armed = true;
        return null;
      }
    };
  }
  function defaults() { return { sound: true, volume: 0.35, visuals: 'full' }; }
  function normalise(value) {
    var p = defaults();
    if (!value || typeof value !== 'object') return p;
    if (typeof value.sound === 'boolean') p.sound = value.sound;
    if (typeof value.volume === 'number' && isFinite(value.volume)) p.volume = Math.max(0, Math.min(1, value.volume));
    if (['full', 'reduced', 'off'].indexOf(value.visuals) !== -1) p.visuals = value.visuals;
    return p;
  }
  function load(store) {
    try { return normalise(JSON.parse(store.getItem(KEY))); } catch (e) { return defaults(); }
  }
  function save(store, prefs) {
    try { store.setItem(KEY, JSON.stringify(normalise(prefs))); return true; } catch (e) { return false; }
  }
  function motion(prefs, reduced) { return prefs.visuals === 'off' ? 'off' : reduced ? 'reduced' : prefs.visuals; }
  function seat(n) { return Number.isInteger(n) && n >= 0 && n < 5 ? n : -1; }
  // Strict whitelist: never copy text, card identities from a private hand,
  // names, options, curse marks, or arbitrary event fields into this channel.
  function publicEvent(key, actor, target, outcome) {
    if (!Object.prototype.hasOwnProperty.call(DEFINITIONS, key)) return null;
    return { key: key, actor: seat(actor), target: seat(target), outcome: outcome === 'inert' ? 'inert' : 'active' };
  }
  function fromRules(events) {
    var result = [];
    (events || []).forEach(function (event) {
      var key, outcome = 'active', actor = event.seat, target = event.targetSeat;
      if (event.type === 'card') {
        key = event.cardId;
        var resolution = (events || []).find(function (e) { return e.type === 'result' && e.cardId === key; });
        var text = resolution ? resolution.text || '' : '';
        if (key === 'judge' && /inert|nobody is banished/.test(text)) outcome = 'inert';
        if ((key === 'alvin' && /nothing to destroy/.test(text)) ||
            (key === 'curse' && /Nothing happens/.test(text)) ||
            (key === 'hunter' && /nothing changes/.test(text)) ||
            (key === 'steal' && /points \(0\)/.test(text))) outcome = 'inert';
        if (key === 'zombie' && /reflected!/.test(text)) {
          var shield = publicEvent('hunter-block', target, target);
          if (shield) result.push(shield);
          target = actor;
        }
      } else if (event.type === 'alvin') key = 'alvin-burn';
      else if (event.type === 'curse') key = 'curse-trigger';
      var safe = publicEvent(key, actor, target, outcome);
      if (safe) result.push(safe);
    });
    return result;
  }
  function append(journal, event) {
    var safe = event && publicEvent(event.key, event.actor, event.target, event.outcome);
    if (!safe) return;
    safe.id = ++journal.sequence;
    journal.events.push(safe);
    if (journal.events.length > 64) journal.events.shift();
  }
  function cursor() {
    var stream = null, sequence = 0;
    return {
      reset: function () { stream = null; sequence = 0; },
      consume: function (packet) {
        if (!packet || typeof packet.stream !== 'string' || !Number.isInteger(packet.sequence) || packet.sequence < 0) return [];
        // First snapshot/reconnect is a baseline, not a replay of old action.
        if (stream !== packet.stream) { stream = packet.stream; sequence = packet.sequence; return []; }
        if (packet.sequence <= sequence) return [];
        var previous = sequence;
        sequence = packet.sequence;
        return (Array.isArray(packet.events) ? packet.events : []).filter(function (e) {
          return e && Number.isInteger(e.id) && e.id > previous && e.id <= sequence;
        }).filter(function (e, i, all) {
          return all.findIndex(function (other) { return other.id === e.id; }) === i;
        }).map(function (e) { return publicEvent(e.key, e.actor, e.target, e.outcome); }).filter(Boolean);
      }
    };
  }
  // Existing engine result strings contain private hand/draw details. Public
  // multiplayer logs must not defeat the safe effects boundary or Ted's fog.
  function publicLog(event) {
    if (event.type === 'draw') return 'A player drew a card.';
    if (event.type === 'result' && event.cardId === 'reveal') return 'Reveal Deck: the actor privately sees the chosen hand.';
    if (event.type === 'result' && event.cardId === 'alvin') return 'Alvin: the actor privately inspects the chosen hand.';
    if (event.type === 'alvin') return 'Alvin destroys one card permanently. All other cards remain untouched.';
    return event.text;
  }
  return { KEY: KEY, DEFINITIONS: DEFINITIONS, soundRecipe: soundRecipe, renderSound: Sound.render,
    previews: previews, matchResult: matchResult, endCursor: endCursor, defaults: defaults, normalise: normalise,
    load: load, save: save, motion: motion, publicEvent: publicEvent, fromRules: fromRules,
    append: append, cursor: cursor, publicLog: publicLog };
}));
