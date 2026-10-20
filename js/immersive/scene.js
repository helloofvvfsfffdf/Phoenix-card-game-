/* PHOENIX - the immersive (3D) scene.
 *
 * The renderer, the camera, the lights and the room. Everything here is
 * built from primitives, so there is no model to download, no licence to
 * chase and nothing to go missing on a slow connection.
 *
 * The look is deliberately stylised: a warm lamp over the table, a cool fill
 * from the walls, soft shadows, and no photorealism anywhere.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';

export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, antialias: false, aaSamples: 0, segments: 12 },
  medium: { pixelRatio: 1.5, shadows: true, antialias: true, aaSamples: 0, segments: 24 },
  high: { pixelRatio: 2, shadows: true, antialias: true, aaSamples: 4, segments: 32 }
};

/** The palette. One place, so the whole room reads as the same game. */
export const PALETTE = {
  felt: 0x1d5c4a,
  feltDark: 0x143f33,
  wood: 0x6b4a2f,
  woodDark: 0x4a3220,
  wall: 0x1b2436,
  wallDark: 0x121a28,
  floor: 0x3a2b22,
  rug: 0x2a2f4a,
  brass: 0xc9963f,
  cream: 0xf2e3c4,
  ink: 0x1d1a15,
  cardBack: 0x2b3f6b,
  cardBackEdge: 0xd6b45a,
  lamp: 0xffcf8a,
  cool: 0x8fb4ff
};

/**
 * True when this browser can run WebGL at all.
 *
 * Asked BEFORE anything is built, so a browser that cannot do it is told
 * plainly instead of showing a black screen.
 */
export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch (error) {
    return false;
  }
}

/**
 * The renderer, the camera and the lights.
 *
 * `quality` is one of QUALITY's keys and can be changed at any time: the
 * pixel ratio and the shadows follow it, and the browser is told to redraw.
 */
export function createScene(container, options) {
  const settings = Object.assign({ quality: 'medium' }, options || {});

  const renderer = new THREE.WebGLRenderer({
    antialias: QUALITY[settings.quality].antialias,
    powerPreference: 'high-performance',
    alpha: false
  });
  renderer.setClearColor(0x0a0f1a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = QUALITY[settings.quality].shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.classList.add('immersive-canvas');
  renderer.domElement.setAttribute('tabindex', '0');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1a);
  // A little haze, so the far wall falls away instead of ending in a line.
  scene.fog = new THREE.Fog(0x0d1322, 9, 22);

  const camera = new THREE.PerspectiveCamera(
    62, container.clientWidth / Math.max(1, container.clientHeight), 0.05, 60);

  /* ---- the lights ---- */

  // The room's own ambience: cool from above, warm from the floor.
  const hemi = new THREE.HemisphereLight(0x93b6ff, 0x2a1d14, 0.9);
  scene.add(hemi);

  // The lamp over the table. It is the light everything is lit by.
  const lamp = new THREE.SpotLight(PALETTE.lamp, 150, 16, Math.PI * 0.46, 0.5, 1.5);
  lamp.position.set(0, 3.1, 0);
  lamp.target.position.set(0, 0.78, 0);
  lamp.castShadow = QUALITY[settings.quality].shadows;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.camera.near = 0.5;
  lamp.shadow.camera.far = 12;
  lamp.shadow.bias = -0.0012;
  scene.add(lamp);
  scene.add(lamp.target);

  // A soft fill from the side, so a face is never a black hole.
  const fill = new THREE.DirectionalLight(PALETTE.cool, 0.85);
  fill.position.set(-4, 3.2, 3.4);
  scene.add(fill);

  // A second, cooler fill from the other side, so the table is lit all round.
  const fillBack = new THREE.DirectionalLight(0xbcd0ff, 0.5);
  fillBack.position.set(4.2, 2.6, -3.6);
  scene.add(fillBack);

  // A warm bounce off the table, aimed back up at the players.
  const bounce = new THREE.PointLight(0xffb765, 12, 7, 2);
  bounce.position.set(0, 1.05, 0);
  scene.add(bounce);

  // The light in the player's own hands. It lives on the camera, so the cards
  // and the arms are always lit no matter where in the room the player is
  // looking - and it is short enough that it never reaches across the table.
  const handLight = new THREE.PointLight(0xfff2d8, 2.6, 2.4, 1.5);
  handLight.position.set(0, 0.05, -0.35);
  camera.add(handLight);

  /* ---- the resize and the quality ---- */

  function applySize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function setQuality(name) {
    const preset = QUALITY[name] || QUALITY.medium;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
    renderer.shadowMap.enabled = preset.shadows;
    lamp.castShadow = preset.shadows;
    scene.traverse(function (object) {
      if (object.isMesh && object.material) {
        object.material.needsUpdate = true;
      }
    });
    applySize();
  }

  applySize();
  setQuality(settings.quality);

  window.addEventListener('resize', applySize);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(applySize);
    observer.observe(container);
  }

  function dispose() {
    window.removeEventListener('resize', applySize);
    scene.traverse(function (object) {
      if (object.geometry) object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach(function (m) { m.dispose(); });
      else if (material) material.dispose();
    });
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  return { renderer, scene, camera, lamp, fill, bounce, handLight, setQuality, applySize, dispose };
}

