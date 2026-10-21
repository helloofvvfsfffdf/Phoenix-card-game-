/* PHOENIX - the cinematics.
 *
 * A cinematic is a short piece of theatre that happens because a card was
 * played. It never decides anything: the SERVER has already decided what the
 * card did, and the cinematic only shows it. Nothing in this file can change
 * a score, a target, an elimination or the turn - the worst it could do is
 * look wrong.
 *
 * There is one for EVERY card in the game, and each one shows what that
 * card actually does: the points that travel, the shield that goes up, the
 * cell the prisoner is taken to, the fire that comes out of the table.
 *
 * The framework is built out of small pieces that every cinematic shares:
 *
 *   stand / sit        a character gets up or sits back down
 *   walkTo            a character walks to a place
 *   pointAt           a character points at somebody
 *   react             a character reacts to what just happened
 *   lookAt            a character turns their head
 *   cameraFocus       the first-person view turns to watch something
 *
 * ...and the things a card does to the room itself, which live in
 * js/immersive/effects3d.js: sparks, rings, beams, numbers that fly
 * through the air, and the camera shaking when something lands.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { playAnimation } from './mixamo.js';
import { standCharacter, sitCharacter } from './seating.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* The shared pieces                                                    */
/* ------------------------------------------------------------------ */

/**
 * A character at their seat, or standing beside it.
 *
 * The place comes from the room: the chair is where the room says it is,
 * and the person stands just behind it, the way somebody stands up from a
 * chair.
 */
function seatOf(context, seat) {
  const character = context.characters[seat];
  if (!character) return null;
  const anchor = typeof context.seatAt === 'function' ? context.seatAt(seat) : null;
  const angle = anchor ? anchor.angle : (seat / context.seats) * Math.PI * 2;
  const radius = anchor ? Math.hypot(anchor.position.x, anchor.position.z) : context.tableRadius + 0.72;
  const seated = anchor
    ? anchor.position.clone()
    : new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
  const standing = anchor
    ? seated.clone().add(new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(0.55))
    : new THREE.Vector3(Math.sin(angle) * (radius + 0.55), 0, Math.cos(angle) * (radius + 0.55));
  return {
    character: character,
    seat: seat,
    angle: angle,
    radius: radius,
    seated: seated,
    standing: standing,
    // The height of the seat, so a person who stands up is standing on the
    // floor and not in the air.
    seatTop: anchor ? anchor.seatTop : 0.5
  };
}

/**
 * A character gets up.
 *
 * The standing animation is not in the set, so the character is moved to
 * their standing place and the running animation is played - the same
 * animation a walk uses, so the two never look like different people.
 */
function stand(context, seat) {
  const at = seatOf(context, seat);
  if (!at) return Promise.resolve();
  standCharacter(at.character, at);
  return playAnimation(at.character, 'running', { loop: true, speed: 0.35 })
    .catch(function () { return null; });
}

/** A character sits back down, and is put back on their chair. */
function sit(context, seat) {
  const at = seatOf(context, seat);
  if (!at) return Promise.resolve();
  sitCharacter(at.character, at);
  return playAnimation(at.character, 'sittingIdle', { loop: true })
    .catch(function () { return null; });
}

/**
 * A character walks to a place.
 *
 * The walk is the running animation, slowed, and the character is moved
 * there over the length of the walk - the animation and the movement are
 * given the same time so the feet land where they are going.
 */
function walkTo(context, seat, place, seconds) {
  const at = seatOf(context, seat);
  if (!at) return Promise.resolve();
  const from = at.character.group.position.clone();
  // People walk on the floor.
  const target = place.clone();
  target.y = 0;
  const distance = Math.hypot(target.x - from.x, target.z - from.z);
  const duration = seconds || Math.max(0.6, Math.min(4, distance / 0.9));
  at.character.group.rotation.y = Math.atan2(target.x - from.x, target.z - from.z);
  const action = playAnimation(at.character, 'running', { loop: true, speed: 1 })
    .catch(function () { return null; });
  const started = performance.now();
  return new Promise(function (resolve) {
    const step = function () {
      const t = Math.min(1, (performance.now() - started) / (duration * 1000));
      at.character.group.position.lerpVectors(from, target, t);
      at.character.group.position.y = 0;
      if (t < 1) requestAnimationFrame(step);
      else resolve(action);
    };
    step();
  });
}

/** A character turns their head towards a point. */
function lookAt(context, seat, point) {
  const at = seatOf(context, seat);
  if (!at || !point) return;
  const head = at.character.bones.filter(function (bone) {
    return /Head/.test(bone.name) && bone.name.indexOf('_') === -1;
  })[0];
  if (!head) return;
  const world = head.getWorldPosition(new THREE.Vector3());
  const direction = point.clone().sub(world);
  const wanted = Math.atan2(direction.x, direction.z);
  const current = at.character.group.rotation.y;
  let difference = wanted - current;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  at.character.group.rotation.y = current + difference * 0.4;
}

/** A character reacts: a small jolt, and a reaction animation if there is one. */
function react(context, seat, kind) {
  const at = seatOf(context, seat);
  if (!at) return Promise.resolve();
  const clip = kind === 'hit' ? 'hitToHead' : (kind === 'shoved' ? 'shovedWithSpin' : 'reaction');
  return playAnimation(at.character, clip, { loop: false })
    .then(function (played) {
      if (played) return new Promise(function (resolve) {
        setTimeout(resolve, 700);
      });
      return null;
    })
    .catch(function () { return null; });
}

/**
 * The first-person view turns to watch something, and comes back.
 *
 * The turn is limited, so the player is never spun round, and it is undone
 * whatever happens - a cinematic that throws does not leave the player
 * looking at the wall.
 */
