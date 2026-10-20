/* PHOENIX — the expansion.
 *
 * Server-authoritative effects for the fourteen new cards and the statuses they
 * leave behind. Everything here runs on the SERVER: the randomness, the score
 * changes, the round counting and the target choices. A client can ask for
 * something; it can never decide what happens.
 *
 * The cards fall into three shapes:
 *
 *   1. ONE-SHOT EFFECTS. Bank Robbery, Point Swap, Dehydrated, Nothing,
 *      Reverse of Doom and Customer Support resolve and are done. Some of them
 *      leave a status behind (the rotation, the trap) that expires on a later
 *      round boundary.
 *
 *   2. TABLE-WIDE MINIGAMES. Musical Chairs and Memory Mayhem run for a while
 *      and are decided by the server's clock, not by a client.
 *
 *   3. LONG-RUNNING ROLES. Hostage Situation and President change how the rest
 *      of the match plays.
 *
 * The two owner-only cards (Joshua Survey, Did You Like the Trailer?) live here
 * too, and the server refuses them outside an owner room - see assertAllowed.
 */
'use strict';

const Cards = require('./cards');
const Rules = require('./rules');

/** Every card this module knows how to resolve. */
const EXPANSION_CARD_IDS = [
  'musicalchairs', 'russianroulette', 'memorymayhem', 'bankrobbery',
  'pointswap', 'hostage', 'president', 'joshuasurvey', 'trailer',
  'enjoyingthetrailer',
  'mimic', 'dehydrated', 'nothing', 'reverseofdoom', 'support'
];

/**
 * The cards whose EFFECT hurts somebody, and what "hurting" means for each.
 *
 * Reverse of Doom has to know which cards count as harmful, because only a
 * harmful card sets the trap off. This is the list it consults, and the
 * reflection rules below are written against it.
 */
const HARMFUL_CARDS = {
  steal: { kind: 'points' },
  knife: { kind: 'eliminate', rounds: 1 },
  zombie: { kind: 'eliminate', rounds: 1, resetPoints: true },
  curse: { kind: 'eliminate', rounds: 1, movesCurse: true }
};

/** The ten questions the owner asks. */
const SURVEY_QUESTIONS = [
  'What is my primary device I play Roblox on?',
  "Name one of Phoenix's favourite insects.",
  'When is my birthday?',
  'Name my old Rec Room game I made before Rec Room got deleted.',
  'Phoenix is what morph?',
  'Name every single pet I own.',
  'What is my favourite colour?',
  'Am I way better at video games than you? Yes or no?',
  'Who is your favourite friend?',
  'If I have 5 apples and I eat 4, how many oranges do I have?'
];

/** The three complaints a target may file. Every one of them is rejected. */
const COMPLAINTS = [
  'My points have disappeared!',
  'This game is unfair!',
  'I demand compensation!'
];

/** The three outcomes a rejected complaint produces. */
const COMPLAINT_OUTCOMES = ['lose_points', 'skip_turn', 'one_point'];

/* --------------------------------------------------------------------- */
/* Helpers                                                               */
/* --------------------------------------------------------------------- */

/** One player, by their id. */
function playerById(state, playerId) {
  return state.players.filter(function (p) { return p.id === playerId; })[0] || null;
}

/** Everybody at the table who could take part. */
function inPlay(room) {
  const s = room.state;
  return s.players.filter(p => p.enabled && !Rules.isOut(p, s));
}

/** A player's score, set outright. Negative scores are legal. */
function setPoints(room, playerId, value) {
  const s = room.state;
  const p = s.players.find(x => x.id === playerId);
  if (!p) return 0;
  p.points = value;
  return value;
}

/** A player's score, moved by a delta. Negative scores are legal. */
function addPoints(room, playerId, delta) {
  const s = room.state;
  const p = s.players.find(x => x.id === playerId);
  if (!p) return 0;
  p.points += delta;
  return p.points;
}

/**
 * Serve ONE round of an elimination a player is already serving.
 *
 * Somebody who is already eliminated can still be dragged into a minigame. That
 * counts as one of their eliminated rounds being served - the round they are
 * out for passes while they are playing.
 */
