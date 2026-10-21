/* PHOENIX - the laptops.
 *
 * Every player has an open laptop resting on the table in front of them,
 * angled so they can read it, and low enough not to hide the table or the
 * cards. The screen is the PHOENIX Bank: the player's own balance, the
 * notifications when it changes, and the way out of the match.
 *
 * The laptop is the phone's job with a better shape, so everything the phone
 * did still happens here: the balance, the notifications, the Leave Match
 * button, and the screen the Mimic's video plays on.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { roundedBox, turned } from './geometry.js';
import { createBankScreen } from './textures.js';

const SCREEN_WIDTH = 0.29;
const SCREEN_HEIGHT = 0.163;

/**
 * One laptop, open.
 *
 * The lid leans back a little, the way a laptop on a table does, so the
 * screen faces the person sitting behind it.
 */
export function createLaptop(options) {
  const settings = Object.assign({ bank: null, angle: 0 }, options || {});
  const group = new THREE.Group();

  const shell = new THREE.MeshStandardMaterial({
    color: 0x24262c, roughness: 0.42, metalness: 0.55
  });
  const bezel = new THREE.MeshStandardMaterial({
    color: 0x0d0e11, roughness: 0.5, metalness: 0.2
  });
  const keyMaterial = new THREE.MeshStandardMaterial({
    color: 0x35383f, roughness: 0.7, metalness: 0.1
  });

  /* ---- the base: the part that lies on the table ---- */

  const base = new THREE.Mesh(roundedBox(0.33, 0.014, 0.23, 0.008, 0.003), shell);
  base.position.y = 0.007;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // The keyboard: a slightly darker panel sunk into the base.
  const keyboard = new THREE.Mesh(roundedBox(0.27, 0.004, 0.11, 0.004, 0.0015), keyMaterial);
  keyboard.position.set(0, 0.0145, -0.03);
  group.add(keyboard);

  // The trackpad, at the front of the base.
  const trackpad = new THREE.Mesh(roundedBox(0.1, 0.003, 0.06, 0.004, 0.001), keyMaterial);
  trackpad.position.set(0, 0.0145, 0.06);
  group.add(trackpad);

  // The hinge, at the back.
  const hinge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.3, 10), shell);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, 0.014, -0.108);
  group.add(hinge);

  /* ---- the lid ---- */

  // The lid leans back: the screen ends up facing the person sitting behind
  // the laptop, and the top of it stays below their eye line.
  const lid = new THREE.Group();
  lid.position.set(0, 0.016, -0.108);
  lid.rotation.x = 0.26;
  group.add(lid);

  const back = new THREE.Mesh(roundedBox(0.33, 0.205, 0.008, 0.008, 0.003), shell);
  back.position.set(0, 0.1, -0.004);
  back.castShadow = true;
  lid.add(back);

  const frame = new THREE.Mesh(roundedBox(0.315, 0.19, 0.004, 0.005, 0.002), bezel);
  frame.position.set(0, 0.1, 0.001);
  lid.add(frame);

  // The screen itself: always lit, so it can be read in a dim room.
  const bank = settings.bank || createBankScreen();
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT),
    new THREE.MeshBasicMaterial({ map: bank.texture, toneMapped: false })
  );
  screen.position.set(0, 0.1, 0.0035);
  lid.add(screen);

  // The glass over the screen, and the camera in the bezel.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN_WIDTH + 0.006, SCREEN_HEIGHT + 0.006),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.06, metalness: 0,
      transparent: true, opacity: 0.08
    })
  );
  glass.position.set(0, 0.1, 0.0045);
  lid.add(glass);
  const camera = new THREE.Mesh(
    new THREE.SphereGeometry(0.004, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x1a1c22 })
  );
  camera.position.set(0, 0.196, 0.004);
  lid.add(camera);

  group.rotation.y = settings.angle || 0;

  return {
    group: group,
    lid: lid,
    screen: screen,
    bank: bank,
    /** The place the screen is, in the room, so the video can be put on it. */
    screenWorldPosition: function (out) {
      return screen.getWorldPosition(out || new THREE.Vector3());
    }
  };
}

/**
 * A laptop for every seat.
 *
 * Each one stands on the table in front of its owner, turned to face them,
 * and far enough in from the edge that the middle of the table is clear.
 */
export function createTableLaptops(scene, options) {
  const settings = Object.assign({
    seats: 6,
    radius: 1.16,
    tableHeight: 0.78,
    skipSeat: -1,
    y: 0
  }, options || {});
  const laptops = [];
  for (let i = 0; i < settings.seats; i++) {
    if (i === settings.skipSeat) continue;
    const angle = (i / settings.seats) * Math.PI * 2;
    const laptop = createLaptop({});
    laptop.group.position.set(
      Math.sin(angle) * settings.radius,
      settings.tableHeight + settings.y,
      Math.cos(angle) * settings.radius
    );
    // The screen faces the seat: the laptop's own +Z points outwards, towards
    // the person sitting behind it, so turning it by the seat's angle is what
    // puts the screen in front of its owner.
    laptop.group.rotation.y = angle;
    scene.add(laptop.group);
    laptops.push({ laptop: laptop, seat: i, angle: angle });
  }
  return laptops;
}