function cameraFocus(context, point, seconds) {
  if (!point) return Promise.resolve();
  // With the motion turned down, the view does not swing about.
  if (context.reducedMotion) return Promise.resolve();
  const start = context.cameraState.yaw;
  const startPitch = context.cameraState.pitch;
  const wanted = Math.atan2(point.x - context.cameraPosition.x, point.z - context.cameraPosition.z)
    - context.headYaw;
  let difference = wanted - start;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  difference = Math.max(-0.8, Math.min(0.8, difference));
  const target = start + difference;
  const started = performance.now();
  const duration = (seconds || 1.2) * 1000;
  return new Promise(function (resolve) {
    const step = function () {
      const t = Math.min(1, (performance.now() - started) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      context.cameraState.yaw = start + (target - start) * eased;
      context.cameraState.pitch = startPitch + (0.12 - startPitch) * eased * 0.5;
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    step();
  });
}

/* ------------------------------------------------------------------ */
/* The places the cards act on                                         */
/* ------------------------------------------------------------------ */

/** Where a player's chest is, in the room. */
function chestOf(context, seat) {
  const at = seatOf(context, seat);
  if (!at) return null;
  const chest = at.character.bones.filter(function (bone) {
    return /Spine2/.test(bone.name) && bone.name.indexOf('_') === -1;
  })[0];
  if (chest) return chest.getWorldPosition(new THREE.Vector3());
  return at.seated.clone().setY((at.seatTop || 0.7) + 0.45);
}

/** Where a player's head is, in the room. */
function headOf(context, seat) {
  const at = seatOf(context, seat);
  if (!at) return null;
  const head = at.character.bones.filter(function (bone) {
    return /Head/.test(bone.name) && bone.name.indexOf('_') === -1;
  })[0];
  if (head) return head.getWorldPosition(new THREE.Vector3());
  return at.seated.clone().setY((at.seatTop || 0.7) + 0.6);
}

/** A point in the middle of the table, in the air. */
function overTable(context, height) {
  return new THREE.Vector3(0, context.tableHeight + (height || 0.35), 0);
}

/** The effects module, if the table has one. */
function fx(context) {
  return context.effects || null;
}

/** A burst of sparks, if there are any. */
function sparks(context, point, colour, count, power) {
  const effects = fx(context);
  if (!effects || !point) return Promise.resolve();
  return effects.burst(point, colour, count, power);
}

/* ------------------------------------------------------------------ */
/* The cinematics                                                       */
/* ------------------------------------------------------------------ */

/**
 * BONUS - +10,000 POINTS.
 *
 * A warm gold pours out of the card and settles on the player. The number
 * rises out of them.
 */
function bonus(context, event) {
  const at = seatOf(context, event.seat);
  if (!at) return Promise.resolve();
  const point = chestOf(context, event.seat) || at.seated;
  return sparks(context, point, 0xffd16b, 60, 1.5)
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.ring(point, 0xffd16b, 1.5, 1);
        effects.flare(point, 0xffd16b, 26, 0.8);
        effects.number(point.clone().setY(point.y + 0.3), '+10,000', '#ffd16b', 1.8);
      }
      return context.announce('+10,000 POINTS', 1400);
    })
    .then(function () { return wait(300); });
}

/**
 * KNIFE - the target is out for one round.
 *
 * A blade of light crosses the table and stops at the target. Nothing
 * bleeds: the light is the knife, and the target is out of the round.
 */
function knife(context, event) {
  const at = seatOf(context, event.seat);
  const victim = seatOf(context, event.targetSeat);
  if (!at || !victim) return Promise.resolve();
  const from = chestOf(context, event.seat) || at.seated;
  const to = chestOf(context, event.targetSeat) || victim.seated;
  return context.announce('KNIFE', 1200)
    .then(function () { return cameraFocus(context, to, 0.7); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.beam(from, to, 0xd8e8ff, 0.45);
        effects.burst(to, 0xd8e8ff, 40, 2.2);
        effects.shake(0.045, 320);
      }
      return wait(260);
    })
    .then(function () { return react(context, event.targetSeat, 'hit'); })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(to.clone().setY(to.y + 0.25), 'OUT FOR 1 ROUND', '#d8e8ff', 1.8);
      return context.announce('OUT FOR ONE ROUND', 1400);
    });
}

/**
 * HUNTER - you are protected.
 *
 * A green ward goes up round the player: anything aimed at them comes
 * back at the thrower.
 */
function hunter(context, event) {
  const at = seatOf(context, event.seat);
  if (!at) return Promise.resolve();
  const point = chestOf(context, event.seat) || at.seated;
  return context.announce('HUNTER', 1200)
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.aura(point, 0xb6ef87, 0.95, 2.4);
        effects.ring(point.clone().setY(point.y - 0.3), 0xb6ef87, 1.6, 1.2);
        effects.burst(point, 0xb6ef87, 44, 1.1);
      }
      return wait(500);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.3), 'PROTECTED', '#b6ef87', 1.8);
      return context.announce('ZOMBIES COME BACK AT YOU', 1600);
    });
}

/**
 * ZOMBIE - the target is out for a round and their points go to nothing.
 *
 * A cold green mist comes up round the target, and the score they had
 * drains away into it.
 */
function zombie(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const point = chestOf(context, event.targetSeat) || victim.seated;
  return context.announce('ZOMBIE', 1300)
    .then(function () { return cameraFocus(context, point, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.aura(point, 0x8ce879, 1.0, 2.6);
        effects.burst(point, 0x8ce879, 70, 0.9);
        effects.flare(point, 0x8ce879, 20, 1.2);
        effects.number(point.clone().setY(point.y + 0.3), '0', '#8ce879', 2);
      }
      return wait(600);
    })
    .then(function () { return react(context, event.targetSeat, 'hit'); })
    .then(function () { return context.announce('THEIR SCORE IS ZERO', 1600); });
}

/**
 * STEAL POINTS - all of the target's score goes to the thief.
 *
 * The points leave the target in a stream and land on the player.
 */
function steal(context, event) {
  const at = seatOf(context, event.seat);
  const victim = seatOf(context, event.targetSeat);
  if (!at || !victim) return Promise.resolve();
  const from = chestOf(context, event.targetSeat) || victim.seated;
  const to = chestOf(context, event.seat) || at.seated;
  return context.announce('STEAL', 1200)
    .then(function () { return cameraFocus(context, from, 0.8); })
    .then(function () {
      const effects = fx(context);
      if (!effects) return wait(700);
      for (let i = 0; i < 5; i++) {
        effects.scoreFlight(from.clone().setY(from.y + i * 0.06), to, '10,000', '#c49bff');
      }
      effects.beam(from, to, 0xc49bff, 1.1);
      effects.burst(to, 0xc49bff, 50, 1.6);
      effects.flare(to, 0xc49bff, 24, 1);
      return wait(900);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(to.clone().setY(to.y + 0.3), 'THEIR POINTS', '#c49bff', 1.8);
      return context.announce('THEIR POINTS ARE YOURS', 1600);
    });
}

/**
 * JUDGE - the court sits.
 *
 * The lamps go down, the word is given, and the player who has played the
 * most evil cards is taken to the cell. If the judge does not fire, there
 * is nothing to show but the word.
 */
