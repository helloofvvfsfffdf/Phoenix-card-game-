/* PHOENIX - the shapes the room is built from.
 *
 * Nothing here is a bare cube. A turned table leg is turned, a chair back
 * has spindles, a door has panels, and a picture frame is a frame. These
 * helpers make that possible without a modelling package.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';

/**
 * A rounded box.
 *
 * Made by extruding a rounded rectangle with a small bevel, which gives the
 * soft edges that make furniture read as furniture rather than as boxes.
 */
export function roundedBox(width, height, depth, radius, bevel) {
  const r = Math.min(radius, width / 2 - 0.001, height / 2 - 0.001);
  const shape = new THREE.Shape();
  const w = width / 2 - r;
  const h = height / 2 - r;
  shape.moveTo(-w, -height / 2 + 0);
  shape.absarc(w, -h, r, -Math.PI / 2, 0, false);
  shape.absarc(w, h, r, 0, Math.PI / 2, false);
  shape.absarc(-w, h, r, Math.PI / 2, Math.PI, false);
  shape.absarc(-w, -h, r, Math.PI, Math.PI * 1.5, false);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - (bevel || 0) * 2),
    bevelEnabled: bevel !== 0,
    bevelThickness: bevel || 0.006,
    bevelSize: bevel || 0.006,
    bevelSegments: 1,
    curveSegments: 4
  });
  geometry.translate(0, 0, -depth / 2 + (bevel || 0));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A turned part.
 *
 * `profile` is a list of [radius, height] pairs, from the bottom to the top.
 * A table leg, a chair leg, a lamp stem and a decanter are all the same
 * shape of idea.
 */
export function turned(profile, segments) {
  const points = profile.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
  const geometry = new THREE.LatheGeometry(points, segments || 12);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A picture frame: a moulding round a hole.
 */
export function frameGeometry(width, height, thickness, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(-width / 2, height / 2);
  shape.closePath();
  const hole = new THREE.Path();
  const inner = width / 2 - thickness;
  const innerH = height / 2 - thickness;
  hole.moveTo(-inner, -innerH);
  hole.lineTo(-inner, innerH);
  hole.lineTo(inner, innerH);
  hole.lineTo(inner, -innerH);
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008,
    bevelSegments: 1, curveSegments: 2
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A panelled door: a frame, and raised panels inside it.
 */
export function panelledDoor(width, height, panels) {
  const group = new THREE.Group();
  const stile = 0.16;
  const rail = 0.16;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.05),
    null
  );
  group.add(board);
  const rows = panels === 2 ? [0.5, 0.5] : [0.34, 0.32, 0.34];
  let top = height / 2 - rail;
  rows.forEach(function (fraction) {
    const panelH = height * fraction - rail;
    top -= panelH;
    const panelW = width - stile * 2;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(panelW, panelH, 0.022),
      null
    );
    panel.position.set(0, top + panelH / 2, 0.036);
    group.add(panel);
    const bead = new THREE.Mesh(
      new THREE.BoxGeometry(panelW - 0.06, panelH - 0.06, 0.012),
      null
    );
    bead.position.set(0, top + panelH / 2, 0.05);
    group.add(bead);
    top -= rail;
  });
  group.userData.board = board;
  group.userData.panels = group.children.slice(1);
  return group;
}

/**
 * A shape built from a list of points, extruded - used for the skirting and
 * the picture rail, which are moulded rather than flat.
 */
export function moulding(points, length, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: length, bevelEnabled: false, curveSegments: 2
  });
  geometry.translate(0, 0, -length / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Merge a list of meshes into one geometry.
 *
 * The parts that never move - a chair's four legs, the bars of a cell - are
 * all the same material, so they can be one mesh and one draw call instead
 * of six. Their transforms are baked in.
 */
export function mergeMeshes(meshes) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let offset = 0;
  meshes.forEach(function (mesh) {
    const geometry = mesh.geometry.clone();
    mesh.updateMatrix();
    geometry.applyMatrix4(mesh.matrix);
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      if (normal) normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      else normals.push(0, 1, 0);
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      else uvs.push(0, 0);
    }
    if (geometry.index) {
      const index = geometry.index;
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    } else {
      for (let i = 0; i < position.count; i++) indices.push(i + offset);
    }
    offset += position.count;
    geometry.dispose();
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * One mesh made of several parts, all in the same material.
 */
export function combined(parts, material) {
  const meshes = parts.map(function (part) {
    const mesh = new THREE.Mesh(part.geometry, material);
    mesh.position.copy(part.position || new THREE.Vector3());
    mesh.rotation.set(
      (part.rotation && part.rotation.x) || 0,
      (part.rotation && part.rotation.y) || 0,
      (part.rotation && part.rotation.z) || 0
    );
    if (part.scale) mesh.scale.copy(part.scale);
    return mesh;
  });
  const geometry = mergeMeshes(meshes);
  meshes.forEach(function (mesh) { mesh.geometry.dispose(); });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

/** A soft shadow-catching blob, for contact under the furniture. */
export function contactShadow(size) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
