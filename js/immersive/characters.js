/* PHOENIX - the stylised characters.
 *
 * Five distinct placeholder people, built out of primitives: a body, a head,
 * arms, legs, and a fan of card backs they are holding. There is no model to
 * download and no licence to chase - and when finished character assets
 * arrive, this file is the only thing that has to change.
 *
 * Every character is a GROUP, so the same rig serves the seated players round
 * the table and the first-person arms in front of the camera.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';

/** The five places at the table, with the colour and the build of each. */
export const CHARACTERS = [
  { id: 'ash', name: 'Ash', skin: 0xd9a173, hair: 0x2b2119, shirt: 0x35506e, accent: 0xe0b64a, build: 1.0 },
  { id: 'brook', name: 'Brook', skin: 0x8d5a3b, hair: 0x1a1512, shirt: 0x6b3f5a, accent: 0x8fd6c0, build: 0.94 },
  { id: 'cass', name: 'Cass', skin: 0xf0c9a4, hair: 0xc2762f, shirt: 0x3f6b52, accent: 0xffd166, build: 1.04 },
  { id: 'dara', name: 'Dara', skin: 0x6f452e, hair: 0x120e0b, shirt: 0x7a4a2f, accent: 0x9ad2ff, build: 0.98 },
  { id: 'emery', name: 'Emery', skin: 0xc98d63, hair: 0x4a3b6b, shirt: 0x2f3a4d, accent: 0xff9f7a, build: 1.0 }
];

export function characterById(id) {
  return CHARACTERS.find(function (c) { return c.id === id; }) || CHARACTERS[0];
}

function standard(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({
    color: color,
    roughness: roughness === undefined ? 0.85 : roughness,
    metalness: metalness === undefined ? 0.04 : metalness
  });
}

/**
 * A placeholder person, seated.
 *
 * The rig is:
 *   root
 *     hips
 *       torso
 *         head
 *         armLeft / armRight   (the forearms reach forward to hold cards)
 *       legLeft / legRight     (thighs forward, shins down)
 *     cards                   (the fan of card backs)
 *
 * The animation functions move the LIMBS, never the root, so a character can
 * be placed anywhere in the room and still breathe in place.
 */