function judge(context, event, result, settings) {
  const guilty = event.targetSeat;
  const at = seatOf(context, guilty);
  if (!at) return Promise.resolve();
  const cell = context.cellPoint || new THREE.Vector3(2.2, 0, -4.7);

  // The Judge fires half the time. When it does not, the only thing there
  // is to show is the word and the silence after it.
  if (settings && settings.outcome === 'inert') {
    return context.dim(0.4, 600)
      .then(function () { return context.announce('THE JUDGE HAS SPOKEN', 1800); })
      .then(function () { return context.announce('...AND SAID NOTHING', 2000); })
      .then(function () { return context.dim(1, 700); });
  }

  return context.dim(0.35, 700)
    .then(function () { return context.announce('THE JUDGE HAS SPOKEN', 2200); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.flare(overTable(context, 0.6), 0xffe2a4, 40, 1.1);
        effects.ring(overTable(context, 0.05), 0xffe2a4, 3.4, 1.3);
      }
      return wait(400);
    })
    .then(function () { return stand(context, guilty); })
    .then(function () { return cameraFocus(context, at.standing, 1); })
    .then(function () { return context.announce('THREE ROUNDS', 2000); })
    .then(function () { return walkTo(context, guilty, cell, 2.4); })
    .then(function () {
      lookAt(context, guilty, overTable(context, 0.2));
      const effects = fx(context);
      if (effects) {
        effects.burst(cell.clone().setY(1.2), 0xffe2a4, 40, 1.2);
        effects.flare(cell.clone().setY(1.4), 0xffe2a4, 18, 1);
      }
      return context.announce('THREE ROUNDS IN THE CELL', 2000);
    })
    .then(function () { return cameraFocus(context, overTable(context, 0.2), 1); })
    .then(function () { return context.dim(1, 700); });
}

/**
 * REVEAL DECK - you see the target's hand, and nothing else happens.
 *
 * A light finds the target, their cards are shown to the player who asked,
 * and the hand is put back exactly as it was.
 */
function reveal(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const point = chestOf(context, event.targetSeat) || victim.seated;
  return context.announce('REVEAL', 1200)
    .then(function () { return cameraFocus(context, point, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.flare(point, 0x88e4fa, 34, 1.1);
        effects.ring(point.clone().setY(point.y - 0.35), 0x88e4fa, 1.4, 1.1);
        effects.burst(point, 0x88e4fa, 40, 1.2);
      }
      return wait(700);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.3), 'THEIR HAND', '#88e4fa', 1.8);
      return context.announce('THEIR HAND, AND NOTHING ELSE', 1700);
    });
}

/**
 * SKIP EVERYONE - everybody else is skipped and you go again.
 *
 * A wave goes out round the table and the other players are put aside.
 */
function skipall(context, event) {
  const effects = fx(context);
  const others = [];
  for (let i = 0; i < context.seats; i++) {
    if (i !== event.seat && seatOf(context, i)) others.push(i);
  }
  return context.announce('SKIP EVERYONE', 1500)
    .then(function () {
      if (!effects) return wait(600);
      others.forEach(function (seat, index) {
        const point = chestOf(context, seat);
        if (!point) return;
        effects.ring(point.clone().setY(point.y - 0.35), 0xe2c0ff, 1.8, 0.9);
        effects.burst(point, 0xe2c0ff, 24, 1.1);
        setTimeout(function () {
          effects.number(point.clone().setY(point.y + 0.3), 'SKIPPED', '#e2c0ff', 1.4);
        }, index * 130);
      });
      return wait(900);
    })
    .then(function () { return context.announce('AND YOU GO AGAIN', 1600); });
}

/**
 * PHOENIX - the legendary card.
 *
 * The table catches fire. The fire takes every other player, their points
 * come to the player who played it, and one of them has to draw again.
 */
function phoenix(context, event) {
  const at = seatOf(context, event.seat);
  if (!at) return Promise.resolve();
  const centre = overTable(context, 0.55);
  const player = chestOf(context, event.seat) || at.seated;

  return context.dim(0.5, 600)
    .then(function () { return context.announce('THE PHOENIX RISES', 2000); })
    .then(function () {
      const effects = fx(context);
      if (!effects) return wait(700);
      // The fire comes up out of the middle of the table.
      for (let i = 0; i < 7; i++) {
        setTimeout(function () {
          effects.burst(centre, 0xff8a3c, 60, 3.2);
          effects.flare(centre, 0xffb54e, 46, 0.9);
          effects.ring(centre.clone().setY(context.tableHeight + 0.02), 0xff8a3c, 3.2, 1.1);
        }, i * 140);
      }
      return wait(1200);
    })
    .then(function () {
      // The fire reaches the other players.
      const effects = fx(context);
      if (effects) {
        for (let i = 0; i < context.seats; i++) {
          if (i === event.seat) continue;
          const point = chestOf(context, i);
          if (!point) continue;
          effects.beam(centre, point, 0xff8a3c, 0.9);
          effects.burst(point, 0xff8a3c, 46, 2.4);
        }
      }
      return wait(700);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.flare(player, 0xffd16b, 60, 1.6);
        effects.number(player.clone().setY(player.y + 0.4), 'EVERY POINT', '#ffb54e', 2.2);
      }
      return context.announce('EVERY POINT. EVERYBODY ELSE. OUT.', 2200);
    })
    .then(function () { return context.dim(1, 900); });
}

/**
 * TRICK - the target is disguised as somebody else.
 *
 * A mask comes down over their face and their name is scrambled. They are
 * still themselves: only the table is fooled, and only until the end of
 * the round.
 */
function trick(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const point = headOf(context, event.targetSeat) || victim.seated;
  return context.announce('TRICK', 1300)
    .then(function () { return cameraFocus(context, point, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.aura(point, 0xd8a2ff, 0.55, 2.2);
        effects.burst(point, 0xd8a2ff, 60, 1.4);
        effects.flare(point, 0xd8a2ff, 24, 1);
      }
      return wait(600);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.35), 'NOT WHO THEY SEEM', '#d8a2ff', 2);
      return context.announce('EVERYBODY READS THEM WRONG', 1900);
    });
}

/**
 * STEAL A TURN - you choose the card they play.
 *
 * The thief reaches over and takes a card out of the target's hand.
 */
