/* PHOENIX - the lights the room was built with.
 *
 * The Neon Lounge was made in Blender, and every light fitting in it is a
 * piece of geometry with a glowing material: the panels in the ceiling, the
 * strips along the walls, the cyan rim round the table, the signs on the
 * far wall, the little red lamp on the cell door.
 *
 * Blender's area lights cannot travel in a glTF file, so none of that came
 * across - the fittings glow, but they do not LIGHT anything. These are
 * the lights that put back: one real light for each fitting the room
 * names, in the fitting's own colour, so the neon in the room is the
 * neon's own light and not a floodlight pretending to be one.
 *
 * The rules are by name, so a room that is re-exported from Blender with
 * the same names keeps its lighting.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';

/**
 * The fittings, and what each one is.
 *
 * `match` is the beginning of the object's name. `count` is how many
 * lights that kind of fitting gets - a long strip is lit from its middle
 * rather than from every centimetre of itself.
 */
const FITTINGS = [
  // The panels in the ceiling: the room's main light.
  { match: 'CEILING_LightPanel', colour: 0xddf0ff, intensity: 16, distance: 11, decay: 1.7, offset: -0.42, size: 1.7 },
  // The strips high on the walls: the cyan wash along the ceiling.
  { match: 'LED_WallStrip_Long', colour: 0x50d7ff, intensity: 6, distance: 8, decay: 1.9, offset: -0.25, high: true },
  { match: 'LED_WallStrip_Side', colour: 0x50d7ff, intensity: 6, distance: 8, decay: 1.9, offset: -0.25, high: true },
  // The strip round the table: the cyan edge the table is lit by.
  { match: 'TABLE_CyanRim', colour: 0x50d7ff, intensity: 7, distance: 5.5, decay: 2, offset: 0.16 },
  // The signs on the far wall.
  { match: 'BRAND_PHOENIX', colour: 0x50d7ff, intensity: 7, distance: 6, decay: 2, offset: 0.35 },
  { match: 'DISPLAY_', colour: 0x50d7ff, intensity: 5, distance: 6, decay: 2, offset: 0.35 },
  // The cell's little red lamp.
  { match: 'JAIL_LockLED', colour: 0xff4753, intensity: 4, distance: 3.4, decay: 2, offset: 0.2 },
  // The snack machine's shelves.
  { match: 'SNACK_ShelfLED', colour: 0xb67cff, intensity: 5, distance: 4.4, decay: 2, offset: 0.4 },
  // The customer support box in the corner.
  { match: 'DECOR_CustomerSupportBox', colour: 0xb67cff, intensity: 5, distance: 4.4, decay: 2, offset: 0.3 }
];

/** Every object in the room, by name. */
function named(root) {
  const found = {};
  root.traverse(function (object) {
    if (object.name && !found[object.name]) found[object.name] = object;
  });
  return found;
}

/**
 * Put the room's own lights back.
 *
 * `options`:
 *   quality  'low' keeps only the lights the room cannot do without
 */
export function createMapLights(root, options) {
  const settings = Object.assign({ quality: 'medium' }, options || {});
  const objects = named(root);
  const lights = [];

  // The fittings are found by name, so the room decides where its lights
  // are. A fitting that is not in the list is left alone.
  const wanted = [];
  Object.keys(objects).forEach(function (name) {
    FITTINGS.forEach(function (fitting) {
      if (name.indexOf(fitting.match) !== 0) return;
      wanted.push({ name: name, object: objects[name], fitting: fitting });
    });
  });

  // Two fittings of the same kind in the same place are one light.
  const seen = {};
  wanted.forEach(function (entry) {
    const key = entry.fitting.match;
    const box = new THREE.Box3().setFromObject(entry.object);
    const centre = box.getCenter(new THREE.Vector3());
    const where = centre.clone();
    where.y += entry.fitting.offset || 0;
    // The strips along the walls are lit from their middle.
    if (entry.fitting.size) {
      where.x = 0;
      where.z = 0;
    }
    const spot = Math.round(where.x * 2) + ':' + Math.round(where.y * 2) + ':' + Math.round(where.z * 2);
    const unique = key + '|' + spot;
    if (seen[unique]) return;
    seen[unique] = true;

    // On a low machine, only the fittings that carry the room are kept.
    if (settings.quality === 'low' && key !== 'CEILING_LightPanel' &&
        key !== 'TABLE_CyanRim') return;

    const light = new THREE.PointLight(
      entry.fitting.colour,
      entry.fitting.intensity,
      entry.fitting.distance,
      entry.fitting.decay
    );
    light.position.copy(where);
    light.name = 'lamp:' + entry.name;
    lights.push(light);
  });

  return {
    lights: lights,
    dispose: function () {
      lights.forEach(function (light) {
        if (light.parent) light.parent.remove(light);
        if (light.dispose) light.dispose();
      });
    }
  };
}
