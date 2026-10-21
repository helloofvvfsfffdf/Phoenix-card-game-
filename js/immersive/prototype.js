/* PHOENIX - the immersive (3D) prototype.
 *
 * MILESTONE 1. This is a STANDALONE prototype: it runs on its own page, it
 * uses MOCK data, and it is not connected to the live multiplayer yet. The
 * gameplay it shows is the real game's shape - five people round a table,
 * a hand of up to seven cards, a card picked and played - but nothing here
 * talks to the server.
 *
 * The camera is FIRST PERSON and SEATED: the player never stands, never
 * walks, and can only look around. The mouse or a finger turns the head,
 * within limits, so nobody can end up looking at the inside of their own
 * head or spinning themselves sick.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { createScene, buildRoom, webglAvailable, QUALITY, PALETTE, ROOM } from './scene.js';
import { createCharacter, animateCharacter, animateDraw, animatePlay, CHARACTERS } from './characters.js';
import { createHand, createFan, MAX_HAND } from './hand.js';
import { createLaptop, createTableLaptops } from './laptop.js';
import { buildPoster, buildNotepad, buildJailCell } from './props.js';
import { loadMixamoCharacter, loadMixamoGLB, playAnimation } from './mixamo.js';

const SEATS = 6;
/** The height of the seat of a chair, which is where a seated person's hips are. */
const SEAT_HEIGHT = 0.52;
const SETTINGS_KEY = 'phoenix.immersive.settings.v1';

const DEFAULTS = {
  quality: 'medium',
  sensitivity: 1,
  reducedMotion: false
};

/** The mock hand. Real card records, so the faces are the real faces. */
function mockHand() {
  const Cards = window.PhoenixCards;
  const ids = ['bonus', 'knife', 'steal', 'trick', 'wheel', 'hostage', 'support'];
  return ids
    .map(function (id) { return Cards ? Cards.byId(id) : null; })
    .filter(Boolean);
}

function readSettings() {
  let saved = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch (error) {
    saved = {};
  }
  return Object.assign({}, DEFAULTS, saved);
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) { /* the settings simply do not persist */ }
}

/**
 * The prototype.
 *
 * Everything is built once, and the only thing that changes every frame is
 * where the characters are breathing and where the camera is looking.
 */