function stealturn(context, event) {
  const at = seatOf(context, event.seat);
  const victim = seatOf(context, event.targetSeat);
  if (!at || !victim) return Promise.resolve();
  return stand(context, event.seat)
    .then(function () {
      const beside = victim.seated.clone().add(
        new THREE.Vector3(Math.sin(victim.angle), 0, Math.cos(victim.angle)).multiplyScalar(0.62)
      );
      return walkTo(context, event.seat, beside, 1.5);
    })
    .then(function () {
      lookAt(context, event.seat, chestOf(context, event.targetSeat) || victim.seated);
      const from = chestOf(context, event.targetSeat) || victim.seated;
      const to = chestOf(context, event.seat) || at.seated;
      const effects = fx(context);
      if (effects) {
        effects.cardFlight(from, to, 0x89b9ff);
        effects.burst(to, 0x89b9ff, 30, 1.2);
      }
      return wait(800);
    })
    .then(function () { return react(context, event.targetSeat, 'shoved'); })
    .then(function () { return walkTo(context, event.seat, at.standing, 1.3); })
    .then(function () { return sit(context, event.seat); })
    .then(function () { return context.announce('YOU CHOOSE THEIR CARD', 1700); });
}

/**
 * CURSE - one of their cards is marked, and they do not know which.
 *
 * A dark rune goes over the target and a card in their hand starts to
 * glow. They are not told which one.
 */
function curse(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const point = chestOf(context, event.targetSeat) || victim.seated;
  return context.announce('CURSE', 1400)
    .then(function () { return cameraFocus(context, point, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.aura(point, 0xc69bff, 0.8, 2.4);
        effects.burst(point, 0xc69bff, 50, 1);
        effects.flare(point, 0xc69bff, 18, 1.4);
      }
      return wait(800);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.3), 'ONE OF THEM', '#c69bff', 2);
      return context.announce('ONE CARD OF THEIRS IS CURSED', 2000);
    });
}

/**
 * GHOST - you cannot be aimed at for the rest of the round.
 *
 * The player goes transparent and the table looks straight through them.
 */
function ghost(context, event) {
  const at = seatOf(context, event.seat);
  if (!at) return Promise.resolve();
  const point = chestOf(context, event.seat) || at.seated;
  const body = at.character.group;
  return context.announce('GHOST', 1400)
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.aura(point, 0xd5f1ff, 0.9, 2.6);
        effects.burst(point, 0xd5f1ff, 56, 1.1);
        effects.flare(point, 0xd5f1ff, 24, 1.4);
      }
      // The body goes see-through.
      body.traverse(function (object) {
        if (!object.isMesh || !object.material) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(function (material) {
          if (material.userData.__ghostOriginal === undefined) {
            material.userData.__ghostOriginal = material.opacity;
            material.userData.__ghostTransparent = material.transparent;
          }
          material.transparent = true;
          material.opacity = 0.28;
        });
      });
      return wait(900);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.35), 'UNTOUCHABLE', '#d5f1ff', 2);
      return context.announce('NOTHING CAN BE AIMED AT YOU', 1900);
    });
}

/**
 * ALVIN - a ginger cat, and one card of theirs for ever.
 *
 * A cat appears on the table, the cards are looked at, and one of them
 * burns away for good.
 */
function alvin(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const centre = overTable(context, 0.16);
  return context.announce('ALVIN', 1400)
    .then(function () { return cameraFocus(context, centre, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.burst(centre, 0xffac70, 44, 1.1);
        effects.ring(centre.clone().setY(context.tableHeight + 0.02), 0xffac70, 1.5, 1);
        effects.flare(centre, 0xffac70, 18, 1);
      }
      return wait(700);
    })
    .then(function () {
      const from = chestOf(context, event.targetSeat) || victim.seated;
      const effects = fx(context);
      if (effects) {
        effects.cardFlight(from, centre, 0xffac70);
        effects.burst(centre, 0xff874a, 60, 1.6);
        effects.flare(centre, 0xff874a, 30, 1.1);
      }
      return wait(800);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(centre.clone().setY(centre.y + 0.3), 'ONE CARD, FOR EVER', '#ff874a', 2);
      return context.announce('ONE OF THEIRS IS GONE FOR GOOD', 2100);
    });
}

/**
 * DICE CHALLENGE - both roll, and the higher one wins.
 *
 * Two dice land on the table and the winner takes the points.
 */
function dice(context, event) {
  const at = seatOf(context, event.seat);
  const victim = seatOf(context, event.targetSeat);
  if (!at || !victim) return Promise.resolve();
  const left = overTable(context, 0.1).add(new THREE.Vector3(-0.35, 0, 0));
  const right = overTable(context, 0.1).add(new THREE.Vector3(0.35, 0, 0));
  return context.announce('DICE', 1300)
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.burst(left, 0xffd700, 30, 1.4);
        effects.burst(right, 0xffd700, 30, 1.4);
        effects.flare(left, 0xffd700, 18, 0.8);
        effects.flare(right, 0xffd700, 18, 0.8);
      }
      return wait(800);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.number(left.clone().setY(left.y + 0.25), 'ROLL', '#ffd700', 1.4);
        effects.number(right.clone().setY(right.y + 0.25), 'ROLL', '#ffd700', 1.4);
      }
      return context.announce('THE HIGHER ONE WINS 20,000', 1900);
    });
}

/**
 * ROCK PAPER SCISSORS - both choose in secret, and the loser is out.
 *
 * Three ghostly hands appear over the table and one of them wins.
 */
function rps(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const centre = overTable(context, 0.35);
  return context.announce('ROCK PAPER SCISSORS', 1600)
    .then(function () { return cameraFocus(context, centre, 0.8); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.burst(centre, 0xff6b6b, 54, 1.5);
        effects.flare(centre, 0xff6b6b, 26, 1);
        effects.ring(centre.clone().setY(context.tableHeight + 0.02), 0xff6b6b, 2, 1);
      }
      return wait(800);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(centre.clone().setY(centre.y + 0.3), 'THE LOSER IS OUT', '#ff6b6b', 2);
      return context.announce('THE LOSER IS OUT FOR ONE ROUND', 2100);
    });
}

/**
 * BETRAYAL - two of them choose, in secret, to share or to steal.
 *
 * Two masks come down over the table and one of them turns away.
 */
function betrayal(context, event) {
  const centre = overTable(context, 0.3);
  const targets = [];
  if (typeof event.targetIds === 'object' && event.targetIds) targets = event.targetIds;
  else if (event.targetSeat !== undefined && event.targetSeat >= 0) targets = [event.targetSeat];
  return context.announce('BETRAYAL', 1500)
    .then(function () { return cameraFocus(context, centre, 0.8); })
    .then(function () {
      const effects = fx(context);
      targets.forEach(function (seat, index) {
        const point = chestOf(context, seat);
        if (!effects || !point) return;
        setTimeout(function () {
          effects.aura(point, 0x9b59b6, 0.6, 1.8);
          effects.burst(point, 0x9b59b6, 34, 1.2);
        }, index * 220);
      });
      if (effects) effects.flare(centre, 0x9b59b6, 20, 1);
      return wait(900);
    })
    .then(function () { return context.announce('SHARE, OR TAKE IT ALL', 1900); });
}

