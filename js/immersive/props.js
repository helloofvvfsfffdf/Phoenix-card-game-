/* PHOENIX - the things in the room that tell you where you are.
 *
 * The Mimic's warning poster, the developer's notepad, and the jail cell
 * that the Judge card will one day put players in.
 *
 * The notepad is a joke written inside a game. Nothing here introduces
 * payments or advertisements: the poster and the notepad are pictures on a
 * wall and a sheet of paper on a sideboard.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { roundedBox, turned } from './geometry.js';
import { mimicPosterTexture, notepadTexture } from './textures.js';

/**
 * The Mimic's warning poster.
 *
 * "WATCH OUT FOR THE MIMIC" over "NOT EVERY CARD IS WHAT IT SEEMS.", with
 * the card's own artwork in the middle.
 */
export function buildPoster(scene, options) {
  const settings = Object.assign({ x: -0.1, z: -4.94, ry: 0 }, options || {});
  const group = new THREE.Group();

  const texture = mimicPosterTexture();
  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.73),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 })
  );
  poster.position.z = 0.012;
  group.add(poster);
  // A thin frame, and four drawing pins.
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2118, roughness: 0.8
  });
  [[0, 0.375, 0.54, 0.02], [0, -0.375, 0.54, 0.02],
    [-0.265, 0, 0.02, 0.77], [0.265, 0, 0.02, 0.77]].forEach(function (part) {
    const piece = new THREE.Mesh(new THREE.BoxGeometry(part[2], part[3], 0.014), frameMaterial);
    piece.position.set(part[0], part[1], 0.004);
    group.add(piece);
  });
  const pinMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9963f, roughness: 0.3, metalness: 0.8
  });
  [[-0.22, 0.34], [0.22, 0.34], [-0.22, -0.34], [0.22, -0.34]].forEach(function (at) {
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), pinMaterial);
    pin.position.set(at[0], at[1], 0.018);
    group.add(pin);
  });

  group.position.set(settings.x, 1.95, settings.z);
  group.rotation.y = settings.ry;
  scene.add(group);
  return group;
}

/**
 * The developer's notepad.
 *
 * It lies on the sideboard, on the leather blotter, at a slight angle, as
 * if somebody had put it down and gone back to the table.
 */
export function buildNotepad(scene, options) {
  const settings = Object.assign({ x: -2.9, y: 0.92, z: -4.55 }, options || {});
  const group = new THREE.Group();

  // The pad itself, with a few pages under the top one.
  const pageMaterial = new THREE.MeshStandardMaterial({ color: 0xf2ecd8, roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const page = new THREE.Mesh(roundedBox(0.3, 0.004, 0.38, 0.004, 0.001), pageMaterial);
    page.position.set(i * 0.004, i * 0.004, i * 0.003);
    page.rotation.y = i * 0.01;
    group.add(page);
  }
  // The top sheet, with the list on it.
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(0.29, 0.37),
    new THREE.MeshStandardMaterial({ map: notepadTexture(), roughness: 0.95 })
  );
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(0.008, 0.0135, 0.003);
  group.add(sheet);
  // The pen that was left on it.
  const pen = new THREE.Mesh(
    turned([[0, 0], [0.005, 0.004], [0.005, 0.1], [0.004, 0.12], [0, 0.125]], 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.4, metalness: 0.3 })
  );
  pen.rotation.set(Math.PI / 2, 0, 0.5);
  pen.position.set(0.13, 0.018, 0.05);
  group.add(pen);

  group.position.set(settings.x, settings.y, settings.z);
  group.rotation.y = 0.16;
  scene.add(group);
  return group;
}


