/* PHOENIX - the people at the table.
 *
 * Five stylised human characters, built from lathed limbs and rounded
 * bodies: a head with a face, a neck, shoulders, a shirt, arms that bend at
 * the elbow, hands with fingers, legs that bend at the knee, and shoes.
 *
 * The rig is a proper one - hips, spine, chest, neck, head, and the arms and
 * legs hanging off them - so the same model can be posed, walked or stood up
 * later without being rebuilt. Every character is a group of that rig, and
 * the animations move the joints, never the whole body.
 *
 * There is no model file to download: everything here is drawn in code, so
 * the art is one style all the way through and there is no licence to chase.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { roundedBox, turned } from './geometry.js';

/**
 * The five appearances.
 *
 * Different builds, different skin, different hair and different clothes -
 * close enough in style to look like the same game, far enough apart to tell
 * the players apart at a glance.
 */
export const CHARACTERS = [
  { id: 'ash', name: 'Ash', skin: 0xd9a173, hair: 0x2b2119, shirt: 0x35506e, accent: 0xe0b64a, build: 1.0, hairStyle: 'crop' },
  { id: 'brook', name: 'Brook', skin: 0x8d5a3b, hair: 0x1a1512, shirt: 0x6b3f5a, accent: 0x8fd6c0, build: 0.94, hairStyle: 'bun' },
  { id: 'cass', name: 'Cass', skin: 0xf0c9a4, hair: 0xc2762f, shirt: 0x3f6b52, accent: 0xffd166, build: 1.04, hairStyle: 'long' },
  { id: 'dara', name: 'Dara', skin: 0x6f452e, hair: 0x120e0b, shirt: 0x7a4a2f, accent: 0x9ad2ff, build: 0.98, hairStyle: 'curls' },
  { id: 'emery', name: 'Emery', skin: 0xc98d63, hair: 0x4a3b6b, shirt: 0x2f3a4d, accent: 0xff9f7a, build: 1.0, hairStyle: 'swept' }
];

export function characterById(id) {
  return CHARACTERS.find(function (c) { return c.id === id; }) || CHARACTERS[0];
}

function standard(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({
    color: color,
    roughness: roughness === undefined ? 0.82 : roughness,
    metalness: metalness === undefined ? 0.04 : metalness
  });
}

/** A limb: a tapered, slightly rounded length of arm or leg. */
function limb(length, topRadius, bottomRadius, material) {
  const mesh = new THREE.Mesh(
    turned([
      [0, 0], [topRadius, 0], [topRadius * 0.96, length * 0.18],
      [(topRadius + bottomRadius) / 2, length * 0.55], [bottomRadius, length * 0.9],
      [bottomRadius * 0.8, length], [0, length]
    ], 12),
    material
  );
  mesh.castShadow = true;
  return mesh;
}

/** A hand: a palm and five fingers, curled a little. */
function buildHand(skinMaterial) {
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(roundedBox(0.075, 0.026, 0.085, 0.02, 0.006), skinMaterial);
  palm.castShadow = true;
  hand.add(palm);
  // Four fingers, curled towards the palm.
  for (let f = 0; f < 4; f++) {
    const finger = new THREE.Mesh(
      turned([[0, 0], [0.009, 0], [0.009, 0.035], [0.007, 0.055], [0, 0.06]], 8),
      skinMaterial
    );
    finger.position.set(-0.026 + f * 0.017, -0.004, 0.036);
    finger.rotation.x = 1.15;
    hand.add(finger);
  }
  // The thumb, along the side.
  const thumb = new THREE.Mesh(
    turned([[0, 0], [0.011, 0], [0.01, 0.03], [0, 0.04]], 8),
    skinMaterial
  );
  thumb.position.set(-0.036, 0, 0.006);
  thumb.rotation.set(0.4, 0, 0.7);
  hand.add(thumb);
  return hand;
}

/** A shoe. */
function buildShoe(trouserMaterial) {
  const shoe = new THREE.Mesh(roundedBox(0.085, 0.055, 0.2, 0.025, 0.008), standard(0x241a12, 0.7));
  shoe.position.z = 0.045;
  shoe.castShadow = true;
  return shoe;
}

/**
 * A person, seated.
 *
 * The rig:
 *   root
 *     hips
 *       spine
 *         chest
 *           neck
 *             head
 *           shoulderL / shoulderR -> upperArm -> foreArm -> hand
 *       thighL / thighR -> shin -> foot
 *     (the fan of card backs, held in front of the chest)
 */