function serveRound(state, player) {
  if (player.outUntilRound < 0) return 0;
  if (state.round > player.outUntilRound) {
    player.outUntilRound = -1;
    return 0;
  }
  player.outUntilRound -= 1;
  if (player.outUntilRound < state.round) player.outUntilRound = -1;
  return 1;
}

/**
 * Eliminate a player for a number of complete rounds.
 *
 * On top of whatever they were already serving, so a player with two rounds
 * left who loses ends up with four (two, less the one they served, plus
 * three more).
 */
function eliminateFor(state, player, rounds) {
  const span = Math.max(1, Math.floor(Number(rounds) || 1));
  if (player.outUntilRound < 0) {
    player.outUntilRound = state.round + span - 1;
  } else {
    player.outUntilRound += span;
  }
  return player.outUntilRound;
}

/** True when this card may be played in this room at all. */
function isAllowedInRoom(cardId, room) {
  if (!Rules.isOwnerOnlyCard(cardId)) return true;
  // The owner-only cards belong to the owner server, and nowhere else.
  return !!(room && room.mode === 'owner');
}

/** The cards a Mimic may pretend to be. Never an owner-only card. */
function mimicDisguises() {
  return Cards.deckCards()
    .filter(c => !c.ownerOnly && c.id !== 'mimic')
    .map(c => c.id);
}

/* --------------------------------------------------------------------- */
/* Round-boundary housekeeping                                            */
/* --------------------------------------------------------------------- */

/**
 * Everything that ends when a round ends.
 *
 * Called once per round boundary by the server, so a status that lasts "five
 * complete rounds" really lasts five complete rounds and not five turns.
 */
function onRoundEnd(room) {
  const s = room.state;
  if (!s) return;

  // The president earns 5,000 for every round they complete, and their term
  // runs out when the round passes it.
  if (s.president) {
    if (s.round > s.president.untilRound) {
      endPresidency(room);
    } else {
      addPoints(room, s.president.id, 5000);
    }
  }

  // A trap that never fired expires with the round.
  if (s.traps) {
    Object.keys(s.traps).forEach(id => {
      if (s.round > s.traps[id].untilRound) delete s.traps[id];
    });
  }

  // And so does a screen that has been turned for long enough.
  if (s.dehydrated) {
    Object.keys(s.dehydrated).forEach(id => {
      if (s.round > s.dehydrated[id].untilRound) delete s.dehydrated[id];
    });
  }
}

/* --------------------------------------------------------------------- */
/* President                                                              */
/* --------------------------------------------------------------------- */

function startPresidency(room) {
  const s = room.state;
  const actor = s.players.find(p => p.id === room.pendingInteraction.actorId);
  s.president = {
    id: actor.id,
    // The round they take office in, and the four after it: five rounds.
    untilRound: s.round + 4
  };
  s.bannedCards = s.bannedCards || [];
  addPoints(room, actor.id, 5000);
  return {
    events: [{
      type: 'result', cardId: 'president',
      text: 'President - ' + actor.name + ' is now President for 5 rounds, and earns 5,000 points for every round they complete.'
    }],
    advanceTurn: true
  };
}

function endPresidency(room) {
  const s = room.state;
  if (!s.president) return;
  const name = (s.players.find(p => p.id === s.president.id) || {}).name || 'The President';
  s.president = null;
  s.bannedCards = [];
  room.log.push('The presidency of ' + name + ' ends, and every ban is lifted.');
}

/* --------------------------------------------------------------------- */
/* Hostage                                                                */
/* --------------------------------------------------------------------- */

function startHostage(room) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const criminalId = pi.actorId;
  const hostageId = pi.targetId;

  // The police officer is a third eligible player, picked at random.
  const others = inPlay(room).filter(p => p.id !== criminalId && p.id !== hostageId);
  if (!others.length) {
    return {
      events: [{
        type: 'result', cardId: 'hostage',
        text: 'Hostage Situation - there is nobody else at the table to call the police, so nothing happens.'
      }],
      advanceTurn: true
    };
  }
  const officer = others[Math.floor(Math.random() * others.length)];

  s.hostage = {
    criminalId: criminalId,
    hostageId: hostageId,
    officerId: officer.id,
    officerStartPoints: officer.points,
    target: 40000
  };

  return {
    events: [{
      type: 'result', cardId: 'hostage',
      text: 'Hostage Situation - ' + (s.players.find(p => p.id === criminalId) || {}).name +
        ' is the criminal and holds ' + (s.players.find(p => p.id === hostageId) || {}).name +
        ' hostage. ' + officer.name + ' is the police officer and must gain 40,000 points to free them.'
    }],
    advanceTurn: true
  };
}