export function startPrototype(root) {
  const stage = root.querySelector('#immersive-stage');
  const hud = root.querySelector('#immersive-hud');
  const loading = root.querySelector('#immersive-loading');
  const failure = root.querySelector('#immersive-failure');

  if (!webglAvailable()) {
    if (loading) loading.hidden = true;
    if (failure) failure.hidden = false;
    return null;
  }

  const settings = readSettings();
  const view = createScene(stage, { quality: settings.quality });
  const { renderer, scene, camera } = view;

  const room = buildRoom(scene, { seats: SEATS, quality: settings.quality });

  /* ---- the people round the table ---- */

  const characters = [];
  for (let i = 0; i < SEATS - 1; i++) {
    const look = CHARACTERS[i % CHARACTERS.length];
    const character = createCharacter({ look: look });
    const angle = ((i + 1) / SEATS) * Math.PI * 2;
    const radius = room.tableRadius + 0.72;
    character.root.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    character.root.rotation.y = angle + Math.PI;
    character.eyes = [];
    scene.add(character.root);
    characters.push(character);
  }

  /* ---- the player: seated, in the first person ---- */

  // The seat the camera sits in, and the height of a seated person's eyes.
  const seatAngle = 0;
  const seatRadius = room.tableRadius + 0.72;
  const head = new THREE.Group();
  head.position.set(Math.sin(seatAngle) * seatRadius, 1.16, Math.cos(seatAngle) * seatRadius);
  head.rotation.y = seatAngle + Math.PI;
  scene.add(head);
  camera.position.set(0, 0, 0);
  head.add(camera);

  const look = CHARACTERS[0];
  const hands = createHand(camera, { skin: look.skin, sleeve: look.shirt });
  const fan = createFan(camera, {});

  /* ---- the laptops ---- */

  // One open laptop on the table in front of every player, turned to face
  // them and low enough that it hides neither the table nor their cards. The
  // screen is a live canvas: your PHOENIX points balance, a green or red band
  // when it moves, and a LEAVE MATCH button.
  const laptops = createTableLaptops(scene, {
    seats: SEATS,
    radius: room.tableRadius - 0.42,
    tableHeight: room.tableHeight
  });
  const laptopBySeat = {};
  laptops.forEach(function (entry) { laptopBySeat[entry.seat] = entry.laptop; });

  // The balances on the screens. In a real match these come from the server;
  // here they are the mock table's, and they move so the notifications can
  // be seen working.
  const balances = {};
  Object.keys(laptopBySeat).forEach(function (seat) { balances[seat] = 0; });
  let nextSwing = 4;

  /* ---- the Mixamo character ---- */

  // Every seat is taken by a real person: a Mixamo model with its skeleton,
  // its clothes, its hair and its textures. The files are the downloads the
  // owner made, converted into small glTF files with the pictures made a
  // sensible size, so a character arrives in a moment rather than a coffee
  // break. They arrive after the room is already standing, so the table is
  // never waiting for a download.
  const CHARACTER_FILES = ['ash', 'brook', 'cass', 'dara', 'emery'];
  const mixamo = {
    loading: true,
    characters: [],
    errors: [],
    clipNames: [],
    seat: -1
  };

  CHARACTER_FILES.forEach(function (name, index) {
    const seat = index + 1;
    const placeholder = characters[index];
    const angle = (seat / SEATS) * Math.PI * 2;
    const radius = room.tableRadius + 0.72;

    loadMixamoGLB('assets/mixamo/characters/' + name + '.glb', { name: name })
      .then(function (loaded) {
        loaded.group.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
        loaded.group.rotation.y = angle + Math.PI;
        scene.add(loaded.group);

        // The placeholder steps aside.
        if (placeholder) placeholder.root.visible = false;

        mixamo.characters.push({ seat: seat, character: loaded, name: name });
        mixamo.clipNames = loaded.clipNames;

        // The character sits down. The sitting animation is the one Mixamo
        // calls "Sitting Idle", extracted into a small file of keyframes; the
        // skeleton is never bent by hand into a shape nobody would sit like.
        return playAnimation(loaded, 'sittingIdle', { loop: true }).then(function (played) {
          loaded.sitting = !!played;
          // The character is placed by its hips, which have to be on the seat
          // of the chair: the models do not all start from the same place, and
          // the seat is a known height.
          const hips = loaded.bones.filter(function (bone) {
            return /Hips/.test(bone.name) && bone.name.indexOf('_') === -1;
          })[0];
          if (hips) {
            const where = new THREE.Vector3();
            hips.getWorldPosition(where);
            loaded.group.position.y += SEAT_HEIGHT - where.y;
          }
        });
      })
      .catch(function (error) {
        mixamo.errors.push((name || 'a character') + ': ' +
          (error && error.message ? error.message : String(error)));
      })
      .then(function () {
        if (mixamo.characters.length + mixamo.errors.length >= CHARACTER_FILES.length) {
          mixamo.loading = false;
          mixamo.seat = mixamo.characters.length ? mixamo.characters[0].seat : -1;
          const line = document.getElementById('immersive-status');
          if (line) {
            line.textContent = mixamo.errors.length
              ? mixamo.errors.length + ' character(s) could not be loaded: ' + mixamo.errors[0]
              : mixamo.characters.length + ' Mixamo characters are sitting at the table.';
          }
        }
      });
  });

  /* ---- the things in the room ---- */

  buildPoster(scene, { x: -0.4, z: -ROOM.depth / 2 + 0.06, ry: 0 });
  buildNotepad(scene, {});
  buildJailCell(scene, {});

  /* ---- the mock game ---- */

  const mock = {
    hand: mockHand(),
    deck: mockHand(),
    played: [],
    selected: -1
  };
  fan.set(mock.hand);

  /* ---- the camera: seated, looking around, and nothing more ---- */

  const cameraState = {
    yaw: 0,
    pitch: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    pointerId: null
  };
  const LIMITS = { yaw: 1.75, pitch: 0.62 };

  function lookBy(dx, dy) {
    const speed = 0.0032 * settings.sensitivity;
    cameraState.yaw = Math.max(-LIMITS.yaw, Math.min(LIMITS.yaw, cameraState.yaw - dx * speed));
    cameraState.pitch = Math.max(-LIMITS.pitch, Math.min(LIMITS.pitch, cameraState.pitch - dy * speed));
  }

  const canvas = renderer.domElement;

  canvas.addEventListener('pointerdown', function (event) {
    // A drag looks around; a tap picks a card. The tap is decided on the way
    // up, by how far the pointer moved.
    cameraState.dragging = true;
    cameraState.pointerId = event.pointerId;
    cameraState.lastX = event.clientX;
    cameraState.lastY = event.clientY;
    cameraState.moved = 0;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', function (event) {
    if (!cameraState.dragging || event.pointerId !== cameraState.pointerId) return;
    const dx = event.clientX - cameraState.lastX;
    const dy = event.clientY - cameraState.lastY;
    cameraState.lastX = event.clientX;
    cameraState.lastY = event.clientY;
    cameraState.moved += Math.abs(dx) + Math.abs(dy);
    lookBy(dx, dy);
  });

  function endDrag(event) {
    if (!cameraState.dragging) return;
    cameraState.dragging = false;
    if (event && event.pointerId === cameraState.pointerId) {
      try { canvas.releasePointerCapture(event.pointerId); } catch (error) { /* already gone */ }
    }
    cameraState.pointerId = null;
  }

  canvas.addEventListener('pointerup', function (event) {
    const moved = cameraState.moved || 0;
    endDrag(event);
    // A tap, not a drag: pick a card.
    if (moved < 6) {
      const pointer = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
      );
      const index = fan.pick(pointer);
      if (index >= 0) selectCard(index);
    }
  });

  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', function (event) { event.preventDefault(); });

  /* ---- the cards ---- */

  const flying = [];

  function selectCard(index) {
    mock.selected = fan.toggle(index);
    updateHud();
  }

  /** The card lifts off the fan, travels to the table, and lands there. */
  function playSelected() {
    if (mock.selected < 0) return;
    const index = mock.selected;
    const entry = fan.take(index);
    if (!entry) return;
    mock.hand.splice(index, 1);
    fan.set(mock.hand);
    mock.selected = -1;

    // The card is put into the WORLD, so it can travel to the table.
    const mesh = entry.mesh;
    const cardGroup = new THREE.Group();
    cardGroup.add(mesh);
    scene.add(cardGroup);
    // The card was in the camera's space; put it back into the room's.
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    cardGroup.position.copy(camera.getWorldPosition(new THREE.Vector3()));
    cardGroup.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
    flying.push({
      group: cardGroup,
      mesh: mesh,
      from: cardGroup.position.clone(),
      to: new THREE.Vector3(0, room.tableHeight - 0.02, 0),
      start: performance.now(),
      duration: settings.reducedMotion ? 120 : 520,
      onDone: function () {
        scene.remove(cardGroup);
        mesh.geometry.dispose();
        if (entry.faceMaterial.map && entry.faceMaterial.map !== fan.backTexture) {
          entry.faceMaterial.map.dispose();
        }
        entry.faceMaterial.dispose();
        mock.played.push(entry.card);
        updateHud();
      }
    });
    updateHud();
  }

  /** A card slides in from the deck, the way a draw does. */
  function drawCard() {
    if (mock.hand.length >= MAX_HAND) {
      setStatus('Your hand is full - play a card first.');
      return;
    }
    const card = mock.deck.shift();
    if (!card) {
      setStatus('The mock deck is empty.');
      return;
    }
    mock.hand.push(card);
    fan.set(mock.hand);
    setStatus('Drew ' + card.name + '.');
    updateHud();
  }

  /* ---- the HUD ---- */

  const hudSelected = hud.querySelector('#immersive-selected');
  const hudHand = hud.querySelector('#immersive-hand');
  const hudStatus = hud.querySelector('#immersive-status');
  const hudQuality = hud.querySelector('#immersive-quality');
  const hudSensitivity = hud.querySelector('#immersive-sensitivity');
  const hudReduced = hud.querySelector('#immersive-reduced');

  function setStatus(message) {
    if (hudStatus) hudStatus.textContent = message;
  }

  function updateHud() {
    if (hudSelected) {
      hudSelected.textContent = mock.selected >= 0 && mock.hand[mock.selected]
        ? mock.hand[mock.selected].name
        : 'Nothing selected';
    }
    if (hudHand) {
      hudHand.textContent = mock.hand.length + ' of ' + MAX_HAND + ' cards in hand';
    }
  }

  if (hudQuality) {
    hudQuality.value = settings.quality;
    hudQuality.addEventListener('change', function () {
      settings.quality = hudQuality.value;
      view.setQuality(settings.quality);
      saveSettings(settings);
    });
  }
  if (hudSensitivity) {
    hudSensitivity.value = String(settings.sensitivity);
    hudSensitivity.addEventListener('input', function () {
      settings.sensitivity = Number(hudSensitivity.value);
      saveSettings(settings);
    });
  }
  if (hudReduced) {
    hudReduced.checked = !!settings.reducedMotion;
    hudReduced.addEventListener('change', function () {
      settings.reducedMotion = hudReduced.checked;
      saveSettings(settings);
    });
  }

  const playButton = hud.querySelector('#immersive-play');
  if (playButton) playButton.addEventListener('click', playSelected);
  const drawButton = hud.querySelector('#immersive-draw');
  if (drawButton) drawButton.addEventListener('click', drawCard);
  const resetButton = hud.querySelector('#immersive-reset');
  if (resetButton) {
    resetButton.addEventListener('click', function () {
      mock.hand = mockHand();
      mock.deck = mockHand();
      mock.played = [];
      mock.selected = -1;
      fan.set(mock.hand);
      setStatus('The hand is back to the start.');
      updateHud();
    });
  }

  /* ---- the loop ---- */

  const clock = new THREE.Clock();
  let running = true;

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const delta = Math.min(0.05, clock.getDelta());
    const time = clock.elapsedTime;

    head.rotation.y = cameraState.yaw;
    head.rotation.x = cameraState.pitch;

    characters.forEach(function (character) {
      animateCharacter(character, time, delta, settings.reducedMotion);
    });

    // The Mixamo characters' own animations.
    mixamo.characters.forEach(function (entry) {
      entry.character.mixer.update(delta);
    });

    // The laptops: their screens are redrawn when the balance moves, so the
    // positive and negative notifications really happen.
    if (!settings.reducedMotion && time > nextSwing) {
      nextSwing = time + 5 + Math.random() * 6;
      laptops.forEach(function (entry) {
        const change = Math.round((Math.random() - 0.45) * 20000);
        balances[entry.seat] += change;
        entry.laptop.bank.set(balances[entry.seat], change >= 0 ? 'Round won' : 'Round lost');
      });
    }
    laptops.forEach(function (entry) { entry.laptop.bank.tick(); });

    // The fire in the grate: a slow flicker, and the light it throws moves with
    // it. Reduced motion keeps the light steady.
    if (room.fireplace) {
      const flicker = settings.reducedMotion
        ? 1
        : 0.82 + Math.sin(time * 7.3) * 0.1 + Math.sin(time * 11.7) * 0.06;
      room.fireplace.light.intensity = 9 * flicker;
      room.fireplace.mesh.scale.set(1, 1.5 * (0.9 + flicker * 0.12), 0.6);
    }

    // The player's own hands breathe a little, and the fan settles.
    if (!settings.reducedMotion) {
      hands.group.position.y = Math.sin(time * 1.05) * 0.008;
      hands.group.rotation.z = Math.sin(time * 0.6) * 0.012;
    }
    fan.layout(settings.reducedMotion ? 0 : time);

    // The cards on their way to the table.
    const now = performance.now();
    for (let i = flying.length - 1; i >= 0; i--) {
      const flight = flying[i];
      const t = Math.max(0, Math.min(1, (now - flight.start) / flight.duration));
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      flight.group.position.lerpVectors(flight.from, flight.to, eased);
      flight.group.position.y += Math.sin(eased * Math.PI) * 0.22;
      flight.group.rotation.x = -eased * Math.PI / 2;
      flight.group.rotation.z = eased * 0.5;
      flight.group.scale.setScalar(1 - eased * 0.18);
      if (t >= 1) {
        flying.splice(i, 1);
        flight.onDone();
      }
    }

    renderer.render(scene, camera);
  }

  updateHud();
  setStatus('Drag to look around. Tap a card to pick it up, tap it again to play it.');
  if (loading) loading.hidden = true;
  frame();

  window.addEventListener('beforeunload', function () {
    running = false;
    fan.dispose();
    view.dispose();
  });

  return {
    view: view,
    room: room,
    characters: characters,
    fan: fan,
    mock: mock,
    settings: settings,
    selectCard: selectCard,
    playSelected: playSelected,
    drawCard: drawCard,
    // A small handle on the camera, so an automated check can look around
    // and take a picture of each side of the table.
    look: function (yaw, pitch) {
      cameraState.yaw = Math.max(-LIMITS.yaw, Math.min(LIMITS.yaw, yaw || 0));
      cameraState.pitch = Math.max(-LIMITS.pitch, Math.min(LIMITS.pitch, pitch || 0));
    },
    mixamo: mixamo,
    state: function () {
      return {
        hand: mock.hand.length,
        selected: mock.selected,
        played: mock.played.length,
        characters: characters.length,
        yaw: cameraState.yaw,
        pitch: cameraState.pitch,
        mixamo: {
          loading: mixamo.loading,
          loaded: mixamo.characters.length > 0,
          count: mixamo.characters.length,
          errors: mixamo.errors,
          sitting: mixamo.characters.every(function (entry) { return entry.character.sitting; }),
          seat: mixamo.seat,
          clips: mixamo.clipNames,
          bones: mixamo.characters.reduce(function (n, entry) {
            return n + entry.character.bones.length;
          }, 0),
          meshes: mixamo.characters.reduce(function (n, entry) {
            return n + entry.character.meshes.length;
          }, 0)
        }
      };
    },
    dispose: function () {
      running = false;
      fan.dispose();
      view.dispose();
    }
  };
}

/**
 * Start the prototype as soon as the page is ready.
 *
 * The prototype is a page of its own: nothing here is wired to the game
 * server, and nothing here can break a real match.
 */
function boot() {
  const prototype = startPrototype(document.body);
  window.PhoenixImmersive = prototype;
  return prototype;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