export function createCharacter(options) {
  const settings = Object.assign({
    look: CHARACTERS[0],
    cardBack: 0x2b3f6b,
    cardEdge: 0xd6b45a
  }, options || {});
  const look = settings.look;
  const build = look.build || 1;

  const skin = standard(look.skin, 0.74);
  const shirt = standard(look.shirt, 0.9);
  const accent = standard(look.accent, 0.5, 0.2);
  const hair = standard(look.hair, 0.92);
  const trouser = standard(0x2b3040, 0.94);
  const shoeMaterial = standard(0x241a12, 0.7);

  const root = new THREE.Group();
  const hips = new THREE.Group();
  root.add(hips);
  hips.scale.setScalar(build);

  /* ---- the spine ---- */

  const spine = new THREE.Group();
  spine.position.y = 0.52;
  hips.add(spine);

  const pelvis = new THREE.Mesh(roundedBox(0.26, 0.16, 0.19, 0.07, 0.02), trouser);
  pelvis.castShadow = true;
  hips.add(pelvis);

  const chest = new THREE.Group();
  chest.position.y = 0.08;
  spine.add(chest);

  // The torso: a rounded chest, and the shirt over it.
  const torso = new THREE.Mesh(roundedBox(0.34, 0.4, 0.21, 0.09, 0.03), shirt);
  torso.position.y = 0.17;
  torso.castShadow = true;
  chest.add(torso);
  // The shoulders, a little wider than the chest.
  const yoke = new THREE.Mesh(roundedBox(0.42, 0.13, 0.2, 0.06, 0.025), shirt);
  yoke.position.y = 0.33;
  yoke.castShadow = true;
  chest.add(yoke);
  // A collar, and a placket down the front.
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 14), accent);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.395;
  chest.add(collar);
  const placket = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.01), accent);
  placket.position.set(0, 0.18, 0.106);
  chest.add(placket);

  /* ---- the head ---- */

  const neck = new THREE.Group();
  neck.position.y = 0.4;
  chest.add(neck);
  const neckMesh = new THREE.Mesh(
    turned([[0, 0], [0.048, 0], [0.045, 0.05], [0.05, 0.08], [0, 0.08]], 10),
    skin
  );
  neck.add(neckMesh);

  const head = new THREE.Group();
  head.position.y = 0.09;
  neck.add(head);
  // The skull, and a jaw, so the head is not a ball.
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.098, 12, 10), skin);
  skull.scale.set(1, 1.12, 1.02);
  skull.castShadow = true;
  head.add(skull);
  const jaw = new THREE.Mesh(roundedBox(0.13, 0.09, 0.12, 0.045, 0.02), skin);
  jaw.position.set(0, -0.06, 0.012);
  head.add(jaw);
  // The nose.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.019, 0.05, 6), skin);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.012, 0.096);
  head.add(nose);
  // The ears.
  [-1, 1].forEach(function (side) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), skin);
    ear.scale.set(0.5, 1, 0.8);
    ear.position.set(side * 0.095, -0.005, 0);
    head.add(ear);
  });
  // The eyes: white, a pupil, and a brow.
  const eyes = [];
  [-1, 1].forEach(function (side) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), standard(0xf2ece2, 0.5));
    white.position.set(side * 0.036, 0.018, 0.083);
    white.scale.set(1, 0.78, 0.7);
    head.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 5), standard(0x1a1512, 0.35));
    pupil.position.set(side * 0.036, 0.018, 0.095);
    head.add(pupil);
    eyes.push(white, pupil);
    const brow = new THREE.Mesh(roundedBox(0.045, 0.009, 0.012, 0.004, 0.002), hair);
    brow.position.set(side * 0.038, 0.048, 0.09);
    brow.rotation.z = side * 0.12;
    head.add(brow);
  });
  // The mouth.
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.021, 0.005, 5, 10, Math.PI),
    standard(0x8a4f46, 0.65)
  );
  mouth.rotation.set(Math.PI, 0, 0);
  mouth.position.set(0, -0.05, 0.082);
  head.add(mouth);

  // The hair, in five styles.
  if (look.hairStyle === 'long') {
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), hair);
    back.scale.set(1, 1.15, 0.95);
    back.position.set(0, -0.03, -0.018);
    head.add(back);
  } else if (look.hairStyle === 'bun') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.104, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    cap.position.y = 0.012;
    head.add(cap);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), hair);
    bun.position.set(0, 0.05, -0.105);
    head.add(bun);
  } else if (look.hairStyle === 'curls') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const curl = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), hair);
      curl.position.set(Math.cos(a) * 0.07, 0.055 + Math.sin(a * 2) * 0.02, Math.sin(a) * 0.07 - 0.01);
      head.add(curl);
    }
  } else {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.104, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    cap.position.y = 0.012;
    cap.scale.set(1, 1.04, 1.02);
    head.add(cap);
    if (look.hairStyle === 'swept') {
      const sweep = new THREE.Mesh(roundedBox(0.14, 0.03, 0.09, 0.02, 0.008), hair);
      sweep.position.set(0.02, 0.055, 0.05);
      sweep.rotation.set(-0.5, 0, 0.25);
      head.add(sweep);
    } else {
      const fringe = new THREE.Mesh(roundedBox(0.15, 0.035, 0.05, 0.015, 0.006), hair);
      fringe.position.set(0, 0.055, 0.075);
      fringe.rotation.x = 0.25;
      head.add(fringe);
    }
  }

  /* ---- the arms ---- */

  const arms = [];
  [-1, 1].forEach(function (side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.19, 0.3, 0);
    chest.add(shoulder);

    const upper = limb(0.24, 0.048, 0.04, shirt);
    upper.rotation.x = Math.PI;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.24, 0);
    shoulder.add(elbow);

    const fore = limb(0.22, 0.04, 0.032, skin);
    fore.rotation.x = Math.PI;
    elbow.add(fore);

    const hand = buildHand(skin);
    hand.position.set(0, -0.22, 0);
    hand.rotation.x = 0.2;
    elbow.add(hand);

    arms.push({ shoulder: shoulder, elbow: elbow, hand: hand, side: side });
  });

  /* ---- the legs ---- */

  const legs = [];
  [-1, 1].forEach(function (side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, 0.46, 0.02);
    hips.add(hip);

    const thigh = limb(0.34, 0.075, 0.06, trouser);
    thigh.rotation.x = Math.PI / 2;
    thigh.position.z = 0.02;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, 0, 0.34);
    hip.add(knee);

    const shin = limb(0.34, 0.058, 0.045, trouser);
    shin.rotation.x = Math.PI;
    knee.add(shin);

    const foot = new THREE.Group();
    foot.position.set(0, -0.34, 0);
    knee.add(foot);
    const shoe = buildShoe(shoeMaterial);
    foot.add(shoe);

    legs.push({ hip: hip, knee: knee, foot: foot });
  });

  /* ---- the fan of card backs they are holding ---- */

  const cards = new THREE.Group();
  cards.position.set(0, 0.2, 0.24);
  chest.add(cards);
  const backMaterial = standard(settings.cardBack, 0.72);
  const edgeMaterial = standard(settings.cardEdge, 0.45, 0.35);
  const fan = [];
  for (let i = 0; i < 7; i++) {
    const card = new THREE.Group();
    const face = new THREE.Mesh(roundedBox(0.115, 0.008, 0.16, 0.006, 0.002), backMaterial);
    face.castShadow = true;
    card.add(face);
    const edge = new THREE.Mesh(roundedBox(0.118, 0.004, 0.163, 0.005, 0.002), edgeMaterial);
    edge.position.y = -0.005;
    card.add(edge);
    card.position.set((i - 3) * 0.011, 0.008 + i * 0.004, -i * 0.005);
    card.rotation.z = (i - 3) * 0.03;
    cards.add(card);
    fan.push(card);
  }

  return {
    root: root,
    hips: hips,
    spine: spine,
    chest: chest,
    neck: neck,
    head: head,
    arms: arms,
    legs: legs,
    cards: cards,
    fan: fan,
    eyes: eyes,
    look: look,
    // The animation clock. Reduced motion simply never advances it.
    phase: Math.random() * Math.PI * 2,
    blinkTimer: 1 + Math.random() * 4,
    blinking: 0
  };
}

