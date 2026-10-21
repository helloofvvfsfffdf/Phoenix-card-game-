/* PHOENIX - the Mixamo characters and their animations.
 *
 * A Mixamo character arrives as an FBX: a skeleton with the standard Mixamo
 * bone names, skinned meshes for the body, the clothes and the hair, the
 * textures packed into the file, and any animations that were downloaded with
 * it. Nothing here is re-authored: the rig that comes out of the file is the
 * rig, and it is kept intact so it can be animated later.
 *
 * The loader is Three.js's own FBXLoader, vendored under vendor/three so
 * the page has no external dependency and no build step.
 *
 * The ANIMATIONS are kept separately, as small JSON files of keyframes. A
 * Mixamo download is about fifty megabytes, almost all of it the model and
 * its textures, which the game already has; the animation is the small part
 * of it, and tools/extract-mixamo-animation.js takes just that out.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { FBXLoader } from '../../vendor/three/loaders/FBXLoader.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';

/** How tall a person should be, in metres. */
const TARGET_HEIGHT = 1.72;

/**
 * Load one Mixamo character.
 *
 * Resolves with the model, its animation mixer, the clips that came with it,
 * the bones, and the scale that was applied to it.
 */
export function loadMixamoCharacter(url, options) {
  const settings = Object.assign({ targetHeight: TARGET_HEIGHT, name: '' }, options || {});
  return new Promise(function (resolve, reject) {
    const loader = new FBXLoader();
    loader.load(url, function (group) {
      try {
        resolve(prepareMixamoCharacter(group, settings));
      } catch (error) {
        reject(error);
      }
    }, undefined, function (error) {
      reject(new Error('The character could not be loaded: ' +
        (error && error.message ? error.message : 'the file could not be read')));
    });
  });
}

/**
 * Load one of the converted characters.
 *
 * The converted files are the same models as the FBX downloads, with the
 * pictures made a sensible size, so they load in a moment instead of a
 * coffee break. The rig is the same rig.
 */
export function loadMixamoGLB(url, options) {
  const settings = Object.assign({ targetHeight: TARGET_HEIGHT, name: '' }, options || {});
  return new Promise(function (resolve, reject) {
    const loader = new GLTFLoader();
    loader.load(url, function (gltf) {
      try {
        const character = prepareMixamoCharacter(gltf.scene, settings);
        character.animations = (gltf.animations || []).map(function (clip) {
          character.mixer.clipAction(clip);
          return clip;
        });
        resolve(character);
      } catch (error) {
        reject(error);
      }
    }, undefined, function (error) {
      reject(new Error('The character could not be loaded: ' +
        (error && error.message ? error.message : 'the file could not be read')));
    });
  });
}

/**
 * Get a loaded Mixamo model ready for the room.
 *
 * The bones and the skinning are left exactly as they came. What changes is
 * the material (so the clothes and the skin take the room's light properly),
 * the scale (so the character is a person-sized person), and the shadows.
 */
export function prepareMixamoCharacter(group, settings) {
  const options = Object.assign({ targetHeight: TARGET_HEIGHT }, settings || {});

  group.name = options.name || group.name || 'mixamo';

  // The bones: every object that is one, collected in order.
  const bones = [];
  group.traverse(function (object) {
    if (object.isBone) bones.push(object);
  });

  // The meshes: the body, the clothes and the hair.
  const meshes = [];
  group.traverse(function (object) {
    if (!object.isMesh) return;
    meshes.push(object);
    // Mixamo's materials are Phong. The room is lit for a standard material,
    // so the character is converted rather than lit twice as hard.
    const source = object.material;
    if (source && source.map) {
      const material = new THREE.MeshStandardMaterial({
        map: source.map,
        color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
        roughness: 0.78,
        metalness: 0.02,
        transparent: !!source.transparent,
        opacity: source.opacity === undefined ? 1 : source.opacity,
        alphaTest: source.alphaTest || 0,
        side: source.side || THREE.FrontSide
      });
      if (source.map) {
        source.map.colorSpace = THREE.SRGBColorSpace;
        source.map.anisotropy = 8;
        source.map.needsUpdate = true;
      }
      object.material = material;
    }
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = true;
  });

  // The scale: Mixamo's models are authored at a scale of their own, so the
  // character is measured and set to a person's height.
  const box = new THREE.Box3().setFromObject(group);
  const height = box.max.y - box.min.y;
  const scale = height > 0.01 ? options.targetHeight / height : 1;
  group.scale.setScalar(scale);

  // The animations that came with the model.
  const mixer = new THREE.AnimationMixer(group);
  const clips = group.animations || [];

  return {
    group: group,
    mixer: mixer,
    clips: clips,
    bones: bones,
    meshes: meshes,
    height: height,
    scale: scale,
    clipNames: clips.map(function (clip) { return clip.name; }),
    /**
     * The first clip whose name looks like the one asked for.
     */
    findClip: function (word) {
      const wanted = String(word || '').toLowerCase();
      for (let i = 0; i < clips.length; i++) {
        if (clips[i].name.toLowerCase().indexOf(wanted) !== -1) return clips[i];
      }
      return null;
    }
  };
}