/** Has the police officer reached the target? If so, the hostage is released. */
function checkHostage(room) {
  const s = room.state;
  if (!s.hostage) return null;
  const h = s.hostage;
  const officer = s.players.find(p => p.id === h.officerId);
  const criminal = s.players.find(p => p.id === h.criminalId);
  if (!officer || !criminal) { s.hostage = null; return null; }

  const gained = officer.points - h.officerStartPoints;
  if (gained < h.target) return null;

  // Released. The criminal pays for it.
  s.hostage = null;
  const lost = Math.floor(criminal.points / 2);
  criminal.points -= lost;
  eliminateFor(s, criminal, 5);
  return {
    type: 'result', cardId: 'hostage',
    text: 'Hostage Situation - ' + officer.name + ' has raised enough. The hostage is released! ' +
      criminal.name + ' is eliminated for 5 rounds and loses ' + lost.toLocaleString() + ' points.'
  };
}

/* --------------------------------------------------------------------- */
/* One-shot effects                                                       */
/* --------------------------------------------------------------------- */

function resolveBankRobbery(room) {
  const s = room.state;
  const actor = s.players.find(p => p.id === room.pendingInteraction.actorId);
  // The opponent with the highest POSITIVE score. A tie goes to the lowest
  // seat, so the same table always produces the same robbery.
  const candidates = inPlay(room)
    .filter(p => p.id !== actor.id && p.points > 0)
    .sort((a, b) => (b.points - a.points) || (a.seat - b.seat));
  if (!candidates.length) {
    return {
      events: [{
        type: 'result', cardId: 'bankrobbery',
        text: 'Bank Robbery - ' + actor.name + ' finds an empty table. There is nothing to steal.'
      }],
      advanceTurn: true
    };
  }
  const victim = candidates[0];
  const amount = Math.min(25000, Math.floor(victim.points * 0.25));
  victim.points -= amount;
  actor.points += amount;
  return {
    events: [{
      type: 'result', cardId: 'bankrobbery',
      text: 'Bank Robbery - ' + actor.name + ' robs ' + victim.name + ' of ' +
        amount.toLocaleString() + ' points' +
        (amount < Math.floor(victim.points * 0.25) + amount ? '' : '') +
        '. The alarm is deafening.'
    }],
    advanceTurn: true
  };
}

function resolvePointSwap(room) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const actor = s.players.find(p => p.id === pi.actorId);
  const target = s.players.find(p => p.id === pi.targetId);
  if (!actor || !target) {
    return { events: [{ type: 'result', cardId: 'pointswap', text: 'Point Swap - nobody to swap with.' }], advanceTurn: true };
  }
  const a = actor.points;
  const t = target.points;
  actor.points = t;
  target.points = a;
  return {
    events: [{
      type: 'result', cardId: 'pointswap',
      text: 'Point Swap - ' + actor.name + ' (' + a.toLocaleString() + ') and ' +
        target.name + ' (' + t.toLocaleString() + ') trade scores.'
    }],
    advanceTurn: true
  };
}

function resolveDehydrated(room) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const target = s.players.find(p => p.id === pi.targetId);
  if (!target) {
    return { events: [{ type: 'result', cardId: 'dehydrated', text: 'Dehydrated - nobody to hydrate.' }], advanceTurn: true };
  }
  s.dehydrated = s.dehydrated || {};
  // The round it is played in, and the one after it: two rounds.
  s.dehydrated[target.id] = { untilRound: s.round + 1 };
  return {
    events: [{
      type: 'result', cardId: 'dehydrated',
      text: 'Dehydrated? Maybe Drink Some Water - ' + target.name +
        ' is told they seem dehydrated. Their screen rotates for 5 rounds.'
    }],
    advanceTurn: true
  };
}

