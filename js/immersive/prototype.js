/* PHOENIX - the immersive (3D) table.
 *
 * The scene, the room, the people and the cards.
 *
 * The room is a MAP: somebody made it in Blender, it is loaded as it was
 * made, and the places the game needs - the seats, the laptops, the table,
 * the deck, the cell - are read out of it by the names of the objects. The
 * map says where things are; the card system says what they do, and the two
 * never talk.
 *
 * The camera is FIRST PERSON and SEATED: the player never stands, never
 * walks, and can only look around. The mouse or a finger turns the head,
 * within limits, so nobody can end up looking at the inside of their own
 * head or spinning themselves sick.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { createScene, webglAvailable, QUALITY, PALETTE } from './scene.js';
import { createCharacter, animateCharacter, animateDraw, animatePlay, CHARACTERS } from './characters.js';
import { createHand, createFan, MAX_HAND } from './hand.js';
import { createLaptop } from './laptop.js';
import { buildPoster, buildNotepad } from './props.js';
import { loadMixamoGLB, playAnimation, settleAnimation } from './mixamo.js';
import { loadMap, playAreaPoint } from './maps.js';
import { seatCharacter, lockToSeat, eyePoint, findBone } from './seating.js';
import { createDirector } from './director.js';
import { playCinematic, cardIdFor } from './cinematics.js';
import { createMultiplayer } from './multiplayer.js';
import { createTableUI } from './table-ui.js';
import { createInteractionBridge } from './interactions.js';

const CHARACTER_FILES = ['ash', 'brook', 'cass', 'dara', 'emery'];
/** The height of the seat of a chair, which is where a seated person's hips are. */
const SEAT_HEIGHT = 0.52;