/* ------------------------------------------------------------------ */
/* The extracted animations                                             */
/* ------------------------------------------------------------------ */

/**
 * The animations that came out of Mixamo, and what they are for.
 *
 * Each one is a small JSON file of keyframes, taken out of the fifty-megabyte
 * download with tools/extract-mixamo-animation.js. The keys are the names the
 * cinematic system asks for.
 */
export const ANIMATIONS = {
  sittingIdle: 'assets/mixamo/animations/sitting-idle.json',
  sittingClap: 'assets/mixamo/animations/sitting-clap.json',
  sittingLaughing: 'assets/mixamo/animations/sitting-laughing.json',
  reaction: 'assets/mixamo/animations/reaction.json',
  angry: 'assets/mixamo/animations/angry.json',
  taunt: 'assets/mixamo/animations/taunt.json',
  defeated: 'assets/mixamo/animations/defeated.json',
  dying: 'assets/mixamo/animations/dying.json',
  hitToHead: 'assets/mixamo/animations/medium-hit-to-head.json',
  kickToTheGroin: 'assets/mixamo/animations/kick-to-the-groin.json',
  shovedWithSpin: 'assets/mixamo/animations/shoved-reaction-with-spin.json',
  jumpingDown: 'assets/mixamo/animations/jumping-down.json',
  running: 'assets/mixamo/animations/running.json'
};

/** The animations that have been fetched, by their key. */
const loaded = new Map();

/**
 * Build a clip from the extracted keyframes.
 *
 * The kind of a track is worked out from how many numbers it holds per
 * keyframe - four for a rotation, three for a position - because a track that
 * is the wrong kind throws the moment the mixer tries to bind it.
 */
function clipFromJson(json) {
  const tracks = json.tracks.map(function (track) {
    const times = Float32Array.from(track.times);
    const values = Float32Array.from(track.values);
    const perKey = times.length ? values.length / times.length : 0;
    const name = String(track.name);
    const isRotation = /quaternion|rotation/i.test(name) || perKey === 4;
    if (isRotation) {
      return new THREE.QuaternionKeyframeTrack(name, times, values);
    }
    if (perKey === 3) {
      return new THREE.VectorKeyframeTrack(name, times, values);
    }
    return new THREE.NumberKeyframeTrack(name, times, values);
  });
  return new THREE.AnimationClip(json.name, json.duration, tracks);
}

/**
 * The namespace Mixamo writes its bones under.
 *
 * The binary FBX format encodes the ":" of "mixamorig:Spine" as a digit, and
 * the digit it picks is not the same in every file: the character and the
 * animation can disagree about it. The bone underneath is the same, so the
 * name is compared without it.
 */
const MIXAMO_NAMESPACE = /^mixamorig\d+/;

/** The name of the bone a track is about, with the namespace digit removed. */
function boneKey(name) {
  return String(name).replace(MIXAMO_NAMESPACE, 'mixamorig');
}