/**
 * SPEED CHALLENGE - the first one to move wins.
 *
 * A light goes off and both of them are away.
 */
function speed(context, event) {
  const at = seatOf(context, event.seat);
  const victim = seatOf(context, event.targetSeat);
  if (!at || !victim) return Promise.resolve();
  const from = chestOf(context, event.seat) || at.seated;
  const to = chestOf(context, event.targetSeat) || victim.seated;
  return context.announce('SPEED', 1300)
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.flare(overTable(context, 0.4), 0x00d4ff, 40, 0.8);
        effects.burst(overTable(context, 0.4), 0x00d4ff, 60, 2.6);
        effects.beam(from, to, 0x00d4ff, 0.6);
        effects.shake(0.03, 260);
      }
      return wait(700);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.number(from.clone().setY(from.y + 0.3), 'FASTEST', '#00d4ff', 1.8);
        effects.number(to.clone().setY(to.y + 0.3), 'TOO SLOW', '#00d4ff', 1.8);
      }
      return context.announce('15,000 TO THE FASTEST', 1900);
    });
}

/**
 * WHEEL OF FORTUNE - nine outcomes, and the wheel picks one.
 *
 * A big wheel turns over the table and stops on something.
 */
function wheel(context, event) {
  const centre = overTable(context, 0.75);
  return context.announce('THE WHEEL', 1500)
    .then(function () { return cameraFocus(context, centre, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.ring(centre.clone().setY(context.tableHeight + 0.03), 0xff9500, 2.6, 1.6);
        effects.flare(centre, 0xff9500, 30, 1.4);
        for (let i = 0; i < 6; i++) {
          setTimeout(function () {
            const effects2 = fx(context);
            if (effects2) effects2.burst(centre, 0xff9500, 26, 1.8);
          }, i * 170);
        }
      }
      return wait(1200);
    })
    .then(function () { return context.announce('WHAT THE WHEEL DECIDES', 1800); });
}

/**
 * LINKED FATE - the two of them are tied together.
 *
 * A chain of light runs between them, and it does not matter which end it
 * is looked at from.
 */
function linkedfate(context, event) {
  const at = seatOf(context, event.seat);
  const victim = seatOf(context, event.targetSeat);
  if (!at || !victim) return Promise.resolve();
  const from = chestOf(context, event.seat) || at.seated;
  const to = chestOf(context, event.targetSeat) || victim.seated;
  return context.announce('LINKED FATE', 1500)
    .then(function () { return cameraFocus(context, from.clone().lerp(to, 0.5), 0.9); })
    .then(function () {
      const effects = fx(context);
      if (!effects) return wait(700);
      effects.beam(from, to, 0x00ff88, 2.4);
      effects.ring(from, 0x00ff88, 1.2, 1.2);
      effects.ring(to, 0x00ff88, 1.2, 1.2);
      effects.burst(from.clone().lerp(to, 0.5), 0x00ff88, 60, 1.4);
      return wait(1000);
    })
    .then(function () { return context.announce('EACH GETS HALF OF THE OTHER', 2000); });
}

/**
 * IMPOSTOR - one of them is not who they say.
 *
 * A mask goes round the table and settles on somebody.
 */
function impostor(context, event) {
  const centre = overTable(context, 0.5);
  return context.announce('IMPOSTOR', 1600)
    .then(function () { return cameraFocus(context, centre, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (!effects) return wait(800);
      for (let i = 0; i < context.seats; i++) {
        const point = chestOf(context, i);
        if (!point) continue;
        setTimeout(function () {
          const effects2 = fx(context);
          if (effects2) effects2.burst(point, 0x8e44ad, 26, 1.2);
        }, i * 160);
      }
      effects.flare(centre, 0x8e44ad, 30, 1.3);
      return wait(1000);
    })
    .then(function () { return context.announce('ONE OF THEM IS TELLING THE TRUTH', 2100); });
}

/**
 * ALLY SWAPPER - the two allies trade places.
 *
 * Two lights leap across the table and swap.
 */
function swapper(context, event) {
  const at = seatOf(context, event.seat);
  const victim = seatOf(context, event.targetSeat);
  if (!at || !victim) return Promise.resolve();
  const from = chestOf(context, event.seat) || at.seated;
  const to = chestOf(context, event.targetSeat) || victim.seated;
  return context.announce('ALLY SWAPPER', 1500)
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.burst(from, 0xff4081, 40, 1.4);
        effects.burst(to, 0xff4081, 40, 1.4);
      }
      return wait(400);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.beam(from, to, 0xff4081, 1);
        effects.beam(to, from, 0xff4081, 1);
      }
      return wait(800);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(centre2(context), 'SWAPPED', '#ff4081', 1.8);
      return context.announce('THEIR ALLIES TRADE PLACES', 1900);
    });
}

/** A helper for the cinematics that put something in the middle. */
function centre2(context) {
  return overTable(context, 0.35);
}

/**
 * WHEEL OF MISFORTUNE - eight outcomes, and none of them are good.
 *
 * The same wheel, in the dark, and the room goes cold.
 */
function wheelofmisfortune(context, event) {
  const centre = overTable(context, 0.8);
  return context.dim(0.4, 700)
    .then(function () { return context.announce('WHEEL OF MISFORTUNE', 1800); })
    .then(function () { return cameraFocus(context, centre, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.ring(centre.clone().setY(context.tableHeight + 0.03), 0x8b0000, 2.8, 1.7);
        effects.flare(centre, 0x8b0000, 34, 1.5);
        for (let i = 0; i < 6; i++) {
          setTimeout(function () {
            const effects2 = fx(context);
            if (effects2) effects2.burst(centre, 0x8b0000, 28, 1.9);
          }, i * 170);
        }
      }
      return wait(1200);
    })
    .then(function () { return context.announce('THE WHEEL DECIDES', 1700); })
    .then(function () { return context.dim(1, 800); });
}

/**
 * MUSICAL CHAIRS - the music stops, and the last one to press is out.
 *
 * The chairs empty one by one, and the player who was too slow is left
 * standing.
 */
