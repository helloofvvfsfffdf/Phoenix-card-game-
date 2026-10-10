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
    if (!Object.prototype.hasOwnProperty.call(DEFINITIONS, key)) return null;
    return Sound.recipe(key, inert);
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
  return { KEY: KEY, DEFINITIONS: DEFINITIONS, soundRecipe: soundRecipe, renderSound: Sound.render, defaults: defaults, normalise: normalise,
    load: load, save: save, motion: motion, publicEvent: publicEvent, fromRules: fromRules,
    append: append, cursor: cursor, publicLog: publicLog };
}));
