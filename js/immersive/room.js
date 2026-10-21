/* PHOENIX - the card room.
 *
 * A room that was designed rather than assembled: oak boards underfoot, a
 * papered wall with a dado and a picture rail, beams overhead, a panelled
 * door, two tall windows with the night behind them, a fireplace with a
 * fire in it, and a card table with a turned pedestal at the middle of it.
 *
 * Every surface is painted at run time on a canvas (see textures.js) and
 * every turned part is a real lathe profile, so nothing here looks like a
 * box or a cylinder.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { roundedBox, turned, frameGeometry, panelledDoor, moulding, contactShadow } from './geometry.js';
import {
  floorboardTexture, wallpaperTexture, woodTexture, leatherTexture,
  plasterTexture, rugTexture, pictureTexture, nightSkyTexture
} from './textures.js';

export const ROOM = {
  width: 11,
  depth: 13,
  height: 3.5,
  tableRadius: 1.55,
  tableHeight: 0.78
};

const WOOD_DARK = { light: '#4a3320', dark: 'rgba(28, 16, 8, ALPHA)' };
const WOOD_MID = { light: '#6b4a2c', dark: 'rgba(38, 22, 10, ALPHA)' };
const WOOD_WARM = { light: '#7d5632', dark: 'rgba(46, 26, 12, ALPHA)' };

function standard(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({
    color: color === undefined ? 0xffffff : color,
    roughness: roughness === undefined ? 0.85 : roughness,
    metalness: metalness === undefined ? 0.05 : metalness
  });
}

function textured(texture, roughness, metalness, color) {
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: color === undefined ? 0xffffff : color,
    roughness: roughness === undefined ? 0.85 : roughness,
    metalness: metalness === undefined ? 0.04 : metalness
  });
}

/**
 * The whole room.
 *
 * Returns the pieces the rest of the game needs: the table, the chairs, the
 * deck and the discard, the lamp, and the place each player sits.
 */
