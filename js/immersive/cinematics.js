/* PHOENIX - the cinematics.
 *
 * A cinematic is a short piece of theatre that happens because a card was
 * played. It never decides anything: the SERVER has already decided what the
 * card did, and the cinematic only shows it. Nothing in this file can change
 * a score, a target, an elimination or the turn - the worst it could do is
 * look wrong.
 *
 * The framework is built out of small pieces that every cinematic shares:
 *
 *   stand / sit        a character gets up or sits back down
 *   walkTo            a character walks to a place
 *   pointAt           a character points at somebody
 *   react             a character reacts to what just happened
 *   lookAt            a character turns their head
 *   phoneUp           a character takes their laptop to hand
 *   cameraFocus       the first-person view turns to watch something
 *
 * Every cinematic is registered against the card it belongs to, so the same
 * card always plays the same show, and the show is the same for everybody
 * because it is driven by the server's own events.
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
/* The cinematics                                                       */
/* ------------------------------------------------------------------ */

/**
 * STEAL.
 *
 * The attacker stands up, walks round to the target, takes a card out of
 * their hand and carries it back to their seat. Which card is taken is not
 * shown: the server does not say, and the game does not let anybody see.
 */
function steal(context, event, result) {
  const actor = event.seat;
  const target = event.targetSeat;
  if (actor === undefined || target === undefined) return Promise.resolve();
  const at = seatOf(context, actor);
  const victim = seatOf(context, target);
  if (!at || !victim) return Promise.resolve();

  return stand(context, actor)
    .then(function () {
      const table = new THREE.Vector3(0, context.tableHeight, 0);
      const beside = new THREE.Vector3(
        (at.seated.x + victim.seated.x) / 2 * 1.12,
        0,
        (at.seated.z + victim.seated.z) / 2 * 1.12
      );
      return walkTo(context, actor, beside, 1.4);
    })
    .then(function () {
      lookAt(context, actor, victim.seated);
      // The card that changes hands is never named: the server does not say.
      const stolen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.13, 0.18),
        new THREE.MeshStandardMaterial({ color: 0x22355c, roughness: 0.7 })
      );
      context.scene.add(stolen);
      const from = victim.seated.clone().setY(context.tableHeight + 0.1);
      const to = at.character.group.position.clone().setY(context.tableHeight + 0.15);
      const started = performance.now();
      return new Promise(function (resolve) {
        const step = function () {
          const t = Math.min(1, (performance.now() - started) / 700);
          stolen.position.lerpVectors(from, to, t);
          stolen.position.y += Math.sin(t * Math.PI) * 0.2;
          stolen.rotation.y = t * Math.PI * 2;
          if (t < 1) requestAnimationFrame(step);
          else { context.scene.remove(stolen); resolve(); }
        };
        step();
      });
    })
    .then(function () {
      return react(context, target, 'shoved');
    })
    .then(function () {
      return walkTo(context, actor, at.standing, 1.2);
    })
    .then(function () {
      return sit(context, actor);
    })
    .catch(function () { return null; });
}

/**
 * JUDGE.
 *
 * The officer comes in, announces the verdict, and takes the guilty player
 * to the cell. The player's laptop stays on the table where it was, and it
 * keeps hearing from the bank: they cannot read it from the cell, but it
 * still knows what is happening to them.
 */
function judge(context, event, result) {
  const guilty = event.targetSeat;
  if (guilty === undefined) return Promise.resolve();
  const at = seatOf(context, guilty);
  if (!at) return Promise.resolve();

  const cell = context.cellPoint || new THREE.Vector3(2.2, 0, -ROOM_DEPTH / 2 + 1.9);

  return stand(context, guilty)
    .then(function () {
      return cameraFocus(context, at.standing, 1.0);
    })
    .then(function () {
      // The officer's announcement: the lamps dip, and the word is on the
      // screen at the top of the table.
      return context.announce('THE JUDGE HAS SPOKEN', 2200);
    })
    .then(function () {
      return walkTo(context, guilty, cell, 2.4);
    })
    .then(function () {
      // In the cell, facing the table, free to look about.
      lookAt(context, guilty, new THREE.Vector3(0, context.tableHeight, 0));
      return context.announce('THREE ROUNDS', 2000);
    })
    .then(function () {
      return context.cameraFocus(context, new THREE.Vector3(0, context.tableHeight, 0), 1.0);
    })
    .catch(function () { return null; });
}

const ROOM_DEPTH = 6.5;

