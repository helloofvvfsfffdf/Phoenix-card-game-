/* PHOENIX - putting something on a screen in the room.
 *
 * The laptop screens are real screens, and sometimes something has to
 * PLAY on one: the Mimic's video, for instance.
 *
 * A video cannot be painted onto a texture - a YouTube player is a
 * document, not a picture - so the player is put in the page and the page
 * is put exactly over the laptop's screen, in the right place, at the
 * right size, at the right angle.
 *
 * The four corners of the screen are worked out in the room and then
 * projected onto the page. The four points that come back are not a
 * rectangle - they are a quadrilateral, because the screen is seen at an
 * angle - so a plain rotate-and-scale would be wrong. What is used
 * instead is the mapping that takes a square onto a quadrilateral exactly:
 * the same mapping a camera uses when it photographs a rectangle from
 * the side. It is written as one matrix3d, and the browser does the rest.
 *
 * The result is a video that is genuinely ON the laptop: it tilts with the
 * lid, it goes behind the table when the laptop does, and it is the right
 * shape from every seat.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';

/**
 * Solve eight equations with eight unknowns.
 *
 * Straight Gaussian elimination with partial pivoting: the numbers here
 * are small and well behaved, and this is not a place for anything clever.
 */
function solve8(matrix, values) {
  const size = 8;
  const a = matrix.map(function (row, index) { return row.concat([values[index]]); });
  for (let column = 0; column < size; column++) {
    // Find the biggest number in this column and use it.
    let biggest = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[biggest][column])) biggest = row;
    }
    if (Math.abs(a[biggest][column]) < 1e-9) return null;
    const swap = a[column];
    a[column] = a[biggest];
    a[biggest] = swap;
    // Take the number out of the rows below.
    for (let row = column + 1; row < size; row++) {
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= size; k++) a[row][k] -= factor * a[column][k];
    }
  }
  // And back up.
  const answer = new Array(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    let sum = a[row][size];
    for (let k = row + 1; k < size; k++) sum -= a[row][k] * answer[k];
    answer[row] = sum / a[row][row];
  }
  return answer;
}

/**
 * The mapping that takes a square onto a quadrilateral.
 *
 * The four corners of the square are (0,0), (1,0), (1,1) and (0,1); the
 * four corners of the quadrilateral are the points they have to land on.
 */
export function squareToQuad(quad) {
  const source = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const matrix = [];
  const values = [];
  for (let i = 0; i < 4; i++) {
    const u = source[i][0];
    const v = source[i][1];
    const x = quad[i][0];
    const y = quad[i][1];
    matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    values.push(x);
    matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    values.push(y);
  }
  const h = solve8(matrix, values);
  if (!h) return null;
  return { a: h[0], b: h[1], c: h[2], d: h[3], e: h[4], f: h[5], g: h[6], h: h[7] };
}

/**
 * Put an element over a screen in the room.
 *
 * `options`:
 *   camera   the camera the screen is seen through
 *   mesh     the screen: a plane whose front face is +Z
 *   element  the page element to put over it
 *   width    the element's width, in pixels
 *   height   the element's height, in pixels
 */
export function createScreenMap(options) {
  const settings = Object.assign({
    camera: null,
    mesh: null,
    element: null,
    width: 512,
    height: 288
  }, options || {});

  const corners = [
    new THREE.Vector3(-0.5, 0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(-0.5, -0.5, 0)
  ];

  const world = new THREE.Vector3();
  const projected = new THREE.Vector3();

  /**
   * Work out where the screen is on the page, and put the element there.
   *
   * Returns false when the screen cannot be seen - it is behind the
   * camera, or it is off the page - and the element is hidden.
   */
  function update() {
    const element = settings.element;
    const mesh = settings.mesh;
    const camera = settings.camera;
    if (!element || !mesh || !camera) return false;

    const width = mesh.geometry.parameters ? mesh.geometry.parameters.width : 1;
    const height = mesh.geometry.parameters ? mesh.geometry.parameters.height : 1;

    const points = [];
    let behind = false;
    for (let i = 0; i < corners.length; i++) {
      world.copy(corners[i]).multiply(new THREE.Vector3(width, height, 1));
      mesh.localToWorld(world);
      projected.copy(world).project(camera);
      // Behind the camera, the projection turns inside out.
      if (projected.z > 1 || projected.z < -1) behind = true;
      points.push([
        (projected.x * 0.5 + 0.5) * window.innerWidth,
        (-projected.y * 0.5 + 0.5) * window.innerHeight
      ]);
    }
    if (behind) {
      element.style.visibility = 'hidden';
      return false;
    }

    const map = squareToQuad(points);
    if (!map) {
      element.style.visibility = 'hidden';
      return false;
    }

    // The matrix: the element's own pixels, mapped onto the quadrilateral.
    const w = settings.width;
    const h = settings.height;
    const matrix = [
      map.a / w, map.d / w, 0, map.g / w,
      map.b / h, map.e / h, 0, map.h / h,
      0, 0, 1, 0,
      map.c, map.f, 0, 1
    ];
    element.style.transform = 'matrix3d(' + matrix.join(',') + ')';
    element.style.visibility = 'visible';
    return true;
  }

  return {
    update: update,
    /** Put the element away. */
    hide: function () {
      if (settings.element) settings.element.style.visibility = 'hidden';
    },
    dispose: function () {
      if (settings.element) settings.element.style.visibility = 'hidden';
    }
  };
}