export function createCharacter(options) {
  const settings = Object.assign({
    look: CHARACTERS[0],
    cardBack: 0x2b3f6b,
    cardEdge: 0xd6b45a
  }, options || {});
  const look = settings.look;

  const skin = standard(look.skin, 0.78);
  const shirt = standard(look.shirt, 0.92);
  const accent = standard(look.accent, 0.55, 0.25);
  const hair = standard(look.hair, 0.95);
  const trouser = standard(0x2b3040, 0.95);

  const root = new THREE.Group();
  const hips = new THREE.Group();
  root.add(hips);
  // The eyes are kept so the blink can squash them.
  const characterEyes = [];

  const scale = look.build || 1;
  hips.scale.setScalar(scale);

  // The seat of the body: the hips sit on the chair.
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.1, 4, 10), trouser);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1, 0.85);
  pelvis.position.y = 0.53;
  pelvis.castShadow = true;
  hips.add(pelvis);

  // The torso, leaning very slightly forward: somebody playing cards.
  const torso = new THREE.Group();
  torso.position.y = 0.55;
  hips.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 12), shirt);
  chest.position.y = 0.24;
  chest.scale.set(1.05, 1, 0.82);
  chest.castShadow = true;
  torso.add(chest);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 14), accent);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.42;
  torso.add(collar);

  // The head, with a nose so the facing direction reads at a glance.
  const head = new THREE.Group();
  head.position.y = 0.52;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.112, 14, 12), skin);
  skull.scale.set(1, 1.1, 0.94);
  skull.castShadow = true;
  head.add(skull);
  // The hair is a cap that sits on the back of the head, so the face reads.
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.118, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.48), hair);
  hairCap.position.set(0, 0.014, -0.012);
  hairCap.scale.set(1, 1.04, 1);
  head.add(hairCap);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.062, 6), skin);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.008, 0.108);
  head.add(nose);
  const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), standard(0x14100c, 0.4));
  eyeLeft.position.set(-0.042, 0.022, 0.094);
  head.add(eyeLeft);
  const eyeRight = eyeLeft.clone();
  eyeRight.position.x = 0.042;
  head.add(eyeRight);
  // A mouth, so the face has a front.
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.006, 5, 10, Math.PI),
    standard(0x8a5a4a, 0.7));
  mouth.rotation.set(Math.PI, 0, 0);
  mouth.position.set(0, -0.048, 0.094);
  head.add(mouth);
  characterEyes.push(eyeLeft, eyeRight);

  // The arms: shoulders, upper arms down and forward, forearms out to the
  // cards. A simple elbow is enough for a placeholder.
  const arms = [];
  [-1, 1].forEach(function (side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.21, 0.36, 0);
    torso.add(shoulder);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), shirt);
    upper.position.set(0, -0.12, 0.02);
    upper.rotation.x = -0.55;
    upper.castShadow = true;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.23, 0.11);
    shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.2, 4, 8), skin);
    fore.position.set(0, -0.09, 0.02);
    fore.rotation.x = -1.15;
    fore.castShadow = true;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), skin);
    hand.position.set(0, -0.19, 0.08);
    elbow.add(hand);
    arms.push({ shoulder: shoulder, elbow: elbow, hand: hand, side: side });
  });

  // The legs: thighs forward, shins down to the floor.
  const legs = [];
  [-1, 1].forEach(function (side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0.5, 0.02);
    hips.add(hip);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 4, 8), trouser);
    thigh.rotation.x = Math.PI / 2 - 0.12;
    thigh.position.set(0, -0.03, 0.14);
    thigh.castShadow = true;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.set(0, -0.07, 0.26);
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.28, 4, 8), trouser);
    shin.position.set(0, -0.17, 0.02);
    shin.castShadow = true;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), standard(0x241a12, 0.8));
    foot.position.set(0, -0.33, 0.05);
    knee.add(foot);
    legs.push({ hip: hip, knee: knee });
  });

  // The fan of card backs they are holding. Opponents never see a face.
  const cards = new THREE.Group();
  cards.position.set(0, 0.66, 0.3);
  torso.add(cards);
  const backMaterial = standard(settings.cardBack, 0.72);
  const edgeMaterial = standard(settings.cardEdge, 0.45, 0.35);
  const fan = [];
  for (let i = 0; i < 7; i++) {
    const card = new THREE.Group();
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.008, 0.185), backMaterial);
    face.castShadow = true;
    card.add(face);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.134, 0.004, 0.189), edgeMaterial);
    edge.position.y = -0.006;
    card.add(edge);
    card.position.set((i - 3) * 0.012, 0.01 + i * 0.004, -i * 0.006);
    card.rotation.z = (i - 3) * 0.035;
    cards.add(card);
    fan.push(card);
  }

  return {
    root: root,
    hips: hips,
    torso: torso,
    head: head,
    arms: arms,
    legs: legs,
    cards: cards,
    fan: fan,
    eyes: characterEyes,
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
    character.torso.rotation.x = 0.06;
    character.head.rotation.set(0, 0, 0);
    character.arms.forEach(function (arm) {
      arm.shoulder.rotation.set(0, 0, 0);
    });
    return;
  }

  // Breathing: a small rise and fall of the chest.
  const breathe = Math.sin(time * 1.1 + phase) * 0.012;
  character.torso.position.y = 0.55 + breathe;
  character.torso.rotation.x = 0.06 + Math.sin(time * 0.7 + phase) * 0.012;
  character.torso.rotation.z = Math.sin(time * 0.43 + phase * 1.7) * 0.02;

  // The head: mostly still, with a slow look to one side now and then.
  const look = Math.sin(time * 0.31 + phase * 2.3);
  character.head.rotation.y = Math.abs(look) > 0.86 ? look * 0.5 : look * 0.12;
  character.head.rotation.x = Math.sin(time * 0.53 + phase) * 0.05;

  // A blink: the eyes are squashed for a moment.
  character.blinkTimer -= delta;
  if (character.blinkTimer <= 0) {
    character.blinkTimer = 2.4 + Math.random() * 4.5;
    character.blinking = 0.12;
  }
  if (character.blinking > 0) {
    character.blinking -= delta;
    const squash = 0.25;
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
  arm.shoulder.rotation.x = -reach * 0.5;
  arm.elbow.rotation.x = reach * 0.4;
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
  arm.shoulder.rotation.x = -reach * 0.85;
  arm.elbow.rotation.x = reach * 0.5;
}
