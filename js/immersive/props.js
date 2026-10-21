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
import { roundedBox, turned, combined } from './geometry.js';
import { mimicPosterTexture, notepadTexture } from './textures.js';
import { ROOM } from './room.js';

/**
 * The Mimic's warning poster.
 *
 * "WATCH OUT FOR THE MIMIC" over "NOT EVERY CARD IS WHAT IT SEEMS.", with
 * the card's own artwork in the middle.
 */
export function buildPoster(scene, options) {
  const settings = Object.assign({ x: -0.1, z: -ROOM.depth / 2 + 0.06, ry: 0 }, options || {});
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

  group.position.set(settings.x, 1.62, settings.z);
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
  const settings = Object.assign({ x: -2.9, y: 0.92, z: -ROOM.depth / 2 + 0.45 }, options || {});
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

/**
 * The jail cell.
 *
 * It is built, and it is visible from the table, and nothing puts anybody in
 * it yet: the Judge card's three-round arrest is a later piece of work. What
 * is here now is the room itself - a barred cell in the corner, with a bench
 * inside it and a light above it.
 */
export function buildJailCell(scene, options) {
  const settings = Object.assign({
    x: 2.2, z: -ROOM.depth / 2 + 1.9, w: 3.2, d: 2.6, h: 2.9
  }, options || {});
  const group = new THREE.Group();

  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4a4e, roughness: 0.95, metalness: 0.02
  });
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x333336, roughness: 0.9
  });
  const ironMaterial = new THREE.MeshStandardMaterial({
    color: 0x23232a, roughness: 0.55, metalness: 0.7
  });

  const half = settings.w / 2;
  const halfD = settings.d / 2;

  // The three solid walls, so the cell is a room inside the room.
  const back = new THREE.Mesh(new THREE.BoxGeometry(settings.w, settings.h, 0.18), stoneMaterial);
  back.position.set(0, settings.h / 2, -halfD);
  back.receiveShadow = true;
  group.add(back);
  [-1, 1].forEach(function (side) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.18, settings.h, settings.d), stoneMaterial);
    wall.position.set(side * half, settings.h / 2, 0);
    wall.receiveShadow = true;
    group.add(wall);
  });
  const cellFloor = new THREE.Mesh(new THREE.PlaneGeometry(settings.w, settings.d), floorMaterial);
  cellFloor.rotation.x = -Math.PI / 2;
  cellFloor.position.y = 0.02;
  group.add(cellFloor);

  // The front: a barred gate, and a wall either side of it.
  const gateWidth = 1.5;
  const front = new THREE.Mesh(
    new THREE.BoxGeometry(settings.w - gateWidth, settings.h, 0.16),
    stoneMaterial
  );
  front.position.set(-(gateWidth / 2 + (settings.w - gateWidth) / 2), settings.h / 2, halfD);
  group.add(front);
  const bars = new THREE.Group();
  const barCount = 7;
  const barParts = [];
  for (let i = 0; i < barCount; i++) {
    barParts.push({
      geometry: new THREE.CylinderGeometry(0.022, 0.022, settings.h - 0.2, 8),
      position: new THREE.Vector3(
        -gateWidth / 2 + 0.12 + (i * (gateWidth - 0.24)) / (barCount - 1),
        (settings.h - 0.2) / 2 + 0.1,
        halfD
      )
    });
  }
  bars.add(combined(barParts, ironMaterial));
  // The cross bars, and the frame.
  [0.42, settings.h - 0.42].forEach(function (y) {
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, gateWidth, 8),
      ironMaterial
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, y, halfD);
    bars.add(rail);
  });
  group.add(bars);
  // A door in the bars, with a lock.
  const lock = new THREE.Mesh(roundedBox(0.14, 0.2, 0.08, 0.02, 0.006), ironMaterial);
  lock.position.set(gateWidth / 2 - 0.12, 1.05, halfD);
  group.add(lock);

  // A bench inside, and a lamp above it.
  const bench = new THREE.Mesh(roundedBox(1.6, 0.1, 0.4, 0.02, 0.008), stoneMaterial);
  bench.position.set(-0.4, 0.5, -halfD + 0.32);
  bench.castShadow = true;
  group.add(bench);
  const benchLeg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.28), stoneMaterial);
  benchLeg.position.set(-0.4, 0.24, -halfD + 0.32);
  group.add(benchLeg);

  const cellLight = new THREE.PointLight(0xbcd0ff, 7, 5, 2);
  cellLight.position.set(0, settings.h - 0.5, 0);
  group.add(cellLight);
  const cellBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xcfe0ff })
  );
  cellBulb.position.set(0, settings.h - 0.42, 0);
  group.add(cellBulb);
  const cellLamp = new THREE.Mesh(
    turned([[0, 0], [0.14, 0], [0.16, 0.06], [0.05, 0.12], [0.02, 0.16], [0, 0.16]], 12),
    ironMaterial
  );
  cellLamp.position.set(0, settings.h - 0.3, 0);
  group.add(cellLamp);

  group.position.set(settings.x, 0, settings.z);
  scene.add(group);
  return { group: group, light: cellLight };
}