function resolveNothing(room) {
  const s = room.state;
  const actor = s.players.find(p => p.id === room.pendingInteraction.actorId);
  return {
    events: [{
      type: 'result', cardId: 'nothing',
      text: 'Nothing - ' + (actor ? actor.name : 'The player') +
        ' played Nothing. Nothing at all happened, exactly as promised.'
    }],
    advanceTurn: true
  };
}

function resolveReverseOfDoom(room) {
  const s = room.state;
  const actor = s.players.find(p => p.id === room.pendingInteraction.actorId);
  s.traps = s.traps || {};
  s.traps[actor.id] = { untilRound: s.round + 3 };
  return {
    events: [{
      type: 'result', cardId: 'reverseofdoom',
      text: 'The Uno Reverse of Doom - a secret trap waits on ' + (actor ? actor.name : 'the player') +
        ' for 3 rounds. Nobody else is told.'
    }],
    advanceTurn: true
  };
}

function resolveSupport(room) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const actor = s.players.find(p => p.id === pi.actorId);
  const target = s.players.find(p => p.id === pi.targetId);
  if (!actor || !target) {
    return { events: [{ type: 'result', cardId: 'support', text: 'Customer Support - nobody to complain to.' }], advanceTurn: true };
  }
  addPoints(room, actor.id, 10000);
  return {
    events: [{
      type: 'result', cardId: 'support',
      text: 'Customer Support - ' + target.name + ' files a complaint. It is rejected. ' +
        actor.name + ' keeps 10,000 points as an administration fee.'
    }],
    advanceTurn: true
  };
}

/* --------------------------------------------------------------------- */
/* Musical Chairs                                                         */
/* --------------------------------------------------------------------- */

function startMusicalChairs(room) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const duration = 4000 + Math.floor(Math.random() * 9000);
  pi.roundData = pi.roundData || {};
  pi.roundData.musicStopsAt = Date.now() + duration;
  pi.roundData.duration = duration;
  pi.roundData.pressed = {};
  pi.roundData.disabledUntil = {};
  pi.roundData.lastPressAt = 0;
  return {
    events: [{
      type: 'result', cardId: 'musicalchairs',
      text: 'Musical Chairs - the music starts. Press your button only AFTER it stops.'
    }],
    advanceTurn: false
  };
}

/** A press, and what it means. */
function musicalChairsPress(room, playerId) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const data = pi.roundData;
  const now = Date.now();
  const locked = (data.disabledUntil || {})[playerId] || 0;
  if (now < locked) return { error: 'Your button is disabled for another ' + Math.ceil((locked - now) / 1000) + ' seconds.' };
  if ((data.pressed || {})[playerId]) return { error: 'You have already pressed.' };

  if (now < data.musicStopsAt) {
    // Too early. The button is disabled for ten seconds, and the penalty keeps
    // running even if the music stops inside it.
    data.disabledUntil = data.disabledUntil || {};
    data.disabledUntil[playerId] = now + 10000;
    return { early: true, error: 'Too early! Your button is disabled for 10 seconds.' };
  }

  data.pressed = data.pressed || {};
  data.pressed[playerId] = now;
  data.lastPressAt = now;

  // The last eligible player to press loses.
  const participants = pi.participants.filter(id => !Rules.isOut(playerById(s, id), s));
  const pressed = Object.keys(data.pressed);
  const everyoneElsePressed = participants.every(id => id === playerId || data.pressed[id]);
  if (everyoneElsePressed) {
    // Either everybody has pressed and this was the last one, or this is the
    // only one still standing and everybody else is already done.
    const loser = participants.length === pressed.length ? playerId : participants.find(id => !data.pressed[id]);
    if (loser) {
      addPoints(room, loser, -10000);
      return {
        done: true,
        loser: loser,
        events: [{
          type: 'result', cardId: 'musicalchairs',
          text: 'Musical Chairs - ' + (playerById(s, loser) || {}).name +
            ' was the last to the chair and loses 10,000 points.'
        }]
      };
    }
  }
  return { waiting: true };
}

/* --------------------------------------------------------------------- */
/* Russian Roulette                                                        */
/* --------------------------------------------------------------------- */