function musicalchairs(context, event) {
  return context.announce('MUSICAL CHAIRS', 1700)
    .then(function () {
      const effects = fx(context);
      if (!effects) return wait(700);
      for (let i = 0; i < context.seats; i++) {
        if (i === event.seat) continue;
        const point = chestOf(context, i);
        if (!point) continue;
        setTimeout(function () {
          const effects2 = fx(context);
          if (effects2) {
            effects2.burst(point, 0x7ec8e3, 30, 1.3);
            effects2.number(point.clone().setY(point.y + 0.3), 'SAT DOWN', '#7ec8e3', 1.3);
          }
        }, i * 150);
      }
      return wait(1000);
    })
    .then(function () { return context.announce('TOO SLOW: -10,000', 1900); });
}

/**
 * RUSSIAN ROULETTE - the revolver, and the odds that keep rising.
 *
 * A revolver lies on the table. Nobody is hurt: the card is about the
 * odds, and the card says so.
 */
function russianroulette(context, event) {
  const centre = overTable(context, 0.1);
  return context.announce('RUSSIAN ROULETTE', 1700)
    .then(function () { return cameraFocus(context, centre, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.flare(centre, 0xc0392b, 26, 1.2);
        effects.ring(centre.clone().setY(context.tableHeight + 0.02), 0xc0392b, 1.6, 1);
      }
      return wait(600);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        for (let i = 0; i < 4; i++) {
          setTimeout(function () {
            const effects2 = fx(context);
            if (effects2) effects2.burst(centre, 0xc0392b, 20, 1.2);
          }, i * 260);
        }
      }
      return wait(900);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(centre.clone().setY(centre.y + 0.3), 'ONE IN SIX...', '#c0392b', 2);
      return context.announce('THE ODDS KEEP RISING', 1900);
    });
}

/**
 * MEMORY MAYHEM - three sequences, and everybody has to remember them.
 *
 * Symbols flash in the air above the table and are gone.
 */
function memorymayhem(context, event) {
  const centre = overTable(context, 0.4);
  return context.announce('MEMORY MAYHEM', 1700)
    .then(function () { return cameraFocus(context, centre, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (!effects) return wait(700);
      for (let round = 0; round < 3; round++) {
        setTimeout(function () {
          const effects2 = fx(context);
          if (!effects2) return;
          for (let i = 0; i < 4 + round * 2; i++) {
            setTimeout(function () {
              const effects3 = fx(context);
              if (effects3) {
                effects3.burst(centre, 0xb39ddb, 16, 1.1);
                effects3.number(centre.clone().setY(centre.y + 0.2), '?', '#b39ddb', 0.9);
              }
            }, i * 150);
          }
        }, round * 1200);
      }
      return wait(2200);
    })
    .then(function () { return context.announce('THE LOWEST ACCURACY LOSES 8,000', 2100); });
}

/**
 * BANK ROBBERY - the biggest score in the room is robbed.
 *
 * A sack of money leaves the richest player and lands in the thief's
 * hands.
 */
function bankrobbery(context, event) {
  const at = seatOf(context, event.seat);
  const victim = seatOf(context, event.targetSeat);
  if (!at || !victim) return Promise.resolve();
  const from = chestOf(context, event.targetSeat) || victim.seated;
  const to = chestOf(context, event.seat) || at.seated;
  return context.announce('BANK ROBBERY', 1600)
    .then(function () { return cameraFocus(context, from, 0.8); })
    .then(function () {
      const effects = fx(context);
      if (!effects) return wait(800);
      for (let i = 0; i < 6; i++) {
        effects.scoreFlight(from.clone().setY(from.y + i * 0.05), to, '10,000', '#ffd700');
      }
      effects.beam(from, to, 0xffd700, 1.1);
      effects.burst(to, 0xffd700, 60, 1.8);
      effects.flare(to, 0xffd700, 30, 1.1);
      return wait(1000);
    })
    .then(function () { return context.announce('THEY TOOK A QUARTER', 1900); });
}

/**
 * POINT SWAP - the two scores change hands entirely.
 *
 * Two columns of light leap across the table and trade places.
 */
function pointswap(context, event) {
  const at = seatOf(context, event.seat);
  const victim = seatOf(context, event.targetSeat);
  if (!at || !victim) return Promise.resolve();
  const from = chestOf(context, event.seat) || at.seated;
  const to = chestOf(context, event.targetSeat) || victim.seated;
  return context.announce('POINT SWAP', 1500)
    .then(function () {
      const effects = fx(context);
      if (!effects) return wait(800);
      effects.scoreFlight(from, to, 'YOUR SCORE', '#66d9e8');
      effects.scoreFlight(to, from, 'THEIR SCORE', '#66d9e8');
      effects.beam(from, to, 0x66d9e8, 1.4);
      effects.beam(to, from, 0x66d9e8, 1.4);
      effects.burst(from, 0x66d9e8, 40, 1.4);
      effects.burst(to, 0x66d9e8, 40, 1.4);
      return wait(1000);
    })
    .then(function () { return context.announce('EVERY POINT, EACH WAY', 1900); });
}

/**
 * HOSTAGE SITUATION - you take somebody hostage.
 *
 * The room darkens, the criminal is named, the hostage is taken, and the
 * objective appears on the laptops: the officer has to earn 40,000 before
 * the hostage is let go.
 */
function hostage(context, event) {
  const criminal = event.seat;
  const hostageSeat = event.targetSeat;
  const at = seatOf(context, criminal);
  if (!at) return Promise.resolve();

  // The officer is one of the others; when the event does not say, it is
  // the next player round.
  const others = [];
  for (let i = 0; i < context.seats; i++) {
    if (i !== criminal && i !== hostageSeat) others.push(i);
  }
  const officer = others[Math.floor(Math.random() * others.length)];

  return context.dim(0.4, 700)
    .then(function () { return context.announce('HOSTAGE SITUATION', 1900); })
    .then(function () { return stand(context, criminal); })
    .then(function () { return cameraFocus(context, at.standing, 1); })
    .then(function () { return context.announce('YOU ARE THE CRIMINAL', 2200); })
    .then(function () {
      if (hostageSeat === undefined) return null;
      const victim = seatOf(context, hostageSeat);
      if (!victim) return null;
      return walkTo(context, criminal, victim.standing, 1.6);
    })
    .then(function () {
      const effects = fx(context);
      if (effects && hostageSeat !== undefined) {
        const point = chestOf(context, hostageSeat);
        if (point) {
          effects.aura(point, 0xe74c3c, 0.7, 2.4);
          effects.burst(point, 0xe74c3c, 44, 1.3);
        }
      }
      return context.announce('THE OFFICIAL IS COMING', 1900);
    })
    .then(function () {
      if (officer === undefined) return null;
      return stand(context, officer);
    })
    .then(function () {
      // The objective is on the laptops, where the bank always is.
      return context.showObjective('THE OFFICIAL MUST EARN 40,000 POINTS', 6000);
    })
    .then(function () {
      if (officer === undefined) return null;
      return sit(context, officer);
    })
    .then(function () {
      if (hostageSeat === undefined) return null;
      return sit(context, criminal);
    })
    .then(function () { return context.dim(1, 700); });
}

/**
 * PRESIDENT - you are the president of the table.
 *
 * A crown of light goes up over the player, and the table bows to it.
 */
function president(context, event) {
  const at = seatOf(context, event.seat);
  if (!at) return Promise.resolve();
  const point = headOf(context, event.seat) || at.seated;
  return context.announce('PRESIDENT', 1500)
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.flare(point, 0xffd16b, 40, 1.4);
        effects.ring(point.clone().setY(point.y - 0.5), 0xffd16b, 2, 1.3);
        effects.burst(point, 0xffd16b, 70, 1.5);
      }
      return wait(900);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.3), 'PRESIDENT', '#ffd16b', 2.2);
      return context.announce('5,000 POINTS A ROUND', 1900);
    });
}

