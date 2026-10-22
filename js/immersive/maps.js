/* PHOENIX - the maps.
 *
 * A map is a room somebody built, loaded as a glTF file, with the places the
 * game needs picked out of it: where the seats are, where the laptops stand,
 * where the table is, where the deck sits and where the cell is.
 *
 * The map is kept well away from the card system. A map says where things
 * ARE; it never says what they DO. That is what lets a second, third and
 * fourth room be dropped in later without the cards being touched.
 *
 * The anchors are found by the names of the objects in the file, so a room
 * that is re-exported from Blender with the same names keeps working.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { createMapLights } from './map-lights.js';

/**
 * The rooms there are.
 *
 * Map 01 is the Neon Lounge. The others are named so the shape of the thing
 * is clear, but only the first one exists.
 */
export const MAPS = {
  'modern-gaming-lounge': {
    id: 'modern-gaming-lounge',
    name: 'Modern Gaming Lounge',
    file: 'assets/maps/modern-gaming-lounge.glb',
    seats: 5
  }
};

/** Find an object in the loaded room by its name. */
function find(object, name) {
  let found = null;
  object.traverse(function (child) {
    if (!found && child.name === name) found = child;
  });
  return found;
}

/** Every object whose name starts with a prefix. */
function findAll(object, prefix) {
  const found = [];
  object.traverse(function (child) {
    if (child.name && child.name.indexOf(prefix) === 0) found.push(child);
  });
  return found;
}

/**
 * Work out where everything is.
 *
 * The seats are read from the cushions, the laptops from their bases, the
 * table from the felt and the cell from the door of the jail - all by name,
 * so the room can be re-exported without this file being changed.
 */
function readAnchors(root) {
  const anchors = {
    seats: [],
    laptops: [],
    table: null,
    deck: null,
    playAreas: [],
    cell: null,
    cellDoor: null
  };

  const felt = find(root, 'TABLE_GreenFelt') || find(root, 'TABLE_Felt_Upper');
  if (felt) {
    felt.geometry.computeBoundingBox();
    const box = felt.geometry.boundingBox;
    const centre = felt.getWorldPosition(new THREE.Vector3());
    anchors.table = {
      centre: new THREE.Vector3(centre.x, box.min.y, centre.z),
      surface: box.min.y,
      radiusX: (box.max.x - box.min.x) / 2,
      radiusZ: (box.max.z - box.min.z) / 2
    };
  }

  for (let i = 1; i <= 8; i++) {
    const cushion = find(root, 'SEAT_' + i + '_Cushion');
    if (!cushion) continue;
    const position = cushion.getWorldPosition(new THREE.Vector3());
    // The top of the cushion is where a seated person's hips are.
    cushion.geometry.computeBoundingBox();
    const seatTop = new THREE.Box3().setFromObject(cushion).max.y;
    // The back of the chair is pushed away from the table, so the direction
    // from the table to the seat is where the person is looking.
    const direction = new THREE.Vector3(position.x, 0, position.z);
    if (anchors.table) {
      direction.sub(new THREE.Vector3(anchors.table.centre.x, 0, anchors.table.centre.z));
    }
    const angle = Math.atan2(direction.x, direction.z);
    anchors.seats.push({
      index: anchors.seats.length,
      position: position.clone(),
      angle: angle,
      // Where the hips go, and where the eyes are.
      seatTop: seatTop,
      eye: seatTop + 0.58
    });
  }

  for (let i = 1; i <= 8; i++) {
    const base = find(root, 'LAPTOP_' + i + '_Base');
    if (!base) continue;
    const display = find(root, 'LAPTOP_' + i + '_Display');
    const position = base.getWorldPosition(new THREE.Vector3());
    const rotation = base.getWorldQuaternion(new THREE.Quaternion());
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    anchors.laptops.push({
      index: anchors.laptops.length,
      seat: i,
      position: position.clone(),
      quaternion: rotation.clone(),
      // Where the screen is, and which way it looks.
      screen: display ? display.getWorldPosition(new THREE.Vector3()) : position.clone(),
      facing: facing.clone()
    });
  }

  const deck = find(root, 'CARDS_Deck');
  if (deck) {
    const position = deck.getWorldPosition(new THREE.Vector3());
    anchors.deck = { position: position.clone() };
  }
  for (let j = 0; j < 8; j++) {
    const area = find(root, 'CARDS_PlayArea_' + j);
    if (!area) continue;
    anchors.playAreas.push(area.getWorldPosition(new THREE.Vector3()));
  }

  const door = find(root, 'JAIL_SlidingDoor_Frame');
  if (door) {
    const position = door.getWorldPosition(new THREE.Vector3());
    anchors.cellDoor = position.clone();
    // Inside the cell, a little way past the door.
    anchors.cell = new THREE.Vector3(position.x, 0, position.z + 1.4);
  }
  const sentence = find(root, 'JAIL_SentenceMonitor');
  if (sentence) {
    anchors.sentenceMonitor = sentence.getWorldPosition(new THREE.Vector3());
  }

  // The walls the game's own decorations hang on.
  const counter = find(root, 'SNACK_Counter');
  if (counter) {
    counter.geometry.computeBoundingBox();
    anchors.counter = counter.getWorldPosition(new THREE.Vector3());
    anchors.counterTop = anchors.counter.y + counter.geometry.boundingBox.max.y;
  }

  // The room made its own laptops, with a modelled screen and a picture of
  // a bank on it. The game puts a LIVE bank screen on the table instead, so
  // the room's laptops are taken out - but only after their positions have
  // been read, because that is where the live ones go.
  findAll(root, 'LAPTOP_').forEach(function (object) {
    object.parent.remove(object);
  });

  return anchors;
}

/**
 * Load a map.
 *
 * The room comes in exactly as it was made: its own materials, its own
 * colours, its own lights and its own positions. Nothing about it is
 * rebuilt or restyled here.
 */
export function loadMap(id, options) {
  const settings = Object.assign({ seats: 5, quality: 'medium' }, options || {});
  const map = MAPS[id];
  if (!map) return Promise.reject(new Error('There is no map called ' + id));

  return new Promise(function (resolve, reject) {
    const loader = new GLTFLoader();
    loader.load(map.file, function (gltf) {
      const root = gltf.scene;
      root.name = 'map:' + id;

      // The room's own lights: the ceiling panels and the key over the table.
      const lights = [];
      root.traverse(function (object) {
        if (object.isLight) lights.push(object);
      });

      // And the lights the room was built with. Blender's area lights cannot
      // travel in a glTF file, so the fittings glow but do not light; these
      // put that back, one light for each fitting the room names.
      const fittings = createMapLights(root, { quality: settings.quality });
      fittings.lights.forEach(function (light) { lights.push(light); });

      // The emissive materials in a glTF come through as standard materials
      // with an emissive colour, which Three already reads; nothing to do.

      resolve({
        id: id,
        name: map.name,
        root: root,
        lights: lights,
        anchors: readAnchors(root),
        seatCount: settings.seats
      });
    }, undefined, function (error) {
      reject(new Error('The map could not be loaded: ' +
        (error && error.message ? error.message : 'the file could not be read')));
    });
  });
}

/**
 * A point on the table, in the middle of one of the play areas.
 *
 * The played cards land on the table where the room says they should.
 */
export function playAreaPoint(anchors, index) {
  if (!anchors.playAreas || !anchors.playAreas.length) {
    return anchors.table ? anchors.table.surface + 0.02 : 0.8;
  }
  const area = anchors.playAreas[index % anchors.playAreas.length];
  return area.y + 0.01;
}
