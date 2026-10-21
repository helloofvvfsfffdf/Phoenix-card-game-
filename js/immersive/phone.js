/* PHOENIX - the PHOENIX Bank phone.
 *
 * One phone on an angled stand in front of every player, showing that
 * player's balance in PHOENIX points. It is the game's own fictional
 * currency: there is no money here and nothing is for sale.
 *
 * The screen is a canvas that is redrawn when the balance changes, so the
 * positive and negative notifications really happen rather than being
 * painted on. The same screen is what the Mimic's phone cinematic will
 * use later: it is already a live, updatable surface.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { roundedBox } from './geometry.js';
import { createBankScreen } from './textures.js';

const SCREEN_WIDTH = 0.17;
const SCREEN_HEIGHT = 0.096;

/**
 * A phone on its stand.
 *
 * The stand tips the screen up towards the player, so it can be read from
 * where they are sitting.
 */
export function createPhone(options) {
  const settings = Object.assign({ bank: null, stand: true }, options || {});
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x14161c, roughness: 0.35, metalness: 0.55
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9963f, roughness: 0.3, metalness: 0.85
  });

  // The stand: a wedge of dark metal, tipped back.
  if (settings.stand) {
    const stand = new THREE.Mesh(
      roundedBox(0.1, 0.012, 0.075, 0.008, 0.003),
      bodyMaterial
    );
    stand.position.set(0, 0.006, 0.012);
    stand.rotation.x = -0.32;
    group.add(stand);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.008), trimMaterial);
    lip.position.set(0, 0.016, -0.028);
    lip.rotation.x = -0.32;
    group.add(lip);
  }

  // The phone itself, lying on the stand, tipped up towards the player.
  // The screen is on the top face, and it leans towards the phone's own
  // front, so it faces the person who owns it.
  const phone = new THREE.Group();
  phone.position.set(0, 0.022, 0.006);
  phone.rotation.x = 0.32;
  group.add(phone);

  // The body is thin, and the screen sits ON it: a bevelled box is taller
  // than it looks, and a screen buried inside the body is a black slab.
  const body = new THREE.Mesh(roundedBox(0.2, 0.009, 0.115, 0.006, 0.0015), bodyMaterial);
  body.castShadow = true;
  phone.add(body);
  const rim = new THREE.Mesh(roundedBox(0.204, 0.004, 0.119, 0.008, 0.001), trimMaterial);
  rim.position.y = -0.0025;
  phone.add(rim);

  // The screen.
  const bank = settings.bank || createBankScreen();
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT),
    new THREE.MeshBasicMaterial({ map: bank.texture, toneMapped: false })
  );
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(0, 0.0078, 0.001);
  phone.add(screen);
  // The glass over it, and the speaker slot.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN_WIDTH + 0.004, SCREEN_HEIGHT + 0.004),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.08, metalness: 0.0,
      transparent: true, opacity: 0.12
    })
  );
  glass.rotation.x = -Math.PI / 2;
  glass.position.set(0, 0.0086, 0.001);
  phone.add(glass);
  const speaker = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.003, 0.003),
    bodyMaterial
  );
  speaker.position.set(0, 0.0072, -0.049);
  phone.add(speaker);

  return { group: group, phone: phone, screen: screen, bank: bank };
}

/**
 * A phone that belongs to the player looking at it.
 *
 * It sits at the bottom left of the view, tipped up, and never covers the
 * cards: the hand is in the middle, the phone is out of the way of it.
 */
export function createFirstPersonPhone(camera, options) {
  const settings = Object.assign({ bank: null }, options || {});
  // No stand for this one: the player's own phone is held up, not propped on
  // the table, so the screen can be turned to face them.
  const phone = createPhone({ bank: settings.bank, stand: false });
  // On a narrow screen the phone comes in towards the middle, so it never
  // falls off the side of the view.
  const aspect = camera.aspect || 1.6;
  const side = Math.min(0.225, aspect * 0.15);
  phone.group.position.set(-side, -0.2, -0.42);
  // The screen is turned to face the player, and the whole thing is held at
  // an angle, the way a phone is held when somebody is reading it.
  // Held up, the way somebody reads a phone: the screen turned towards
  // the face rather than lying flat.
  phone.phone.rotation.x = 0.62;
  phone.group.rotation.set(0.24, 0.18, 0.1);
  phone.group.scale.setScalar(1.0);
  camera.add(phone.group);
  return phone;
}