function startRussianRoulette(room) {
  const s = room.state;
  const pi = room.pendingInteraction;
  pi.roundData = pi.roundData || {};
  pi.roundData.holder = pi.actorId;
  pi.roundData.target = null;
  pi.roundData.chamber = 1;
  pi.phase = 'choose';
  return {
    events: [{
      type: 'result', cardId: 'russianroulette',
      text: 'Russian Roulette - the revolver is loaded with one chamber. ' +
        (playerById(s, pi.roundData.holder) || {}).name + ' picks who holds it.'
    }],
    advanceTurn: false
  };
}

/** The holder aims at somebody, and the server pulls the trigger. */
function russianRouletteAim(room, playerId, targetId) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const data = pi.roundData;
  if (data.holder !== playerId) return { error: 'It is not your turn to aim the revolver.' };
  const target = s.players.find(p => p.id === targetId);
  if (!target) return { error: 'Pick somebody to hold the revolver.' };
  if (target.id === data.holder) return { error: 'You cannot point the revolver at yourself.' };

  // The odds RISE each time: one in six, then two in six, then three...
  const chance = Math.min(1, data.chamber / 6);
  const lost = Math.random() < chance;

  if (lost) {
    // The first loss ends it. The targeted player is eliminated for three
    // complete rounds - and one round of any elimination they were already
    // serving is served first, because they took part.
    serveRound(s, target);
    eliminateFor(s, target, 3);
    return {
      done: true,
      events: [{
        type: 'result', cardId: 'russianroulette',
        text: 'THE REVOLVER FIRES! ' + target.name +
          ' takes the shot and is out for 3 rounds. The minigame is over.'
      }]
    };
  }

  // Safe. The targeted player takes the revolver and picks the next target.
  data.chamber += 1;
  data.holder = target.id;
  pi.phase = 'choose';
  return {
    events: [{
      type: 'result', cardId: 'russianroulette',
      text: 'Russian Roulette - ' + target.name + ' pulls the trigger and gets away with it. ' +
        'They take the revolver. The odds are now ' + data.chamber + ' in 6.'
    }],
    advanceTurn: false
  };
}

/* --------------------------------------------------------------------- */
/* Memory Mayhem                                                          */
/* --------------------------------------------------------------------- */

const MEMORY_SYMBOLS = ['◆', '●', '▲', '■', '★', '✚', '⬟', '✦'];

/** Build the three sequences, and the length of each. */
function buildMemorySequences() {
  const sequences = [];
  [3, 4, 5].forEach(length => {
    const seq = [];
    for (let i = 0; i < length; i++) {
      seq.push(MEMORY_SYMBOLS[Math.floor(Math.random() * MEMORY_SYMBOLS.length)]);
    }
    sequences.push(seq);
  });
  return sequences;
}

function startMemoryMayhem(room) {
  const pi = room.pendingInteraction;
  pi.roundData = pi.roundData || {};
  pi.roundData.sequences = buildMemorySequences();
  // The symbols themselves, so the player can be offered the very ones the
  // sequences are made of - nobody can type a star.
  pi.roundData.symbols = MEMORY_SYMBOLS.slice();
  pi.roundData.phaseIndex = 0;
  pi.roundData.answers = {};
  pi.roundData.times = {};
  pi.roundData.revealMs = 2500 + pi.roundData.sequences[0].length * 900;
  pi.phase = 'recall';
  return {
    events: [{
      type: 'result', cardId: 'memorymayhem',
      text: 'Memory Mayhem - three sequences. Watch carefully, then write them back.'
    }],
    advanceTurn: false
  };
}