/**
 * HOSTAGE SITUATION.
 *
 * The card player becomes the criminal and takes a hostage. One of the
 * others is the officer. The reveal is the point of the card, so it is
 * played properly: the room darkens, the criminal is named, the hostage is
 * taken, and the objective appears on the laptops.
 */
function hostage(context, event, result) {
  const criminal = event.seat;
  const hostageSeat = event.targetSeat;
  if (criminal === undefined) return Promise.resolve();
  const at = seatOf(context, criminal);
  if (!at) return Promise.resolve();

  // The officer is one of the others, chosen by the server's own drawing;
  // when the event does not say, it is the next player round.
  const others = [];
  for (let i = 0; i < context.seats; i++) {
    if (i !== criminal && i !== hostageSeat) others.push(i);
  }
  const officer = others[Math.floor(Math.random() * others.length)];

  return context.announce('HOSTAGE SITUATION', 1800)
    .then(function () {
      return stand(context, criminal);
    })
    .then(function () {
      return cameraFocus(context, at.standing, 1.0);
    })
    .then(function () {
      return context.announce('YOU ARE THE CRIMINAL', 2200);
    })
    .then(function () {
      if (hostageSeat === undefined) return null;
      const victim = seatOf(context, hostageSeat);
      if (!victim) return null;
      return walkTo(context, criminal, victim.standing, 1.6);
    })
    .then(function () {
      return context.announce('THE OFFICIAL IS COMING', 1800);
    })
    .then(function () {
      if (officer === undefined) return null;
      return stand(context, officer);
    })
    .then(function () {
      // The objective is on the laptops, where the bank always is.
      return context.showObjective(
        'THE OFFICIAL MUST EARN 40,000 POINTS', 6000);
    })
    .then(function () {
      if (officer === undefined) return null;
      return sit(context, officer);
    })
    .then(function () {
      if (hostageSeat === undefined) return null;
      return sit(context, criminal);
    })
    .catch(function () { return null; });
}

/**
 * THE MIMIC.
 *
 * The character whose card was a Mimic looks at their laptop, and the video
 * plays on it. The player who was pranked sees the real thing; everybody else
 * sees the screen light up and the sound come from that side of the table.
 */
function mimic(context, event, result) {
  const victim = event.seat;
  if (victim === undefined) return Promise.resolve();
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
      // The video plays on the laptop screen. The player who was pranked gets
      // the real player, sized to the screen; everybody else gets the sound,
      // quieter the further away they are sitting.
      return context.playMimicVideo(victim, point);
    })
    .then(function () {
      return context.announce('THE CARD WAS A MIMIC', 2000);
    })
    .catch(function () { return null; });
}

/**
 * NOTHING.
 *
 * Absurdly dramatic, and then absolutely nothing happens - which is the whole
 * point of the card. The lights dim, the table is spotlit, the camera creeps
 * in, and the room goes back to normal.
 */
function nothing(context, event, result) {
  const at = seatOf(context, event.seat);
  return context.dim(0.35, 900)
    .then(function () {
      return context.cameraFocus(context, at ? at.seated : null, 2.2);
    })
    .then(function () {
      return context.announce('SOMETHING IS ABOUT TO HAPPEN', 2200);
    })
    .then(function () {
      return context.announce('...', 1200);
    })
    .then(function () {
      return context.dim(1, 700);
    })
    .then(function () {
      return context.announce('NOTHING HAPPENED', 2200);
    })
    .catch(function () { return null; });
}

/* ------------------------------------------------------------------ */
/* The registry                                                         */
/* ------------------------------------------------------------------ */

/** Every cinematic, by the card it belongs to. */
export const CINEMATICS = {
  steal: steal,
  judge: judge,
  hostage: hostage,
  mimic: mimic,
  nothing: nothing
};

/**
 * Play the cinematic for a card.
 *
 * The events are the server's own: the card that was played, who played it,
 * who it was aimed at, and what the engine said about it. The cinematic only
 * shows that; it never decides anything.
 */
export function playCinematic(cardId, context, events) {
  const cinematic = CINEMATICS[cardId];
  if (!cinematic || !context) return Promise.resolve(null);
  const event = (events || []).find(function (e) { return e.type === 'card' && e.cardId === cardId; })
    || (events || []).find(function (e) { return e.type === 'card'; })
    || { seat: 0, targetSeat: -1 };
  const result = (events || []).find(function (e) { return e.type === 'result' && e.cardId === cardId; });
  return Promise.resolve()
    .then(function () { return cinematic(context, event, result); })
    .then(function () { return true; })
    .catch(function () { return false; });
}

export { stand, sit, walkTo, lookAt, react, cameraFocus };