/**
 * THE JOSHUA SURVEY - one question, and everybody answers it.
 *
 * A question hangs over the table, and the answers float up one by one.
 */
function joshuasurvey(context, event) {
  const centre = overTable(context, 0.45);
  return context.announce('THE JOSHUA SURVEY', 1900)
    .then(function () { return cameraFocus(context, centre, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.flare(centre, 0xffd16b, 30, 1.2);
        effects.number(centre.clone().setY(centre.y + 0.25), '?', '#ffd16b', 2.2);
      }
      return wait(700);
    })
    .then(function () {
      const effects = fx(context);
      if (!effects) return wait(700);
      for (let i = 0; i < context.seats; i++) {
        const point = chestOf(context, i);
        if (!point) continue;
        setTimeout(function () {
          const effects2 = fx(context);
          if (effects2) effects2.number(point.clone().setY(point.y + 0.3), 'AN ANSWER', '#ffd16b', 1.5);
        }, i * 240);
      }
      return wait(1100);
    })
    .then(function () { return context.announce('THE OWNER READS THEM AND DECIDES', 2200); });
}

/**
 * DID YOU LIKE THE TRAILER - the trailer plays over their game.
 *
 * The screen on the target's laptop lights up, and the trailer plays. It
 * cannot be skipped, and their game waits for it.
 */
function trailer(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const laptop = context.laptopAt(event.targetSeat);
  const point = laptop ? laptop.screenWorldPosition() : (chestOf(context, event.targetSeat) || victim.seated);
  return context.announce('THE TRAILER', 1600)
    .then(function () { return cameraFocus(context, point, 1); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.flare(point, 0xff4081, 30, 1.3);
        effects.burst(point, 0xff4081, 40, 1.2);
      }
      return wait(700);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.3), 'WATCH THE WHOLE THING', '#ff4081', 2.2);
      return context.announce('THEIR GAME WAITS', 2000);
    });
}

/**
 * ENJOYING THE TRAILER - the same, and there is no way out of it.
 *
 * The screen comes up brighter and stays up.
 */
function enjoyingthetrailer(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const laptop = context.laptopAt(event.targetSeat);
  const point = laptop ? laptop.screenWorldPosition() : (chestOf(context, event.targetSeat) || victim.seated);
  return context.announce('ENJOYING THE TRAILER', 1700)
    .then(function () { return cameraFocus(context, point, 1); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.flare(point, 0xff7ab3, 46, 1.8);
        effects.burst(point, 0xff7ab3, 60, 1.5);
        effects.ring(point, 0xff7ab3, 1.6, 1.4);
      }
      return wait(900);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.3), 'NO SKIPPING', '#ff7ab3', 2.2);
      return context.announce('NO SKIP. NO FAST FORWARD.', 2200);
    });
}

/**
 * THE MIMIC - the card that was not what it looked like.
 *
 * The character whose card was a Mimic looks at their laptop, and the
 * video plays on it. The player who was pranked sees the real thing;
 * everybody else sees the screen light up and hears the sound come from
 * that side of the table.
 */
function mimic(context, event) {
  const victim = event.seat;
  const at = seatOf(context, victim);
  if (!at) return Promise.resolve();

  const laptop = context.laptopAt(victim);
  const point = laptop ? laptop.screenWorldPosition() : at.seated;

  return context.announce('THE MIMIC', 1600)
    .then(function () {
      lookAt(context, victim, point);
      return cameraFocus(context, point, 1.1);
    })
    .then(function () {
      // The video plays on the laptop screen. The player who was pranked
      // gets the real player, sized to the screen; everybody else gets the
      // sound, quieter the further away they are sitting.
      return context.playMimicVideo(victim, point);
    })
    .then(function () { return context.announce('THE CARD WAS A MIMIC', 2000); });
}

/**
 * DEHYDRATED - the target's whole world turns sideways.
 *
 * The table goes on its side for them, and a bottle of water lands in
 * front of them. Everything still works; it is just extremely annoying.
 */
function dehydrated(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const point = chestOf(context, event.targetSeat) || victim.seated;
  const laptop = context.laptopAt(event.targetSeat);
  return context.announce('DEHYDRATED?', 1700)
    .then(function () { return cameraFocus(context, point, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.burst(point, 0x5dade2, 50, 1.2);
        effects.flare(point, 0x5dade2, 24, 1.2);
      }
      return wait(500);
    })
    .then(function () {
      // Their screen tips over, and stays tipped over.
      if (laptop && laptop.group) {
        laptop.group.rotation.z = 0.42;
        laptop.group.rotation.x = 0.16;
      }
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.3), 'DRINK SOME WATER', '#5dade2', 2.2);
      return context.announce('EVERYTHING IS SIDEWAYS FOR TWO ROUNDS', 2400);
    });
}

/**
 * NOTHING - this card does nothing.
 *
 * Absurdly dramatic, and then absolutely nothing happens - which is the
 * whole point of the card. The lights dim, the table is spotlit, the
 * camera creeps in, and the room goes back to normal.
 */