/** One player's answer to one sequence. */
function memoryAnswer(room, playerId, sequenceIndex, answer) {
  const pi = room.pendingInteraction;
  const data = pi.roundData;
  if (sequenceIndex !== data.phaseIndex) return { error: 'Wait for the sequence you are being asked about.' };
  data.answers = data.answers || {};
  data.times = data.times || {};
  // The server records the answer before it calls this, so there is nothing to
  // check here: the duplicate guard lives in the server's own submission check.
  data.answers[playerId] = String(answer || '');
  data.times[playerId] = Date.now();

  // Everybody answered? Move to the next sequence.
  const allAnswered = pi.participants.every(id => data.answers[id] !== undefined);
  if (!allAnswered) return { waiting: true };

  if (data.phaseIndex < 2) {
    data.phaseIndex += 1;
    data.answers = {};
    data.times = {};
    data.revealMs = 2500 + data.sequences[data.phaseIndex].length * 900;
    return {
      nextSequence: true,
      events: [{
        type: 'result', cardId: 'memorymayhem',
        text: 'Memory Mayhem - sequence ' + (data.phaseIndex + 1) + ' of 3.'
      }]
    };
  }

  // All three done. Score the accuracy, and the time.
  const scored = pi.participants.map(id => {
    let correct = 0;
    for (let i = 0; i < 3; i++) {
      const right = (data.allAnswers[id] || {})[i];
      if (right !== undefined && right === data.sequences[i].join('')) correct++;
    }
    return { id: id, accuracy: correct / 3, time: (data.allTimes[id] || []).reduce((a, b) => a + b, 0) };
  });
  // The lowest accuracy loses. A tie on accuracy is broken by the time: the
  // SLOWER player loses.
  scored.sort((a, b) => (a.accuracy - b.accuracy) || (b.time - a.time));
  const loser = scored[0];
  addPoints(room, loser.id, -8000);
  return {
    done: true,
    loser: loser.id,
    events: [{
      type: 'result', cardId: 'memorymayhem',
      text: 'Memory Mayhem - ' + (playerById(room.state, loser.id) || {}).name +
        ' has the weakest memory and loses 8,000 points.'
    }]
  };
}

/* --------------------------------------------------------------------- */
/* The Mimic                                                              */
/* --------------------------------------------------------------------- */

/** Choose the disguise, and hand the disguised card over. */
function mimicDisguise(room, playerId, disguiseId) {
  const s = room.state;
  const pi = room.pendingInteraction;
  if (pi.actorId !== playerId) return { error: 'You are not the one holding the Mimic.' };
  const allowed = mimicDisguises();
  if (allowed.indexOf(disguiseId) === -1) {
    return { error: 'The Mimic cannot pretend to be that card.' };
  }
  const target = s.players.find(p => p.id === pi.targetId);
  if (!target) return { error: 'Nobody to hand the card to.' };

  s.mimics = s.mimics || {};
  s.mimics[target.id] = disguiseId;

  // The card physically in their hand is the Mimic; the disguise is a
  // PRESENTATION of it, and only the server knows which is which.
  //
  // The Mimic card is HANDED OVER, not copied: the caster's card was just
  // played, so it is in the discard, and the target takes it. Nothing is
  // created and nothing is lost.
  let card = 'mimic';
  for (let i = s.discard.length - 1; i >= 0; i--) {
    if (s.discard[i] === 'mimic') {
      card = s.discard.splice(i, 1)[0];
      break;
    }
  }
  const hand = Rules.handOf(s, target.id);
  const at = hand.indexOf(disguiseId);
  if (at !== -1) {
    // They already hold that card, so the Mimic takes its place. A hand may
    // only hold one of each type, and this keeps it that way. The card they
    // gave up goes to the discard, so nothing is lost.
    s.discard.push(hand[at]);
    hand[at] = card;
  } else {
    hand.push(card);
    // A hand is never allowed past the limit, so the Mimic takes the place of
    // the oldest card if the target is already holding a full hand.
    while (hand.length > Rules.HAND_LIMIT) {
      const dropped = hand.shift();
      s.discard.push(dropped);
    }
  }

  return {
    done: true,
    events: [{
      type: 'result', cardId: 'mimic',
      text: 'The Mimic - ' + target.name + ' is handed a card that looks like the ' +
        (Cards.byId(disguiseId) || {}).name + '...'
    }]
  };
}

/**
 * What the target is actually holding, for their own screen.
 *
 * The disguise replaces the Mimic in the hand the player is shown, so the card
 * looks and reads exactly like the card it pretends to be.
 */
function handForViewer(state, playerId) {
  const hand = Rules.handOf(state, playerId);
  if (!state.mimics || !state.mimics[playerId]) return hand.slice();
  return hand.map(id => (id === 'mimic' ? state.mimics[playerId] : id));
}

/* --------------------------------------------------------------------- */
/* The Uno Reverse of Doom - the trap                                      */
/* --------------------------------------------------------------------- */

/**
 * Is this card a harmful one aimed at somebody with a trap waiting?
 *
 * Returns the trap if the effect is cancelled, or null when the card lands
 * normally.
 */
