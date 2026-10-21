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
 * True when this browser can run the 3D table.
 *
 * WebGL 2 is asked for, because that is what the current Three.js needs: a
 * browser with only the old WebGL 1 would fail later, in a far less polite
 * way, so it is turned away here with a message instead.
 *
 * Asked BEFORE anything is built, so a browser that cannot do it is told
 * plainly instead of showing a black screen.
 */
export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
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
  const hemi = new THREE.HemisphereLight(0x6d86b8, 0x33241a, 0.3);
  scene.add(hemi);

  // The lamp over the table. It is the light everything is lit by, and the
  // only bright thing in the room: the table is the stage.
  const lamp = new THREE.SpotLight(PALETTE.lamp, 42, 14, Math.PI * 0.46, 0.6, 1.5);
  lamp.position.set(0, 2.6, 0);
  lamp.target.position.set(0, 0.78, 0);
  lamp.castShadow = QUALITY[settings.quality].shadows;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.camera.near = 0.5;
  lamp.shadow.camera.far = 12;
  lamp.shadow.bias = -0.0012;
  scene.add(lamp);
  scene.add(lamp.target);

  // A soft fill from the side, so a face is never a black hole.
  const fill = new THREE.DirectionalLight(PALETTE.cool, 0.55);
  fill.position.set(-4, 3.2, 3.4);
  scene.add(fill);

  // A second, cooler fill from the other side, so the table is lit all round.
  const fillBack = new THREE.DirectionalLight(0xbcd0ff, 0.12);
  fillBack.position.set(4.2, 2.6, -3.6);
  scene.add(fillBack);

  // A warm bounce off the table, aimed back up at the players.
  const bounce = new THREE.PointLight(0xffb765, 7, 5, 2);
  bounce.position.set(0, 1.05, 0);
  scene.add(bounce);

  // The light in the player's own hands. It lives on the camera, so the cards
  // and the arms are always lit no matter where in the room the player is
  // looking - and it is short enough that it never reaches across the table.
  const handLight = new THREE.PointLight(0xfff2d8, 2.4, 2.4, 1.5);
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

  return { renderer, scene, camera, lamp, fill, bounce, handLight, hemi, setQuality, applySize, dispose };
}