/**
 * Point a clip's tracks at the bones of the character that is actually
 * playing it.
 *
 * Without this the mixer simply finds nothing to bind to: the tracks are
 * named after the animation file's bones and the character has its own.
 * A track that cannot be bound is dropped, and an animation of nothing is
 * worse than no animation at all.
 */
function retargetClip(clip, character) {
  const bones = {};
  (character.bones || []).forEach(function (bone) {
    bones[boneKey(bone.name)] = bone.name;
  });
  const tracks = clip.tracks.map(function (track) {
    const name = String(track.name);
    const dot = name.lastIndexOf('.');
    if (dot === -1) return track;
    const node = name.slice(0, dot);
    const property = name.slice(dot);
    const real = bones[boneKey(node)];
    if (!real || real === node) return track;
    // The same kind of track, aimed at the bone that is really there.
    const Retargeted = track.constructor;
    return new Retargeted(real + property, track.times, track.values);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Get one of the extracted animations, fetching it the first time it is
 * asked for.
 */
export function loadAnimation(key) {
  if (loaded.has(key)) return loaded.get(key);
  const url = ANIMATIONS[key];
  if (!url) return Promise.resolve(null);
  const promise = fetch(url, { cache: 'force-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('The animation could not be read.');
      return response.json();
    })
    .then(function (json) {
      return (json.clips || []).map(clipFromJson);
    })
    .catch(function (error) {
      loaded.delete(key);
      throw error;
    });
  loaded.set(key, promise);
  return promise;
}

/**
 * Play one of the extracted animations on a character.
 *
 * The animation is fetched the first time and kept after that, so the second
 * card that needs it does not wait for a download.
 */
export function playAnimation(character, key, options) {
  if (!character || !character.mixer) return Promise.resolve(null);
  const settings = Object.assign({ loop: false, fade: 0.25, clampWhenFinished: true, speed: 1 }, options || {});
  return loadAnimation(key).then(function (clips) {
    if (!clips || !clips.length) return null;
    const clip = retargetClip(clips[0], character);
    const action = character.mixer.clipAction(clip);
    action.reset();
    action.setLoop(settings.loop ? THREE.LoopRepeat : THREE.LoopOnce, settings.loop ? Infinity : 1);
    // The last pose is held, and the fade out is left until the clip has
    // actually finished: a fade out asked for now would fade it out at once.
    action.clampWhenFinished = settings.clampWhenFinished;
    if (settings.fade > 0) {
      action.fadeIn(settings.fade);
    } else {
      // No fade at all: the pose is the real one from the very first frame.
      // A fade in would mean the character is measured and placed while it
      // is still mostly in its old pose, and it would then jump.
      action.stopFading();
      action.setEffectiveWeight(1);
    }
    action.timeScale = settings.speed;
    action.play();
    return { action: action, clip: clip };
  });
}

/**
 * Settle a character into a pose and hold it there.
 *
 * The clip is played with no fade, and the mixer is stepped by hand so the
 * pose that is on screen is the pose that is measured. The clip is then
 * paused, so the character stays exactly where they were put.
 */
export function settleAnimation(character, key, options) {
  const settings = Object.assign({ at: 0.6, loop: true }, options || {});
  return playAnimation(character, key, { loop: settings.loop, fade: 0, clampWhenFinished: true })
    .then(function (played) {
      if (!played) return null;
      character.mixer.update(1 / 60);
      character.mixer.update(settings.at);
      played.action.paused = true;
      played.action.setEffectiveWeight(1);
      return played;
    });
}

/**
 * Put a character on a chair.
 *
 * The chair in the room is a real chair with a real seat height, and the
 * character's feet have to reach the floor and their hips have to be on the
 * seat. The model is moved, not scaled: the scale was already fixed when it
 * was loaded, so the proportions stay a person's.
 */
export function seatCharacter(character, seat) {
  const group = character.group;
  const box = new THREE.Box3().setFromObject(group);
  group.position.x += seat.x - box.min.x - (box.max.x - box.min.x) * 0.5;
  group.position.z += seat.z - box.min.z - (box.max.z - box.min.z) * 0.5;
  // The feet on the floor.
  group.position.y += -box.min.y;
  group.rotation.y = seat.rotation || 0;
  return group;
}