function checkTrap(room, actor, target, cardId) {
  const s = room.state;
  if (!target || !s.traps || !s.traps[target.id]) return null;
  const harmful = HARMFUL_CARDS[cardId];
  if (!harmful) return null;
  // The trap is consumed the moment it fires.
  delete s.traps[target.id];

  if (harmful.kind === 'points') {
    // The amount that was about to be taken, doubled, is taken from the
    // ATTACKER instead, and handed to the protected player.
    const amount = Math.max(0, target.points);
    // The attack is turned around at DOUBLE strength: the protected player
    // keeps what they had and gains twice the amount, and the attacker is
    // the one who loses it.
    target.points += amount * 2;
    actor.points -= amount * 2;
    return {
      type: 'result', cardId: 'reverseofdoom',
      text: 'The Uno Reverse of Doom - the trap springs! ' + cardName(cardId) +
        ' is turned back on ' + actor.name + ' for double: ' +
        (amount * 2).toLocaleString() + ' points move the other way.'
    };
  }

  if (harmful.kind === 'eliminate') {
    const rounds = harmful.rounds * 2;
    eliminateFor(s, actor, rounds);
    if (harmful.resetPoints) actor.points = 0;
    if (harmful.movesCurse) {
      // The curse moves to the attacker's hand.
      const curse = target.cursed.shift();
      if (curse) Rules.handOf(s, actor.id).push(curse);
    }
    return {
      type: 'result', cardId: 'reverseofdoom',
      text: 'The Uno Reverse of Doom - the trap springs! ' + cardName(cardId) +
        ' is turned back on ' + actor.name + ', who is eliminated for ' + rounds +
        ' rounds instead.'
    };
  }
  return null;
}

function cardName(cardId) {
  const c = Cards.byId(cardId);
  return c ? c.name : cardId;
}

/* --------------------------------------------------------------------- */
/* Customer Support                                                       */
/* --------------------------------------------------------------------- */

function supportComplaint(room, playerId, complaint) {
  const s = room.state;
  const pi = room.pendingInteraction;
  if (pi.targetId !== playerId) return { error: 'The complaint form is for somebody else.' };
  // A complaint may be sent as its text or as its number.
  if (/^\d+$/.test(String(complaint))) {
    complaint = COMPLAINTS[Number(complaint)];
  }
  if (COMPLAINTS.indexOf(complaint) === -1) return { error: 'Choose one of the three complaints.' };

  // The administration fee is kept by the player who called the support line,
  // whatever the complaint turns out to be worth.
  addPoints(room, pi.actorId, 10000);
  const outcome = COMPLAINT_OUTCOMES[Math.floor(Math.random() * COMPLAINT_OUTCOMES.length)];
  const target = s.players.find(p => p.id === playerId);
  let extra = '';
  if (outcome === 'lose_points') {
    target.points -= 5000;
    extra = ' They lose 5,000 points.';
  } else if (outcome === 'skip_turn') {
    target.skipNextTurn = true;
    extra = ' They skip their next turn.';
  } else {
    target.points += 1;
    extra = ' They receive 1 point in compensation.';
  }
  return {
    done: true,
    outcome: outcome,
    events: [{
      type: 'result', cardId: 'support',
      text: 'Customer Support - "Thank you for contacting PHOENIX Entertainment. Your complaint has been rejected."' + extra
    }]
  };
}

/* --------------------------------------------------------------------- */
/* Owner-only: Joshua Survey                                              */
/* --------------------------------------------------------------------- */

/**
 * A minigame that nobody answered.
 *
 * The minigame itself started when the card was played, so the timeout does
 * not start it again: it simply ends it, with an honest line.
 */
function resolveTimeout(room, cardId, text) {
  return {
    events: [{ type: 'result', cardId: cardId, text: text }],
    advanceTurn: true
  };
}

/** The trailer is over, one way or another. */
function resolveTrailerTimeout(room) {
  return {
    events: [{
      type: 'result', cardId: 'trailer',
      text: 'Did You Like the Trailer? - the trailer has finished.'
    }],
    advanceTurn: true
  };
}