/**
 * The idle animation: breathing, a slow sway, the occasional look around and
 * a blink now and then.
 *
 * `reduced` turns all of it off, which is what the reduced-motion setting
 * does: the character still sits there, and simply stops moving.
 */
export function animateCharacter(character, time, delta, reduced) {
  if (!character) return;
  const phase = character.phase;
  if (reduced) {
    character.spine.rotation.x = 0.06;
    character.chest.rotation.set(0, 0, 0);
    character.head.rotation.set(0, 0, 0);
    character.arms.forEach(function (arm) {
      arm.shoulder.rotation.set(0, 0, 0);
      arm.elbow.rotation.set(0, 0, 0);
    });
    return;
  }

  // Breathing: a small rise and fall of the chest.
  const breathe = Math.sin(time * 1.05 + phase) * 0.011;
  character.spine.position.y = 0.52 + breathe;
  character.spine.rotation.x = 0.06 + Math.sin(time * 0.7 + phase) * 0.01;
  character.chest.rotation.z = Math.sin(time * 0.43 + phase * 1.7) * 0.018;
  character.head.rotation.y = Math.sin(time * 0.31 + phase * 2.3) * 0.14;

  // A blink: the eyes are squashed for a moment.
  character.blinkTimer -= delta;
  if (character.blinkTimer <= 0) {
    character.blinkTimer = 2.4 + Math.random() * 4.5;
    character.blinking = 0.13;
  }
  if (character.blinking > 0) {
    character.blinking -= delta;
    const squash = 0.12;
    (character.eyes || []).forEach(function (eye) {
      eye.scale.y = squash;
    });
  } else {
    (character.eyes || []).forEach(function (eye) {
      eye.scale.y = 1;
    });
  }
}

/**
 * The drawing animation: the right hand reaches down out of frame, comes
 * back with a card, and the card joins the fan.
 */
export function animateDraw(character, progress) {
  if (!character) return;
  const arm = character.arms[1];
  const t = Math.max(0, Math.min(1, progress));
  const reach = Math.sin(t * Math.PI);
  arm.shoulder.rotation.x = -reach * 0.45;
  arm.elbow.rotation.x = reach * 0.35;
}

/**
 * The playing animation: the hand lifts a card off the fan, reaches forward,
 * and lays it on the table.
 */
export function animatePlay(character, progress) {
  if (!character) return;
  const arm = character.arms[0];
  const t = Math.max(0, Math.min(1, progress));
  const reach = Math.sin(t * Math.PI);
  arm.shoulder.rotation.x = -reach * 0.75;
  arm.elbow.rotation.x = reach * 0.45;
}