function nothing(context, event) {
  const at = seatOf(context, event.seat);
  return context.dim(0.35, 900)
    .then(function () { return cameraFocus(context, at ? at.seated : null, 2.2); })
    .then(function () { return context.announce('SOMETHING IS ABOUT TO HAPPEN', 2200); })
    .then(function () { return context.announce('...', 1200); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        const centre = overTable(context, 0.5);
        effects.flare(centre, 0x95a5a6, 30, 1.2);
        effects.burst(centre, 0x95a5a6, 40, 1.4);
      }
      return wait(400);
    })
    .then(function () { return context.dim(1, 700); })
    .then(function () { return context.announce('NOTHING HAPPENED', 2200); });
}

/**
 * THE UNO REVERSE OF DOOM - a trap, and nobody knows where it is.
 *
 * Something springs under the table, quietly, and the trap waits for the
 * next card aimed at the player.
 */
function reverseofdoom(context, event) {
  const at = seatOf(context, event.seat);
  if (!at) return Promise.resolve();
  const point = at.seated.clone().setY((at.seatTop || 0.7) + 0.1);
  return context.dim(0.45, 600)
    .then(function () { return context.announce('A TRAP IS SET', 1800); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.ring(point.clone().setY(context.tableHeight + 0.02), 0x8e44ad, 2.4, 1.3);
        effects.burst(point, 0x8e44ad, 50, 1.3);
        effects.flare(point, 0x8e44ad, 26, 1.2);
        effects.shake(0.035, 300);
      }
      return wait(700);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(point.clone().setY(point.y + 0.35), 'SPRUNG', '#8e44ad', 2);
      return context.announce('NOBODY KNOWS IT IS THERE', 2100);
    })
    .then(function () { return context.dim(1, 700); });
}

/**
 * PHOENIX ENTERTAINMENT CUSTOMER SUPPORT - a complaint form.
 *
 * A form slides across the table, and the reply is always the same.
 */
function support(context, event) {
  const victim = seatOf(context, event.targetSeat);
  if (!victim) return Promise.resolve();
  const centre = overTable(context, 0.2);
  return context.announce('CUSTOMER SUPPORT', 1700)
    .then(function () { return cameraFocus(context, centre, 0.9); })
    .then(function () {
      const effects = fx(context);
      if (effects) {
        effects.cardFlight(centre.clone().setY(centre.y + 0.4), centre, 0xf5b041);
        effects.burst(centre, 0xf5b041, 40, 1.2);
        effects.flare(centre, 0xf5b041, 20, 1);
      }
      return wait(800);
    })
    .then(function () {
      const effects = fx(context);
      if (effects) effects.number(centre.clone().setY(centre.y + 0.3), 'REJECTED', '#f5b041', 2.2);
      return context.announce('YOUR COMPLAINT HAS BEEN REJECTED', 2400);
    });
}

/* ------------------------------------------------------------------ */
/* The registry                                                         */
/* ------------------------------------------------------------------ */

/**
 * Every cinematic, by the card it belongs to.
 *
 * There is one for every card in the game: the fourteen of the original
 * set, the nine that came with the second batch, and the fifteen of the
 * expansion. A card with no cinematic would simply do nothing, so there
 * is none.
 */
export const CINEMATICS = {
  bonus: bonus,
  knife: knife,
  hunter: hunter,
  zombie: zombie,
  steal: steal,
  judge: judge,
  reveal: reveal,
  skipall: skipall,
  phoenix: phoenix,
  trick: trick,
  stealturn: stealturn,
  curse: curse,
  ghost: ghost,
  alvin: alvin,
  dice: dice,
  rps: rps,
  betrayal: betrayal,
  speed: speed,
  wheel: wheel,
  linkedfate: linkedfate,
  impostor: impostor,
  swapper: swapper,
  wheelofmisfortune: wheelofmisfortune,
  musicalchairs: musicalchairs,
  russianroulette: russianroulette,
  memorymayhem: memorymayhem,
  bankrobbery: bankrobbery,
  pointswap: pointswap,
  hostage: hostage,
  president: president,
  joshuasurvey: joshuasurvey,
  trailer: trailer,
  enjoyingthetrailer: enjoyingthetrailer,
  mimic: mimic,
  dehydrated: dehydrated,
  nothing: nothing,
  reverseofdoom: reverseofdoom,
  support: support
};

/**
 * The card an effect belongs to.
 *
 * The server publishes what happened under a name of its own: 'alvin-burn'
 * is Alvin choosing a card, 'curse-trigger' is a curse firing, and the ally
 * effects are the allies. This turns any of those into the card it belongs
 * to, so the right show is played.
 */
export function cardIdFor(key) {
  const name = String(key || '');
  if (name === 'alvin-burn') return 'alvin';
  if (name === 'curse-trigger') return 'curse';
  if (name === 'hunter-block') return 'hunter';
  if (name === 'maple-restriction') return null;
  // The allies and the blocks are their own thing, not a card.
  if (name.indexOf('ally-') === 0 || name.indexOf('block-') === 0) return null;
  return name;
}

/** The cards there are, from the registry itself. */
export function cinematicCards() {
  return Object.keys(CINEMATICS);
}

/**
 * Play the cinematic for a card.
 *
 * The events are the server's own: the card that was played, who played it,
 * who it was aimed at, and what the engine said about it. The cinematic only
 * shows that; it never decides anything.
 *
 * `options`:
 *   outcome       'active' or 'inert' - some cards do nothing at all
 *   reducedMotion true to keep it short and calm
 */
export function playCinematic(cardId, context, events, options) {
  const settings = Object.assign({ outcome: 'active', reducedMotion: false }, options || {});
  const cinematic = CINEMATICS[cardId];
  if (!cinematic || !context) return Promise.resolve(null);

  // Some cards did nothing at all - the Steal took no points, the Judge did
  // not fire. There is nothing to show for those, and pretending otherwise
  // would be a lie. The Judge is the exception: its whole point is that it
  // may not fire, so it says so.
  if (settings.outcome === 'inert' && cardId !== 'judge' && cardId !== 'nothing') {
    return Promise.resolve(true);
  }

  const event = (events || []).find(function (e) { return e.type === 'card' && e.cardId === cardId; })
    || (events || []).find(function (e) { return e.type === 'card'; })
    || { seat: 0, targetSeat: -1 };
  const result = (events || []).find(function (e) { return e.type === 'result' && e.cardId === cardId; });
  context.reducedMotion = !!settings.reducedMotion;
  return Promise.resolve()
    .then(function () { return cinematic(context, event, result, settings); })
    .then(function () { return true; })
    .catch(function () { return false; });
}

export { stand, sit, walkTo, lookAt, react, cameraFocus };