/**
 * The room: the walls, the floor, the rug, the table, the chairs, the deck
 * and the card-playing area in the middle of it.
 *
 * Everything is a primitive with flat, warm colours, and nothing here costs
 * more than a few hundred triangles.
 */
export function buildRoom(scene, options) {
  const settings = Object.assign({ seats: 5, radius: 1.55 }, options || {});
  const segments = QUALITY[settings.quality] ? QUALITY[settings.quality].segments : 24;
  const group = new THREE.Group();
  scene.add(group);

  const mat = function (color, roughness, metalness) {
    return new THREE.MeshStandardMaterial({
      color: color, roughness: roughness === undefined ? 0.85 : roughness,
      metalness: metalness === undefined ? 0.05 : metalness
    });
  };

  const add = function (geometry, material, x, y, z, castShadow, receiveShadow) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.castShadow = castShadow !== false;
    mesh.receiveShadow = receiveShadow !== false;
    group.add(mesh);
    return mesh;
  };

  /* ---- the shell of the room ---- */

  const floorMat = mat(PALETTE.floor, 0.95);
  const floor = add(new THREE.PlaneGeometry(16, 16), floorMat, 0, 0, 0, false, true);
  floor.rotation.x = -Math.PI / 2;

  const wallMat = mat(PALETTE.wall, 0.95);
  const wallSpec = [
    [0, 3, -5, 0], [0, 3, 5, Math.PI], [-5, 3, 0, Math.PI / 2], [5, 3, 0, -Math.PI / 2]
  ];
  wallSpec.forEach(function (spec) {
    const wall = add(new THREE.PlaneGeometry(10, 6), wallMat, spec[0], spec[1], spec[2], false, true);
    wall.rotation.y = spec[3];
  });

  // A rug under the table, so the table is not floating on bare boards.
  const rug = add(new THREE.CircleGeometry(3.4, segments),
    mat(PALETTE.rug, 1), 0, 0.012, 0, false, true);
  rug.rotation.x = -Math.PI / 2;

  // Panelled wainscot around the bottom of the walls: cheap, and it gives
  // the eye a horizon line.
  const wainscotMat = mat(PALETTE.wallDark, 0.9);
  const wainscotSpec = [[0, 0.55, -4.94, 0], [0, 0.55, 4.94, Math.PI],
    [-4.94, 0.55, 0, Math.PI / 2], [4.94, 0.55, 0, -Math.PI / 2]];
  wainscotSpec.forEach(function (spec) {
    const panel = add(new THREE.PlaneGeometry(10, 1.1), wainscotMat,
      spec[0], spec[1], spec[2], false, true);
    panel.rotation.y = spec[3];
  });

  /* ---- the table ---- */

  const tableTop = add(new THREE.CylinderGeometry(settings.radius, settings.radius, 0.1, segments),
    mat(PALETTE.felt, 0.95), 0, 0.76, 0);
  const tableRim = add(new THREE.TorusGeometry(settings.radius, 0.055, 8, segments),
    mat(PALETTE.brass, 0.35, 0.8), 0, 0.76, 0);
  tableRim.rotation.x = Math.PI / 2;
  const tableSkirt = add(new THREE.CylinderGeometry(settings.radius - 0.06,
    settings.radius - 0.22, 0.34, segments), mat(PALETTE.woodDark, 0.9), 0, 0.5, 0);
  const tableLeg = add(new THREE.CylinderGeometry(0.16, 0.26, 0.68, 16),
    mat(PALETTE.wood, 0.9), 0, 0.34, 0);
  const tableFoot = add(new THREE.CylinderGeometry(0.44, 0.5, 0.06, 20),
    mat(PALETTE.woodDark, 0.9), 0, 0.03, 0);

  // The card-playing area: a lighter oval in the middle of the felt.
  const playArea = add(new THREE.CircleGeometry(0.95, segments),
    mat(PALETTE.feltDark, 0.98), 0, 0.812, 0, false, true);
  playArea.rotation.x = -Math.PI / 2;

  // The deck, squared off, and the discard pile beside it.
  const deck = new THREE.Group();
  const deckBody = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.24),
    mat(PALETTE.cardBack, 0.8));
  deckBody.castShadow = true;
  deck.add(deckBody);
  const deckBand = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.02, 0.245),
    mat(PALETTE.cardBackEdge, 0.5, 0.3));
  deck.add(deckBand);
  deck.position.set(0, 0.87, -0.62);
  deck.rotation.y = -0.18;
  group.add(deck);

  const discard = new THREE.Group();
  const discardBody = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.03, 0.26),
    mat(PALETTE.cardBack, 0.85));
  discardBody.castShadow = true;
  discard.add(discardBody);
  discard.position.set(0.02, 0.83, 0.66);
  discard.rotation.y = 0.14;
  group.add(discard);

  /* ---- the chairs ---- */

  const chairMat = mat(PALETTE.wood, 0.9);
  const seatMat = mat(0x5c3f28, 0.95);
  const chairs = [];
  for (let i = 0; i < settings.seats; i++) {
    const angle = (i / settings.seats) * Math.PI * 2;
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.44), seatMat);
    seat.position.y = 0.45;
    seat.castShadow = true;
    seat.receiveShadow = true;
    chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.07), chairMat);
    back.position.set(0, 0.71, -0.19);
    back.castShadow = true;
    chair.add(back);
    const legPositions = [[-0.18, -0.16], [0.18, -0.16], [-0.18, 0.16], [0.18, 0.16]];
    legPositions.forEach(function (pos) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), chairMat);
      leg.position.set(pos[0], 0.22, pos[1]);
      leg.castShadow = true;
      chair.add(leg);
    });
    const radius = settings.radius + 0.78;
    chair.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    chair.rotation.y = angle + Math.PI;
    group.add(chair);
    chairs.push(chair);
  }

  /* ---- a little dressing, so the room is not a box ---- */

  // A sideboard against the wall, with a lamp on it.
  const sideboard = add(new THREE.BoxGeometry(1.9, 0.85, 0.45), mat(PALETTE.woodDark, 0.9),
    -3.2, 0.43, -3.5);
  sideboard.castShadow = true;
  const lampStem = add(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 10), mat(PALETTE.brass, 0.4, 0.7),
    -3.2, 1.08, -3.5);
  const lampShade = add(new THREE.ConeGeometry(0.19, 0.24, 14, 1, true),
    mat(0xe8c07a, 0.7), -3.2, 1.42, -3.5);
  const sideGlow = new THREE.PointLight(0xffc478, 9, 5.5, 2);
  sideGlow.position.set(-3.2, 1.4, -3.5);
  scene.add(sideGlow);

  // A tall plant in the corner, made of a trunk and a few leaves.
  const pot = add(new THREE.CylinderGeometry(0.2, 0.15, 0.32, 12), mat(0x7a4a30, 0.95), 3.5, 0.16, -3.4);
  const trunk = add(new THREE.CylinderGeometry(0.035, 0.05, 0.8, 8), mat(0x4a3a22, 0.95), 3.5, 0.7, -3.4);
  const leafMat = mat(0x3f7a4a, 0.9);
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), leafMat);
    const a = (i / 7) * Math.PI * 2;
    leaf.position.set(3.5 + Math.cos(a) * 0.16, 1.05 + (i % 3) * 0.16, -3.4 + Math.sin(a) * 0.16);
    leaf.scale.set(1, 0.55, 1.4);
    leaf.castShadow = true;
    group.add(leaf);
  }

  // The pendant lamp over the table: a shade, a cord, and the light itself.
  const cord = add(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6), mat(0x1a1a1a, 0.8), 0, 3.65, 0);
  const shade = add(new THREE.ConeGeometry(0.42, 0.34, 20, 1, true), mat(0x2a3247, 0.8), 0, 3.1, 0);
  const bulb = add(new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe0a8 }), 0, 2.98, 0, false, false);

  return {
    group: group,
    chairs: chairs,
    tableTop: tableTop,
    deck: deck,
    discard: discard,
    playArea: playArea,
    radius: settings.radius,
    lampParts: { cord: cord, shade: shade, bulb: bulb }
  };
}