export function buildRoom(scene, options) {
  const settings = Object.assign({ seats: 6, quality: 'medium' }, options || {});
  const group = new THREE.Group();
  scene.add(group);

  const shadowTexture = contactShadow(1);
  const addShadow = function (x, z, size) {
    const blob = shadowTexture.clone();
    blob.position.set(x, 0.014, z);
    blob.scale.setScalar(size);
    group.add(blob);
  };

  /* ---- the floor ---- */

  const floorTexture = floorboardTexture(1024);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.width, ROOM.depth),
    textured(floorTexture, 0.82, 0.03, 0xffffff)
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  /* ---- the walls ---- */

  const paper = wallpaperTexture(512);
  const wallMaterial = textured(paper, 0.94, 0.02);
  const walls = [
    { x: 0, z: -ROOM.depth / 2, ry: 0 },
    { x: 0, z: ROOM.depth / 2, ry: Math.PI },
    { x: -ROOM.width / 2, z: 0, ry: Math.PI / 2 },
    { x: ROOM.width / 2, z: 0, ry: -Math.PI / 2 }
  ];
  walls.forEach(function (wall) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.width, ROOM.height),
      wallMaterial
    );
    mesh.position.set(wall.x, ROOM.height / 2, wall.z);
    mesh.rotation.y = wall.ry;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  /* ---- the ceiling and its beams ---- */

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.width, ROOM.depth),
    textured(plasterTexture(512), 0.96, 0.0, 0x8a8a8a)
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM.height;
  group.add(ceiling);

  const beamMaterial = textured(woodTexture(WOOD_DARK.light, WOOD_DARK.dark, 512), 0.9, 0.03);
  for (let i = -2; i <= 2; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROOM.width, 0.22, 0.26), beamMaterial);
    beam.position.set(0, ROOM.height - 0.12, i * 2.2);
    beam.castShadow = true;
    group.add(beam);
  }
  // The joists between them, so the ceiling is not a flat lid.
  for (let i = -5; i <= 5; i++) {
    const joist = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, ROOM.depth), beamMaterial);
    joist.position.set(i * 1.0, ROOM.height - 0.08, 0);
    group.add(joist);
  }

  /* ---- the dado, the picture rail and the skirting ---- */

  const trimMaterial = textured(woodTexture(WOOD_MID.light, WOOD_MID.dark, 512), 0.8, 0.05);
  const dadoProfile = [[0, 0], [0.06, 0], [0.06, 0.05], [0.045, 0.07], [0.045, 0.1], [0, 0.1]];
  const railProfile = [[0, 0], [0.05, 0], [0.05, 0.035], [0.03, 0.05], [0, 0.05]];
  const skirtProfile = [[0, 0], [0.05, 0], [0.05, 0.16], [0.03, 0.18], [0, 0.18]];

  walls.forEach(function (wall) {
    const span = Math.abs(wall.ry) === Math.PI / 2 ? ROOM.depth : ROOM.width;
    const along = (profile, height) => {
      const length = moulding(profile, span, 0);
      length.rotateY(Math.PI / 2);
      const mesh = new THREE.Mesh(length, trimMaterial);
      mesh.position.set(wall.x, height, wall.z);
      mesh.rotation.y = wall.ry;
      mesh.castShadow = true;
      group.add(mesh);
    };
    along(dadoProfile, 0.92);
    along(railProfile, 2.32);
    along(skirtProfile, 0);
  });

  // The panels inside the dado: a frame round each bay.
  const panelMaterial = textured(woodTexture(WOOD_MID.light, WOOD_MID.dark, 512), 0.86, 0.03);
  walls.forEach(function (wall) {
    const horizontal = Math.abs(wall.ry) === Math.PI / 2;
    const span = horizontal ? ROOM.depth : ROOM.width;
    const bays = Math.max(2, Math.round(span / 1.8));
    const bayWidth = span / bays;
    for (let b = 0; b < bays; b++) {
      const offset = -span / 2 + bayWidth * (b + 0.5);
      const panel = new THREE.Mesh(
        roundedBox(bayWidth * 0.62, 0.56, 0.04, 0.03, 0.008),
        panelMaterial
      );
      const x = horizontal ? wall.x : wall.x + offset * Math.cos(wall.ry);
      const z = horizontal ? wall.z + offset : wall.z;
      panel.position.set(x + (horizontal ? 0.03 * Math.sign(wall.x) : 0), 0.5, z + (horizontal ? offset * 0 : 0));
      if (horizontal) panel.position.x = wall.x + 0.03 * Math.sign(wall.x || 1);
      panel.rotation.y = wall.ry;
      panel.castShadow = true;
      group.add(panel);
    }
  });

  /* ---- the door ---- */

  const doorGroup = new THREE.Group();
  const doorMaterial = textured(woodTexture(WOOD_WARM.light, WOOD_WARM.dark, 512), 0.78, 0.04);
  const door = panelledDoor(1.05, 2.25, 2);
  door.traverse(function (child) { if (child.isMesh) child.material = doorMaterial; });
  door.position.set(-1.9, 1.125, 0);
  doorGroup.add(door);
  // The frame round it.
  const casing = new THREE.Group();
  [[0, 1.2, 0.12, 2.4], [-0.6, 1.12, 0.12, 0.16], [0.6, 1.12, 0.12, 0.16]].forEach(function (part) {
    const piece = new THREE.Mesh(new THREE.BoxGeometry(part[2], part[3], 0.14), trimMaterial);
    piece.position.set(part[0], part[1], 0.02);
    casing.add(piece);
  });
  doorGroup.add(casing);
  // The handle.
  const handle = new THREE.Mesh(
    turned([[0, 0], [0.028, 0], [0.028, 0.05], [0.02, 0.07], [0.035, 0.1], [0.02, 0.12], [0, 0.12]], 12),
    standard(0xc9963f, 0.32, 0.85)
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.42, 1.05, 0.09);
  doorGroup.add(handle);
  doorGroup.position.z = -ROOM.depth / 2 + 0.08;
  group.add(doorGroup);
  // The dark hallway beyond it.
  const beyond = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 2.25),
    new THREE.MeshBasicMaterial({ color: 0x05070c })
  );
  beyond.position.set(-1.9, 1.125, -ROOM.depth / 2 + 0.04);
  group.add(beyond);

  /* ---- the windows ---- */

  const sky = nightSkyTexture(512);
  const windows = [];
  [-1.9, 1.9].forEach(function (z) {
    const windowGroup = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 2.0),
      new THREE.MeshBasicMaterial({ map: sky, color: 0x9fb6d8 })
    );
    windowGroup.add(glass);
    // The frame and its mullions.
    const frameParts = [
      [0, 1.02, 1.7, 0.12], [0, -1.02, 1.7, 0.12],
      [-0.85, 0, 0.12, 2.16], [0.85, 0, 0.12, 2.16],
      [0, 0.25, 0.05, 2.0], [0, 0, 1.5, 0.05]
    ];
    frameParts.forEach(function (part) {
      const piece = new THREE.Mesh(new THREE.BoxGeometry(part[2], part[3], 0.1), trimMaterial);
      piece.position.set(part[0], part[1], 0.03);
      piece.castShadow = true;
      windowGroup.add(piece);
    });
    // The sill.
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.26), trimMaterial);
    sill.position.set(0, -1.08, 0.12);
    windowGroup.add(sill);
    // The curtains.
    const curtainMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a1a26, roughness: 0.95, side: THREE.DoubleSide
    });
    [-0.95, 0.95].forEach(function (x) {
      const curtain = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.2, 2.5, 10, 1, true, 0, Math.PI * 1.4),
        curtainMaterial
      );
      curtain.position.set(x, 0.1, 0.18);
      curtain.rotation.z = x < 0 ? -0.1 : 0.1;
      curtain.castShadow = true;
      windowGroup.add(curtain);
    });
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 8), standard(0xc9963f, 0.35, 0.8));
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 1.28, 0.2);
    windowGroup.add(rail);

    windowGroup.position.set(ROOM.width / 2 - 0.08, 1.55, z);
    windowGroup.rotation.y = -Math.PI / 2;
    group.add(windowGroup);
    windows.push(windowGroup);

    // The moonlight each window lets in.
    const moon = new THREE.SpotLight(0x9dc0ff, 60, 14, Math.PI * 0.34, 0.6, 1.2);
    moon.position.set(ROOM.width / 2 - 0.6, 2.4, z);
    moon.target.position.set(0.4, 0, z + (z > 0 ? -1.2 : 1.2));
    group.add(moon);
    group.add(moon.target);
  });

  /* ---- the fireplace ---- */

  const stoneMaterial = standard(0x3a3a3c, 0.96, 0.02);
  const fireplace = new THREE.Group();
  const surround = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.9, 2.3), stoneMaterial);
  surround.position.set(-0.17, 0.95, 0);
  fireplace.add(surround);
  const opening = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 1.1, 1.3),
    new THREE.MeshBasicMaterial({ color: 0x0a0604 })
  );
  opening.position.set(-0.12, 0.6, 0);
  fireplace.add(opening);
  const mantel = new THREE.Mesh(roundedBox(0.42, 0.12, 2.6, 0.03, 0.012), stoneMaterial);
  mantel.position.set(-0.1, 1.94, 0);
  mantel.castShadow = true;
  fireplace.add(mantel);
  const hearth = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 2.1), stoneMaterial);
  hearth.position.set(-0.3, 0.04, 0);
  fireplace.add(hearth);
  // The grate and the fire.
  const grate = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 6), standard(0x1a1a1c, 0.6, 0.6));
    bar.rotation.x = Math.PI / 2;
    bar.position.set(-0.2, 0.18 + i * 0.04, -0.28 + i * 0.11);
    grate.add(bar);
  }
  fireplace.add(grate);
  const fire = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8a2a })
  );
  fire.scale.set(1, 1.5, 0.6);
  fire.position.set(-0.16, 0.3, 0);
  fireplace.add(fire);
  const fireLight = new THREE.PointLight(0xff7a2a, 9, 5, 2);
  fireLight.position.set(-0.1, 0.45, 0);
  fireplace.add(fireLight);
  fireplace.position.set(-ROOM.width / 2 + 0.12, 0, -1.4);
  fireplace.rotation.y = Math.PI / 2;
  group.add(fireplace);

  /* ---- the rug ---- */

  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 48),
    textured(rugTexture(1024), 0.98, 0.0)
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.008;
  rug.receiveShadow = true;
  group.add(rug);

  /* ---- the card table ---- */

  const table = new THREE.Group();
  // The top is plain polished wood: a turned surface has no straight grain to
  // run along it, so the grain is left off and the light does the work.
  const tableTopMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a3a22, roughness: 0.42, metalness: 0.06
  });
  // The playing surface: dark green baize.
  const baize = new THREE.MeshStandardMaterial({
    color: 0x1f5b48, roughness: 0.98
  });

  // The top: a moulded edge, a baize playing area, and a thin brass line.
  const edge = new THREE.Mesh(
    turned([
      [0, 0], [ROOM.tableRadius, 0], [ROOM.tableRadius + 0.02, 0.015],
      [ROOM.tableRadius + 0.025, 0.045], [ROOM.tableRadius - 0.01, 0.07],
      [ROOM.tableRadius - 0.2, 0.075], [ROOM.tableRadius - 0.2, 0.05], [0, 0.05]
    ], 56),
    tableTopMaterial
  );
  edge.position.y = ROOM.tableHeight - 0.075;
  edge.castShadow = true;
  edge.receiveShadow = true;
  table.add(edge);
  const inlay = new THREE.Mesh(
    new THREE.CircleGeometry(ROOM.tableRadius - 0.2, 48),
    baize
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = ROOM.tableHeight - 0.024;
  inlay.receiveShadow = true;
  table.add(inlay);
  // The brass line round the baize.
  const brassRing = new THREE.Mesh(
    new THREE.TorusGeometry(ROOM.tableRadius - 0.2, 0.007, 6, 48),
    standard(0xc9963f, 0.3, 0.9)
  );
  brassRing.rotation.x = Math.PI / 2;
  brassRing.position.y = ROOM.tableHeight - 0.02;
  table.add(brassRing);

  // The pedestal: a turned column on a cross base.
  const column = new THREE.Mesh(
    turned([
      [0, 0], [0.42, 0], [0.42, 0.05], [0.3, 0.08], [0.18, 0.12],
      [0.14, 0.2], [0.12, 0.42], [0.16, 0.55], [0.14, 0.62], [0.2, 0.66],
      [0.3, 0.68], [0.3, 0.7], [0, 0.7]
    ], 24),
    tableTopMaterial
  );
  column.position.y = 0.02;
  column.castShadow = true;
  table.add(column);
  // Three feet, so it stands like a proper pedestal table.
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const foot = new THREE.Mesh(
      roundedBox(0.62, 0.09, 0.16, 0.035, 0.01),
      tableTopMaterial
    );
    foot.position.set(Math.sin(angle) * 0.42, 0.05, Math.cos(angle) * 0.42);
    foot.rotation.y = angle;
    foot.castShadow = true;
    table.add(foot);
  }
  table.position.y = 0;
  group.add(table);
  addShadow(0, 0, 3.4);

  /* ---- the chairs ---- */

  const chairMaterial = textured(woodTexture(WOOD_DARK.light, WOOD_DARK.dark, 512), 0.78, 0.05);
  const cushionMaterial = new THREE.MeshStandardMaterial({ color: 0x5a1f26, roughness: 0.95 });
  const chairs = [];
  for (let i = 0; i < settings.seats; i++) {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(roundedBox(0.5, 0.09, 0.48, 0.05, 0.012), chairMaterial);
    seat.position.y = 0.45;
    seat.castShadow = true;
    chair.add(seat);
    const cushion = new THREE.Mesh(roundedBox(0.44, 0.06, 0.42, 0.06, 0.02), cushionMaterial);
    cushion.position.y = 0.51;
    chair.add(cushion);
    // The back: two uprights, a crest rail and three spindles.
    [-0.21, 0.21].forEach(function (x) {
      const post = new THREE.Mesh(
        turned([[0, 0], [0.028, 0], [0.03, 0.08], [0.022, 0.18], [0.026, 0.34],
          [0.02, 0.46], [0.032, 0.52], [0, 0.54]], 10),
        chairMaterial
      );
      post.position.set(x, 0.48, -0.2);
      post.castShadow = true;
      chair.add(post);
    });
    const crest = new THREE.Mesh(roundedBox(0.5, 0.11, 0.06, 0.025, 0.008), chairMaterial);
    crest.position.set(0, 0.99, -0.2);
    chair.add(crest);
    [-0.1, 0, 0.1].forEach(function (x) {
      const spindle = new THREE.Mesh(
        turned([[0, 0], [0.016, 0], [0.02, 0.05], [0.013, 0.16], [0.018, 0.3],
          [0.014, 0.4], [0, 0.42]], 8),
        chairMaterial
      );
      spindle.position.set(x, 0.56, -0.2);
      chair.add(spindle);
    });
    // The legs, turned, with a stretcher between them.
    [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]].forEach(function (pos) {
      const leg = new THREE.Mesh(
        turned([[0, 0], [0.03, 0], [0.035, 0.04], [0.024, 0.12], [0.028, 0.3],
          [0.022, 0.4], [0.03, 0.44], [0, 0.45]], 10),
        chairMaterial
      );
      leg.position.set(pos[0], 0, pos[1]);
      leg.castShadow = true;
      chair.add(leg);
    });
    [-0.2, 0.2].forEach(function (x) {
      const stretcher = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.36, 8), chairMaterial);
      stretcher.rotation.x = Math.PI / 2;
      stretcher.position.set(x, 0.16, 0);
      chair.add(stretcher);
    });

    const angle = (i / settings.seats) * Math.PI * 2;
    const radius = ROOM.tableRadius + 0.72;
    chair.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    chair.rotation.y = angle + Math.PI;
    group.add(chair);
    addShadow(chair.position.x, chair.position.z, 1.1);
    chairs.push(chair);
  }

  /* ---- the deck and the discard ---- */

  const cardBackMaterial = standard(0x22355c, 0.8);
  const cardEdgeMaterial = standard(0xd6b45a, 0.45, 0.3);
  const deck = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const card = new THREE.Mesh(roundedBox(0.16, 0.011, 0.22, 0.006, 0.002), cardBackMaterial);
    card.position.y = i * 0.012;
    card.rotation.y = (i - 1) * 0.02;
    card.castShadow = true;
    deck.add(card);
  }
  const band = new THREE.Mesh(roundedBox(0.165, 0.006, 0.225, 0.006, 0.002), cardEdgeMaterial);
  band.position.y = 0.02;
  deck.add(band);
  deck.position.set(-0.32, ROOM.tableHeight - 0.02, -0.72);
  deck.rotation.y = -0.2;
  group.add(deck);

  const discard = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const card = new THREE.Mesh(roundedBox(0.16, 0.011, 0.22, 0.006, 0.002), cardBackMaterial);
    card.position.set(i * 0.008, i * 0.012, i * 0.006);
    card.rotation.y = i * 0.05;
    card.castShadow = true;
    discard.add(card);
  }
  discard.position.set(0.34, ROOM.tableHeight - 0.02, 0.68);
  discard.rotation.y = 0.16;
  group.add(discard);

  /* ---- the sideboard, the drinks table and the plant ---- */

  const sideboard = new THREE.Group();
  const cabinet = new THREE.Mesh(roundedBox(1.9, 0.86, 0.48, 0.02, 0.008), chairMaterial);
  cabinet.position.y = 0.43;
  cabinet.castShadow = true;
  sideboard.add(cabinet);
  // Two drawers and two doors, with brass handles.
  [-0.46, 0.46].forEach(function (x) {
    [-0.12, 0.12].forEach(function (y) {
      const drawer = new THREE.Mesh(roundedBox(0.8, 0.34, 0.03, 0.015, 0.006), chairMaterial);
      drawer.position.set(x, 0.58 + y, 0.25);
      sideboard.add(drawer);
      const pull = new THREE.Mesh(
        turned([[0, 0], [0.012, 0], [0.012, 0.05], [0.022, 0.06], [0.012, 0.07], [0, 0.07]], 8),
        standard(0xc9963f, 0.32, 0.85)
      );
      pull.rotation.x = Math.PI / 2;
      pull.position.set(x, 0.58 + y, 0.28);
      sideboard.add(pull);
    });
  });
  const sideTop = new THREE.Mesh(roundedBox(2.0, 0.05, 0.54, 0.015, 0.008), tableTopMaterial);
  sideTop.position.y = 0.88;
  sideTop.castShadow = true;
  sideboard.add(sideTop);
  // A leather blotter on the sideboard, for the notepad to sit on.
  const blotter = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.012, 0.44),
    textured(leatherTexture(512), 0.7, 0.04)
  );
  blotter.position.set(-0.5, 0.915, 0);
  blotter.rotation.y = 0.06;
  sideboard.add(blotter);
  sideboard.position.set(-2.9, 0, -ROOM.depth / 2 + 0.45);
  group.add(sideboard);
  addShadow(-2.9, -ROOM.depth / 2 + 0.45, 2.4);

  // The drinks table, with a decanter and two glasses.
  const drinks = new THREE.Group();
  const drinksTop = new THREE.Mesh(
    turned([[0, 0], [0.28, 0], [0.28, 0.03], [0.24, 0.05], [0.05, 0.06],
      [0.045, 0.5], [0.09, 0.6], [0.09, 0.64], [0, 0.64]], 20),
    tableTopMaterial
  );
  drinksTop.castShadow = true;
  drinks.add(drinksTop);
  const decanter = new THREE.Mesh(
    turned([[0, 0], [0.09, 0.01], [0.1, 0.08], [0.09, 0.16], [0.035, 0.22],
      [0.03, 0.3], [0.04, 0.33], [0, 0.33]], 16),
    new THREE.MeshStandardMaterial({
      color: 0x7a4a22, roughness: 0.12, metalness: 0.0,
      transparent: true, opacity: 0.85
    })
  );
  decanter.position.set(0, 0.64, 0);
  drinks.add(decanter);
  [-0.14, 0.14].forEach(function (x) {
    const glass = new THREE.Mesh(
      turned([[0, 0], [0.045, 0], [0.045, 0.02], [0.038, 0.09], [0.042, 0.1],
        [0.04, 0.11], [0.032, 0.105], [0.03, 0.02], [0, 0.015]], 14),
      new THREE.MeshStandardMaterial({
        color: 0xdfe8f0, roughness: 0.08, transparent: true, opacity: 0.5
      })
    );
    glass.position.set(x, 0.64, 0.08);
    drinks.add(glass);
  });
  drinks.position.set(3.3, 0, -2.4);
  group.add(drinks);
  addShadow(3.3, -2.4, 1.1);

  // The plant in the corner.
  const plant = new THREE.Group();
  const pot = new THREE.Mesh(
    turned([[0, 0], [0.2, 0], [0.24, 0.05], [0.26, 0.3], [0.3, 0.36],
      [0.28, 0.38], [0.26, 0.36], [0.24, 0.06], [0, 0.02]], 18),
    new THREE.MeshStandardMaterial({ color: 0x7a4a30, roughness: 0.9 })
  );
  pot.castShadow = true;
  plant.add(pot);
  const soil = new THREE.Mesh(
    new THREE.CircleGeometry(0.25, 16),
    new THREE.MeshStandardMaterial({ color: 0x2a1d12, roughness: 1 })
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.34;
  plant.add(soil);
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x3f7a4a, roughness: 0.85, side: THREE.DoubleSide
  });
  for (let i = 0; i < 14; i++) {
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.17, 10, 0, Math.PI), leafMaterial);
    const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.4;
    const height = 0.5 + (i % 5) * 0.16;
    leaf.position.set(Math.cos(a) * 0.1, height, Math.sin(a) * 0.1);
    leaf.rotation.set(-0.9 - (i % 3) * 0.2, a, 0.3);
    leaf.scale.set(1, 1.7, 1);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  plant.position.set(-3.9, 0, 3.4);
  group.add(plant);
  addShadow(-3.9, 3.4, 1.4);

  /* ---- the pictures on the walls ---- */

  const pictureKinds = ['phoenix', 'curtain', 'table'];
  const pictureSpots = [
    { x: 1.4, z: -ROOM.depth / 2 + 0.07, ry: 0, kind: 'phoenix', w: 0.8, h: 1.05 },
    { x: -ROOM.width / 2 + 0.07, z: 1.9, ry: Math.PI / 2, kind: 'curtain', w: 0.62, h: 0.8 },
    { x: -ROOM.width / 2 + 0.07, z: -3.2, ry: Math.PI / 2, kind: 'table', w: 0.66, h: 0.55 }
  ];
  pictureSpots.forEach(function (spot, index) {
    const picture = new THREE.Group();
    const frame = new THREE.Mesh(
      frameGeometry(spot.w, spot.h, 0.07, 0.06),
      standard(0xc9963f, 0.35, 0.75)
    );
    frame.castShadow = true;
    picture.add(frame);
    const canvas = new THREE.Mesh(
      new THREE.PlaneGeometry(spot.w - 0.12, spot.h - 0.12),
      new THREE.MeshStandardMaterial({
        map: pictureTexture(spot.kind), roughness: 0.85
      })
    );
    canvas.position.z = 0.02;
    picture.add(canvas);
    picture.position.set(spot.x, 1.85, spot.z);
    picture.rotation.y = spot.ry;
    group.add(picture);
  });

  /* ---- the pendant lamp over the table ---- */

  const lampGroup = new THREE.Group();
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 1.2, 6),
    standard(0x141414, 0.8)
  );
  cord.position.y = 0.6;
  lampGroup.add(cord);
  const shade = new THREE.Mesh(
    turned([[0, 0.34], [0.06, 0.32], [0.16, 0.2], [0.34, 0.03], [0.36, 0],
      [0.34, -0.01], [0.15, 0.16], [0.05, 0.28], [0, 0.3]], 24),
    new THREE.MeshStandardMaterial({
      color: 0x2b3247, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide
    })
  );
  shade.position.y = -0.02;
  shade.castShadow = true;
  lampGroup.add(shade);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8 })
  );
  bulb.position.y = 0.02;
  lampGroup.add(bulb);
  lampGroup.position.set(0, 2.62, 0);
  group.add(lampGroup);

  return {
    group: group,
    chairs: chairs,
    table: table,
    deck: deck,
    discard: discard,
    playArea: inlay,
    tableHeight: ROOM.tableHeight,
    tableRadius: ROOM.tableRadius,
    lampGroup: lampGroup,
    fireplace: { group: fireplace, light: fireLight, mesh: fire },
    door: doorGroup,
    windows: windows,
    sideboard: sideboard,
    drinks: drinks,
    plant: plant,
    floor: floor,
    rug: rug
  };
}