function startSurvey(room) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const question = SURVEY_QUESTIONS[Math.floor(Math.random() * SURVEY_QUESTIONS.length)];
  pi.roundData = pi.roundData || {};
  pi.roundData.question = question;
  pi.roundData.answers = {};
  pi.roundData.judged = {};
  return {
    events: [{
      type: 'result', cardId: 'joshuasurvey',
      text: 'Joshua Survey - the question is: ' + question
    }],
    advanceTurn: false
  };
}

function surveyAnswer(room, playerId, text) {
  const pi = room.pendingInteraction;
  const data = pi.roundData;
  if (data.answers[playerId] !== undefined) return { error: 'You have already answered.' };
  data.answers[playerId] = String(text || '').slice(0, 500);
  return { accepted: true };
}

function surveyJudge(room, playerId, subjectId, accept) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const data = pi.roundData;
  // ONLY the owner judges. The server checks the room, not the client.
  if (pi.actorId !== playerId) return { error: 'Only the owner can judge the answers.' };
  if (data.answers[subjectId] === undefined) return { error: 'That player has not answered.' };
  if (data.judged[subjectId]) return { error: 'That answer has already been judged.' };
  data.judged[subjectId] = accept ? 'accepted' : 'declined';
  if (accept) addPoints(room, subjectId, 50000);
  const allJudged = Object.keys(data.answers).every(id => data.judged[id]);
  return {
    judged: true,
    done: allJudged,
    events: [{
      type: 'result', cardId: 'joshuasurvey',
      text: 'Joshua Survey - ' + (playerById(s, subjectId) || {}).name + "'s answer was " +
        (accept ? 'accepted' : 'declined') + '.'
    }]
  };
}

/* --------------------------------------------------------------------- */
/* Owner-only: Did You Like the Trailer?                                  */
/* --------------------------------------------------------------------- */

function startTrailer(room) {
  const s = room.state;
  const pi = room.pendingInteraction;
  const target = s.players.find(p => p.id === pi.targetId);
  room.trailer = {
    targetId: pi.targetId,
    startedAt: Date.now(),
    durationMs: 20000
  };
  return {
    events: [{
      type: 'result', cardId: 'trailer',
      text: 'Did You Like the Trailer? - ' + (target ? target.name : 'The target') +
        ' is watching the trailer. There is no skip.'
    }],
    advanceTurn: true
  };
}

/* --------------------------------------------------------------------- */
/* Exports                                                               */
/* --------------------------------------------------------------------- */

module.exports = {
  EXPANSION_CARD_IDS: EXPANSION_CARD_IDS,
  HARMFUL_CARDS: HARMFUL_CARDS,
  SURVEY_QUESTIONS: SURVEY_QUESTIONS,
  COMPLAINTS: COMPLAINTS,
  COMPLAINT_OUTCOMES: COMPLAINT_OUTCOMES,
  MEMORY_SYMBOLS: MEMORY_SYMBOLS,
  inPlay: inPlay,
  setPoints: setPoints,
  addPoints: addPoints,
  serveRound: serveRound,
  eliminateFor: eliminateFor,
  isAllowedInRoom: isAllowedInRoom,
  mimicDisguises: mimicDisguises,
  onRoundEnd: onRoundEnd,
  startPresidency: startPresidency,
  endPresidency: endPresidency,
  startHostage: startHostage,
  checkHostage: checkHostage,
  resolveBankRobbery: resolveBankRobbery,
  resolvePointSwap: resolvePointSwap,
  resolveDehydrated: resolveDehydrated,
  resolveNothing: resolveNothing,
  resolveReverseOfDoom: resolveReverseOfDoom,
  resolveSupport: resolveSupport,
  startMusicalChairs: startMusicalChairs,
  musicalChairsPress: musicalChairsPress,
  startRussianRoulette: startRussianRoulette,
  russianRouletteAim: russianRouletteAim,
  startMemoryMayhem: startMemoryMayhem,
  memoryAnswer: memoryAnswer,
  mimicDisguise: mimicDisguise,
  handForViewer: handForViewer,
  checkTrap: checkTrap,
  supportComplaint: supportComplaint,
  resolveTimeout: resolveTimeout,
  resolveTrailerTimeout: resolveTrailerTimeout,
  startSurvey: startSurvey,
  surveyAnswer: surveyAnswer,
  surveyJudge: surveyJudge,
  startTrailer: startTrailer
};