function readSettings() {
  let saved = {};
  try {
    saved = JSON.parse(window.localStorage.getItem('phoenix.immersive.settings.v1') || '{}');
  } catch (error) {
    saved = {};
  }
  return Object.assign({ quality: 'medium', sensitivity: 1, reducedMotion: false }, saved);
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem('phoenix.immersive.settings.v1', JSON.stringify(settings));
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
  const caption = root.querySelector('#immersive-caption');

  if (!webglAvailable()) {
    if (loading) loading.hidden = true;
    if (failure) failure.hidden = false;
    return null;
  }

  const settings = readSettings();
  const view = createScene(stage, { quality: settings.quality });
  const { renderer, scene, camera } = view;

  /* ---- the player: seated, in the first person ---- */

  const cameraState = { yaw: 0, baseYaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0, pointerId: null, moved: 0 };
  const head = new THREE.Group();
  scene.add(head);
  camera.position.set(0, 0, 0);
  head.add(camera);

  const look = CHARACTERS[0];
  const hands = createHand(camera, { skin: look.skin, sleeve: look.shirt });
  const fan = createFan(camera, {});

  /* ---- what is on the table ---- */

  const state = {
    map: null,
    seats: [],
    laptops: [],
    characters: [],
    mixamo: { loading: true, characters: [], errors: [], clipNames: [] },
    hand: [],
    selected: -1,
    played: []
  };

  /**
   * Which seat the local player is in.
   *
   * The server says, once the match starts. Until then it is the first
   * seat, and the player is the camera there.
   */
  let localSeat = 0;

  /**
   * The server's own snapshot.
   *
   * This is the SAME shape the 2D game keeps: one object, replaced every
   * time the server says something. Nothing in this file works out what is
   * legal, or what a card does - the server has already done all of that.
   */
  let snapshot = null;
  /** The card the player has picked up out of the fan. */
  let selected = -1;
  /** The cards that have been played to the table, in order. */
  const played = [];

  /* ---- the connection to the real game ---- */

  /**
   * The effect journal.
   *
   * The server publishes what happened in a safe form: which card, who
   * played it, who it was aimed at, and whether it did anything at all. The
   * cursor hands over only what is new, so a player who reconnects does not
   * see the whole match again - and everybody sees the same thing, because
   * it all comes from the server.
   */
  const effectCursor = window.PhoenixEffects ? window.PhoenixEffects.cursor() : null;
  let cinematicChain = Promise.resolve();

  const online = createMultiplayer({
    onState: function (next) {
      applyState(next);
    },
    onMessage: function (message) {
      handleMessage(message);
    },
    onRooms: function (rooms) {
      ui.setRooms(rooms);
    },
    onStatus: function (line, kind) {
      ui.setStatus(line, kind);
    }
  });

  const interactions = createInteractionBridge({
    root: root,
    onNotice: function (message) { setStatus(message); }
  });

  const ui = createTableUI({
    root: root,
    client: online,
    onPlay: function (cardId, targetId) {
      playCard(cardId, targetId);
    },
    onNotice: function (message) {
      setStatus(message);
    }
  });

  // The overlays in the 2D game ask the client for the state. This is the
  // same thing, so they work here unchanged.
  window.PhoenixOnline = {
    getState: function () { return online.getState(); },
    leave: function () { online.leave(); },
    join: function (code) { online.joinRoom(code); }
  };

  /**
   * A new snapshot from the server.
   *
   * Everything the room shows comes from here: the hand, the seat, the
   * scores, the names, and the cards that have just been played.
   */
  function applyState(next) {
    const previousSeat = snapshot ? snapshot.seat : -1;
    snapshot = next;

    // The hand is the server's, always.
    fan.set(handCards());
    if (selected >= handCards().length) selected = -1;

    // The camera moves to the seat the server says is ours.
    if (typeof next.seat === 'number' && next.seat !== previousSeat) {
      setLocalSeat(next.seat);
    }

    // The bank screens show their own owner's balance. The scores are
    // public, so every screen is showing the truth.
    state.laptops.forEach(function (entry) {
      const owner = next.players && next.players[entry.seat] ? next.players[entry.seat] : null;
      if (owner) entry.laptop.bank.set(owner.points || 0);
    });

    // The overlays that ask a question.
    interactions.onState(next);

    // The table: the lobby, the players, the turn.
    ui.setState(next);

    // What has just been played, and the show that goes with it.
    playJournal(next);

    updateHud();
  }

  /** The cards that have been played since the last snapshot, and their show. */
  function playJournal(next) {
    if (!effectCursor || !next.effects) return;
    const events = effectCursor.consume(next.effects);
    events.forEach(function (event) {
      const cardId = cardIdFor(event.key);
      if (!cardId) return;
      const seatEvent = {
        type: 'card',
        cardId: cardId,
        seat: event.actor,
        targetSeat: event.target
      };
      cinematicChain = cinematicChain
        .then(function () {
          return playCinematic(cardId, director.context, [seatEvent], {
            outcome: event.outcome,
            reducedMotion: settings.reducedMotion
          });
        })
        .catch(function () { return null; });
    });
  }

  /** Anything the server said that is not a snapshot. */
  function handleMessage(message) {
    if (!message || !message.type) return;
    if (message.type === 'error') {
      setStatus(message.message || 'That was not allowed.');
      // The hand is put back exactly as the server sees it.
      fan.set(handCards());
      updateHud();
      return;
    }
    if (message.type === 'roomClosed') {
      setStatus(message.message || 'The room has closed.');
      return;
    }
    if (message.type === 'kicked') {
      setStatus(message.message || 'You have been removed from the room.');
      return;
    }
    if (message.type === 'rickroll') {
      setStatus('Somebody has been Rickrolled.');
      return;
    }
    if (message.type === 'interact-ack') {
      setStatus('Your answer has been recorded.');
    }
  }

  /* ---- the director and the cinematics ---- */

  const director = createDirector({
    scene: scene,
    camera: camera,
    cameraState: cameraState,
    cameraPosition: new THREE.Vector3(),
    characters: state.characters,
    laptops: state.laptops,
    seats: 5,
    // Where the room says each seat is.
    seatAt: function (seat) { return seatPlace(seat); },
    tableRadius: 1.9,
    tableHeight: 1.0,
    lights: { lamp: view.lamp, hemi: view.hemi, hemiBase: view.hemi.intensity },
    caption: caption,
    localSeat: 0
  });

  /* ---- the map ---- */

  const mapId = root.getAttribute('data-map') || 'modern-gaming-lounge';
  loadMap(mapId, { seats: 5 })
    .then(function (map) {
      state.map = map;
      scene.add(map.root);

      // The room's own lights, and the ones the scene already had.
      map.lights.forEach(function (light) { scene.add(light); });

      state.seats = map.anchors.seats.slice(0, 5);

      // The table's own height, so the cinematics put things on the table
      // and not in the air above it.
      if (map.anchors.table) {
        director.context.tableHeight = map.anchors.table.surface;
        director.context.tableRadius = Math.max(map.anchors.table.radiusX, map.anchors.table.radiusZ);
      }

      // The local player sits in their own seat, and the camera is their
      // eyes. The characters are put on the chairs as they arrive; until
      // then the camera is at the height the seat says.
      const mine = state.seats[localSeat];
      if (mine) {
        head.position.set(mine.position.x, mine.eye || 1.2, mine.position.z);
        const table = map.anchors.table;
        if (table) {
          const toTable = Math.atan2(table.centre.x - mine.position.x, table.centre.z - mine.position.z);
          cameraState.baseYaw = toTable + Math.PI;
        }
      }

      // The laptops: the room says where they stand, and the game puts a
      // LIVE bank screen on each of them.
      const surface = map.anchors.table ? map.anchors.table.surface : 1.0;
      state.laptops = map.anchors.laptops.map(function (anchor) {
        const laptop = createLaptop({});
        laptop.group.position.set(anchor.position.x, surface + 0.002, anchor.position.z);
        laptop.group.quaternion.copy(anchor.quaternion);
        scene.add(laptop.group);
        return { seat: anchor.seat - 1, laptop: laptop, anchor: anchor };
      });

      // The PHOENIX decorations, on the new room's walls.
      buildPoster(scene, { x: -5.86, z: -1.2, ry: Math.PI / 2 });
      if (map.anchors.counter) {
        buildNotepad(scene, {
          x: map.anchors.counter.x,
          y: map.anchors.counterTop + 0.01,
          z: map.anchors.counter.z
        });
      }

      // The cell, where the room says it is, for the Judge card.
      if (map.anchors.cell) {
        director.context.cellPoint = map.anchors.cell.clone();
      }

      // The people: one at each seat, once their model has arrived.
      placeCharacters();
    })
    .catch(function (error) {
      const line = root.querySelector('#immersive-status');
      if (line) line.textContent = 'The room could not be loaded: ' +
        (error && error.message ? error.message : String(error));
    });

  /* ---- the people ---- */

  function seatPlace(seat) {
    const entry = state.seats[seat];
    if (!entry) return null;
    return {
      position: entry.position.clone(),
      angle: entry.angle,
      // The top of the cushion: where the hips go.
      seatTop: entry.seatTop,
      eye: entry.eye,
      // Just behind the chair, where somebody stands up from it.
      standing: entry.position.clone().add(
        new THREE.Vector3(Math.sin(entry.angle), 0, Math.cos(entry.angle)).multiplyScalar(0.55))
    };
  }

  function placeCharacters() {
    // Every seat gets a person. The local player's own body is in the room
    // like everybody else's - the other players can see it - but the player
    // cannot see it themselves, because they are looking out of its eyes.
    CHARACTER_FILES.slice(0, state.seats.length).forEach(function (name, index) {
      const seat = index;
      const place = seatPlace(seat);
      if (!place) return;
      loadMixamoGLB('assets/mixamo/characters/' + name + '.glb', { name: name })
        .then(function (loaded) {
          scene.add(loaded.group);
          state.characters[seat] = loaded;
          state.mixamo.characters.push({ seat: seat, character: loaded, name: name });
          state.mixamo.clipNames = loaded.clipNames;

          // The sitting pose is settled with no fade and the mixer stepped
          // by hand, so the pose that is measured is the pose the character
          // is actually going to be in.
          return settleAnimation(loaded, 'sittingIdle', { at: 0.6 }).then(function (played) {
            loaded.sitting = !!played;
            // Then the person is measured, and put on the chair.
            seatCharacter(loaded, place);
            // The camera is the local player's eyes.
            if (seat === localSeat) putCameraAtSeat(seat);
          });
        })
        .catch(function (error) {
          state.mixamo.errors.push(name + ': ' +
            (error && error.message ? error.message : String(error)));
        })
        .then(function () {
          if (state.mixamo.characters.length + state.mixamo.errors.length >=
              state.seats.length) {
            state.mixamo.loading = false;
            const line = root.querySelector('#immersive-status');
            if (line) {
              line.textContent = state.mixamo.errors.length
                ? state.mixamo.errors.length + ' character(s) could not be loaded: ' + state.mixamo.errors[0]
                : state.mixamo.characters.length + ' people are sitting at the table.';
            }
          }
        });
    });
  }

  /**
   * The camera is the local player's eyes.
   *
   * It is put where their character's head is - which is the real height of
   * a seated person's eyes, measured from the model rather than guessed -
   * and it looks at the middle of the table.
   */
  function putCameraAtSeat(seat) {
    const mine = state.seats[seat];
    const character = state.characters[seat];
    if (!mine) return;

    // The body of the player is in the room, but the player is inside it.
    if (character) character.group.visible = false;

    const table = state.map && state.map.anchors.table;
    if (table) {
      const toTable = Math.atan2(table.centre.x - mine.position.x, table.centre.z - mine.position.z);
      // The camera looks along its own -Z, so the base turn is the angle of
      // the table, turned back on itself.
      cameraState.baseYaw = toTable + Math.PI;
    } else {
      cameraState.baseYaw = 0;
    }

    const point = character ? eyePoint(character) : null;
    if (point) {
      head.position.copy(point);
    } else {
      head.position.set(mine.position.x, mine.eye || 1.2, mine.position.z);
    }
    cameraState.yaw = 0;
    cameraState.pitch = 0;
  }

  /* ---- the camera: seated, looking around, and nothing more ---- */

  const LIMITS = { yaw: 1.75, pitch: 0.62 };

  /**
   * Move the local player to a different seat.
   *
   * The server decides which seat a player has; this only tells the room
   * where to put the camera and which body belongs to the player.
   */
  function setLocalSeat(seat) {
    const next = Number(seat);
    if (!isFinite(next) || next < 0 || next >= state.seats.length) return false;
    if (next === localSeat) return true;
    // The old body is seen again; the new one is where the camera goes.
    const old = state.characters[localSeat];
    if (old) old.group.visible = true;
    localSeat = next;
    const character = state.characters[localSeat];
    if (character) character.group.visible = false;
    putCameraAtSeat(localSeat);
    return true;
  }

  function lookBy(dx, dy) {
    const speed = 0.0032 * settings.sensitivity;
    cameraState.yaw = Math.max(-LIMITS.yaw, Math.min(LIMITS.yaw, cameraState.yaw - dx * speed));
    cameraState.pitch = Math.max(-LIMITS.pitch, Math.min(LIMITS.pitch, cameraState.pitch - dy * speed));
  }

  const canvas = renderer.domElement;

  canvas.addEventListener('pointerdown', function (event) {
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

  /** The cards in your hand, as card records. */
  function handCards() {
    const Cards = window.PhoenixCards;
    if (!Cards || !snapshot || !Array.isArray(snapshot.hand)) return [];
    return snapshot.hand.map(function (id) { return Cards.byId(id); }).filter(Boolean);
  }

  function selectCard(index) {
    selected = fan.toggle(index);
    updateHud();
  }

  /**
   * Play the card that is picked up.
   *
   * If the server says the card may be aimed at somebody, the picker opens
   * with exactly those people on it and nothing is sent until the player
   * has chosen. If it may not, it is sent straight away.
   */
  function playSelected() {
    if (selected < 0) return;
    const card = handCards()[selected];
    if (!card) {
      setStatus('That card is not in your hand any more.');
      return;
    }
    ui.chooseCard(card);
  }

  /**
   * The card is played.
   *
   * The card is taken out of the hand and sent to the server, and it flies
   * to the table on its way. The hand itself is always the server's: the
   * next snapshot puts it back exactly as the server sees it, so a move
   * that is refused simply comes back.
   */
  function playCard(cardId, targetId) {
    const hand = handCards();
    const index = hand.findIndex(function (card) { return card.id === cardId; });
    if (index < 0) return;

    const entry = fan.take(index);
    if (entry) flyToTable(entry);
    selected = -1;
    online.play(cardId, targetId);
    setStatus('Played ' + (hand[index] ? hand[index].name : cardId) + '.');
    updateHud();
  }

  /** A card travelling from the player's hands to the table. */
  function flyToTable(entry) {
    const mesh = entry.mesh;
    const cardGroup = new THREE.Group();
    cardGroup.add(mesh);
    scene.add(cardGroup);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    cardGroup.position.copy(camera.getWorldPosition(new THREE.Vector3()));
    cardGroup.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));

    const anchors = state.map ? state.map.anchors : {};
    const area = playAreaPoint(anchors, played.length);
    const to = new THREE.Vector3(
      anchors.playAreas && anchors.playAreas.length
        ? anchors.playAreas[played.length % anchors.playAreas.length].x
        : 0,
      area,
      anchors.playAreas && anchors.playAreas.length
        ? anchors.playAreas[played.length % anchors.playAreas.length].z
        : (anchors.table ? anchors.table.centre.z : 0)
    );
    flying.push({
      group: cardGroup,
      from: cardGroup.position.clone(),
      to: to,
      start: performance.now(),
      duration: settings.reducedMotion ? 120 : 520,
      onDone: function () {
        scene.remove(cardGroup);
        mesh.geometry.dispose();
        if (entry.faceMaterial.map && entry.faceMaterial.map !== fan.backTexture) {
          entry.faceMaterial.map.dispose();
        }
        entry.faceMaterial.dispose();
        played.push(entry.card);
        updateHud();
      }
    });
  }

  /* ---- the HUD ---- */

  const hudSelected = hud.querySelector('#immersive-selected');
  const hudHand = hud.querySelector('#immersive-hand');
  const hudStatus = hud.querySelector('#immersive-status');

  function setStatus(message) {
    if (hudStatus) hudStatus.textContent = message;
  }

  function updateHud() {
    const hand = handCards();
    if (hudSelected) {
      hudSelected.textContent = selected >= 0 && hand[selected]
        ? hand[selected].name
        : 'Nothing selected';
    }
    if (hudHand) hudHand.textContent = hand.length + ' of ' + MAX_HAND + ' cards in hand';
  }

  const hudQuality = hud.querySelector('#immersive-quality');
  const hudSensitivity = hud.querySelector('#immersive-sensitivity');
  const hudReduced = hud.querySelector('#immersive-reduced');

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
  const rehearseButton = hud.querySelector('#immersive-rehearse');
  if (rehearseButton) rehearseButton.addEventListener('click', rehearse);

  /* ---- the connection ---- */

  // The table is opened as soon as the page is ready: the room is a real
  // room, on the real server, and the player joins it from there.
  online.connect();

  /* ---- the rehearsal: the card cinematics, on demand ---- */

  /**
   * Play the cinematics one after another, with the events the server would
   * send. It is how the cinematics are looked at without a table of real
   * players.
   */
  function rehearse() {
    const script = [
      { cardId: 'steal', seat: 1, targetSeat: 3 },
      { cardId: 'judge', seat: 0, targetSeat: 4 },
      { cardId: 'hostage', seat: 2, targetSeat: 3 },
      { cardId: 'mimic', seat: 1, targetSeat: 1 },
      { cardId: 'nothing', seat: 5, targetSeat: -1 }
    ];
    let chain = Promise.resolve();
    script.forEach(function (step) {
      chain = chain.then(function () {
        const events = [
          { type: 'card', cardId: step.cardId, seat: step.seat, targetSeat: step.targetSeat },
          { type: 'result', cardId: step.cardId, text: '' }
        ];
        return playCinematic(step.cardId, director.context, events);
      });
    });
    chain.then(function () {
      setStatus('That was the whole lot of them.');
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

    head.rotation.y = cameraState.baseYaw + cameraState.yaw;
    head.rotation.x = cameraState.pitch;

    // The people are Mixamo models, so their own animations are what move
    // them: the mixer, and nothing else. And then they are put back on
    // their chairs, exactly, whatever the animation did.
    state.characters.forEach(function (character, seat) {
      if (!character) return;
      character.mixer.update(delta);
      const place = seatPlace(seat);
      if (place) lockToSeat(character, place);
    });

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

    // The balances on the screens.
    state.laptops.forEach(function (entry) {
      entry.laptop.bank.tick();
    });

    // Where the camera is, for the cinematics that want to look at it.
    camera.getWorldPosition(director.context.cameraPosition);

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
    state: state,
    fan: fan,
    settings: settings,
    director: director,
    online: online,
    ui: ui,
    interactions: interactions,
    selectCard: selectCard,
    playSelected: playSelected,
    playCard: playCard,
    rehearse: rehearse,
    /** Feed a snapshot in, exactly as the server would. */
    applyState: applyState,
    /**
     * Move the local player to a different seat.
     *
     * The server decides which seat a player has; this only tells the room
     * where to put the camera and which body belongs to the player.
     */
    setLocalSeat: setLocalSeat,
    localSeat: function () { return localSeat; },
    // Look around, for the check and for the cinematics.
    look: function (yaw, pitch) {
      cameraState.yaw = Math.max(-LIMITS.yaw, Math.min(LIMITS.yaw, yaw || 0));
      cameraState.pitch = Math.max(-LIMITS.pitch, Math.min(LIMITS.pitch, pitch || 0));
    },
    stateSnapshot: function () {
      // Where each character actually is, so the check can prove that they
      // are on their chairs and not in them.
      const seatings = state.characters.map(function (character, seat) {
        if (!character) return null;
        const point = function (name) {
          const bone = findBone(character, name);
          if (!bone) return null;
          return bone.getWorldPosition(new THREE.Vector3()).y;
        };
        return {
          seat: seat,
          hips: point('Hips'),
          head: point('Head'),
          toe: point('LeftToeBase'),
          seatTop: state.seats[seat] ? state.seats[seat].seatTop : null,
          visible: character.group.visible
        };
      });
      return {
        hand: handCards().length,
        selected: selected,
        played: played.length,
        seats: state.seats.length,
        laptops: state.laptops.length,
        characters: state.mixamo.characters.length,
        localSeat: localSeat,
        yaw: cameraState.yaw,
        pitch: cameraState.pitch,
        seatings: seatings,
        camera: camera.getWorldPosition(new THREE.Vector3()).toArray(),
        mixamo: {
          loading: state.mixamo.loading,
          loaded: state.mixamo.characters.length > 0,
          count: state.mixamo.characters.length,
          errors: state.mixamo.errors,
          bones: state.mixamo.characters.reduce(function (n, entry) {
            return n + entry.character.bones.length;
          }, 0),
          meshes: state.mixamo.characters.reduce(function (n, entry) {
            return n + entry.character.meshes.length;
          }, 0),
          sitting: state.mixamo.characters.every(function (entry) {
            return !!entry.character.sitting;
          })
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
 * Start the table as soon as the page is ready.
 *
 * The 3D table is another way of looking at the same multiplayer game: it
 * joins the same server, plays by the same rules, and the server decides
 * everything. Nothing on this page can change a match that the 2D game
 * could not change.
 */
function boot() {
  window.PhoenixImmersive = startPrototype(document.body);
  return window.PhoenixImmersive;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

