/* PHOENIX - the things a card does in the room.
 *
 * Every cinematic needs the same handful of sights: a burst of sparks, a
 * ring going out from a player, a beam of light from one player to
 * another, a number flying through the air, a card travelling from a hand
 * to the table, a glow round somebody who has been protected, and the
 * camera shaking when something hits.
 *
 * They are all here, and they are all cheap: one buffer of points, a few
 * meshes, and one update that cleans up after itself.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A number written on a little card that floats up and fades. */
function textTexture(text, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 74px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0, 0, 0, .75)';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = colour;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEffects(scene, options) {
  const settings = Object.assign({ maxParticles: 900 }, options || {});

  /* ---- the sparks ---- */

  // One buffer for every spark in the game. It is drawn as points, and the
  // points that are dead are pushed off the end of the world.
  const positions = new Float32Array(settings.maxParticles * 3);
  const colours = new Float32Array(settings.maxParticles * 3);
  const sizes = new Float32Array(settings.maxParticles);
  const lives = new Float32Array(settings.maxParticles);
  const velocities = new Float32Array(settings.maxParticles * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 0.075,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  let cursor = 0;
  const live = [];

  function addParticle(point, colour, speed, life) {
    const index = cursor;
    cursor = (cursor + 1) % settings.maxParticles;
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = point.y;
    positions[index * 3 + 2] = point.z;
    colours[index * 3] = colour.r;
    colours[index * 3 + 1] = colour.g;
    colours[index * 3 + 2] = colour.b;
    sizes[index] = 1;
    lives[index] = life;
    const direction = new THREE.Vector3(
      Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5
    ).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    velocities[index * 3] = direction.x;
    velocities[index * 3 + 1] = direction.y;
    velocities[index * 3 + 2] = direction.z;
    live.push(index);
    return index;
  }

  /* ---- the things that live for a while ---- */

  const things = [];

  function addThing(object, life, step) {
    scene.add(object);
    things.push({ object: object, life: life, age: 0, step: step });
    return object;
  }

  /* ---- the camera ---- */

  let shake = { power: 0, until: 0 };

  /* ---- the update ---- */

  let running = true;
  const clock = new THREE.Clock();

  function update() {
    if (!running) return;
    requestAnimationFrame(update);
    const delta = Math.min(0.05, clock.getDelta());

    // The sparks.
    for (let i = live.length - 1; i >= 0; i--) {
      const index = live[i];
      lives[index] -= delta;
      if (lives[index] <= 0) {
        positions[index * 3 + 1] = -9999;
        sizes[index] = 0;
        live.splice(i, 1);
        continue;
      }
      velocities[index * 3 + 1] -= 1.2 * delta;
      positions[index * 3] += velocities[index * 3] * delta;
      positions[index * 3 + 1] += velocities[index * 3 + 1] * delta;
      positions[index * 3 + 2] += velocities[index * 3 + 2] * delta;
      sizes[index] = Math.max(0, lives[index] * 0.5);
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;

    // The rings, the beams, the auras, the numbers.
    for (let i = things.length - 1; i >= 0; i--) {
      const thing = things[i];
      thing.age += delta;
      if (thing.step) thing.step(thing.object, thing.age / thing.life, delta);
      if (thing.age >= thing.life) {
        scene.remove(thing.object);
        if (thing.object.geometry && thing.object.geometry.dispose) thing.object.geometry.dispose();
        if (thing.object.material && thing.object.material.map &&
            thing.object.material.map.dispose) {
          thing.object.material.map.dispose();
        }
        if (thing.object.material && thing.object.material.dispose) thing.object.material.dispose();
        things.splice(i, 1);
      }
    }

    // The shake.
    if (shake.until > performance.now()) {
      const left = (shake.until - performance.now()) / 1000;
      const power = shake.power * left;
      if (settings.camera) {
        settings.camera.position.x = (Math.random() - 0.5) * power;
        settings.camera.position.y = (Math.random() - 0.5) * power;
        settings.camera.position.z = (Math.random() - 0.5) * power;
      }
    }
  }

  update();

  const effects = {
    /** A burst of sparks at a point. */
    burst: function (point, colour, count, power) {
      const tint = new THREE.Color(colour === undefined ? 0xffd16b : colour);
      const total = count || 40;
      for (let i = 0; i < total; i++) {
        addParticle(point, tint, power || 1.8, 0.8 + Math.random() * 0.9);
      }
      return wait(0);
    },

    /** A ring going out from a point. */
    ring: function (point, colour, radius, life) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.2, 40),
        new THREE.MeshBasicMaterial({
          color: colour === undefined ? 0xffd16b : colour,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      mesh.position.copy(point);
      mesh.rotation.x = -Math.PI / 2;
      addThing(mesh, life || 1.1, function (object, t) {
        const size = 1 + t * (radius || 2.4);
        object.scale.setScalar(size);
        object.material.opacity = 0.95 * (1 - t * t);
      });
      return wait(0);
    },

    /** A ball of light round a player. */
    aura: function (point, colour, radius, life) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius || 0.8, 20, 14),
        new THREE.MeshBasicMaterial({
          color: colour === undefined ? 0x8ce8a6 : colour,
          transparent: true,
          opacity: 0.18,
          side: THREE.BackSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      mesh.position.copy(point);
      addThing(mesh, life || 1.6, function (object, t) {
        object.material.opacity = 0.22 * (1 - t);
        object.scale.setScalar(1 + t * 0.12);
      });
      return wait(0);
    },

    /** A beam of light from one point to another. */
    beam: function (from, to, colour, life) {
      const distance = from.distanceTo(to);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, distance, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: colour === undefined ? 0x89b9ff : colour,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        to.clone().sub(from).normalize()
      );
      addThing(mesh, life || 0.8, function (object, t) {
        object.material.opacity = 0.9 * (1 - t * t);
      });
      return wait(0);
    },

    /** A number that rises and fades. */
    number: function (point, label, colour, life) {
      const texture = textTexture(label, colour || '#ffe6a8');
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false
      }));
      sprite.scale.set(1.1, 0.275, 1);
      sprite.position.copy(point);
      addThing(sprite, life || 2.0, function (object, t) {
        object.position.y += 0.008;
        object.material.opacity = t < 0.1 ? t / 0.1 : (t > 0.7 ? (1 - t) / 0.3 : 1);
      });
      return wait(0);
    },

    /** A light that flares and goes out. */
    flare: function (point, colour, strength, life) {
      const light = new THREE.PointLight(colour === undefined ? 0xffd16b : colour, strength || 30, 9, 2);
      light.position.copy(point);
      addThing(light, life || 0.9, function (object, t) {
        object.intensity = (strength || 40) * (1 - t) * (1 - t);
      });
      return wait(0);
    },

    /** The camera shakes. */
    shake: function (power, ms) {
      shake.power = power || 0.03;
      shake.until = performance.now() + (ms || 400);
      return wait(0);
    },

    /**
     * Points travelling from one player to another.
     *
     * The number leaves the target, crosses the table, and lands on the
     * player who took it.
     */
    scoreFlight: function (from, to, label, colour) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 14, 10),
        new THREE.MeshBasicMaterial({ color: colour === undefined ? 0xffd16b : colour })
      );
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textTexture(label || '', colour || '#ffe6a8'),
        transparent: true,
        depthWrite: false,
        depthTest: false
      }));
      sprite.scale.set(0.7, 0.175, 1);
      const group = new THREE.Group();
      group.add(orb);
      group.add(sprite);
      addThing(group, 1.5, function (object, t) {
        object.position.lerpVectors(from, to, t);
        object.position.y += Math.sin(t * Math.PI) * 0.55;
        sprite.material.opacity = t < 0.1 ? t / 0.1 : (t > 0.75 ? (1 - t) / 0.25 : 1);
        sprite.scale.set(0.85, 0.21, 1);
      });
      return wait(0);
    },

    /** A card travelling from one player to another. */
    cardFlight: function (from, to, colour) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.13, 0.18),
        new THREE.MeshBasicMaterial({
          color: colour === undefined ? 0x2b3f6b : colour,
          side: THREE.DoubleSide,
          transparent: true
        })
      );
      addThing(mesh, 1.1, function (object, t) {
        object.position.lerpVectors(from, to, t);
        object.position.y += Math.sin(t * Math.PI) * 0.35;
        object.rotation.y = t * Math.PI * 2;
        object.rotation.x = -t * 0.6;
        object.scale.setScalar(1 + (1 - t) * 0.15);
      });
      return wait(0);
    },

    /** Everything that is still going, stopped at once. */
    stop: function () {
      for (let i = things.length - 1; i >= 0; i--) {
        scene.remove(things[i].object);
        things.splice(i, 1);
      }
      live.length = 0;
      for (let i = 0; i < settings.maxParticles; i++) {
        positions[i * 3 + 1] = -9999;
        sizes[i] = 0;
      }
    },

    dispose: function () {
      running = false;
      effects.stop();
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    }
  };

  return effects;
}

export { wait };
