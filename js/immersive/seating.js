/* PHOENIX - putting a person in a chair.
 *
 * A chair in a map says how high its seat is. A person says how high their
 * hips are when they are sitting. The two are usually close, and when they
 * are not, the difference has to go somewhere - and the only place it can go
 * without anything looking wrong is the legs.
 *
 * So this file does three things, and nothing else:
 *
 *   1. It MEASURES the person, from the animation that is actually playing.
 *      A guess would be wrong for every model, because Mixamo models do not
 *      all start from the same place and their bones are not all the same
 *      length.
 *
 *   2. It SEATS them: hips on the cushion, facing the table.
 *
 *   3. It LOCKS them to the seat, every frame. A fade, a drift, a change of
 *      animation or a badly timed re-load can never move a player off
 *      their chair again. This is the part that stops people floating and
 *      sinking.
 *
 * The measurement is taken from the BONES and never from the bounding box:
 * Box3.setFromObject() on a SkinnedMesh returns the bind-pose bounds, not
 * the bounds of the pose on screen, so a box measured that way is fiction.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';

/**
 * The namespace Mixamo writes its bones under.
 *
 * The binary FBX format encodes the ":" of "mixamorig:Spine" as a digit,
 * and the digit is not the same in every file: the character and the
 * animation can disagree about it. The bone underneath is the same, so the
 * name is compared without it.
 */
const MIXAMO_NAMESPACE = /^mixamorig\d+/;

/** The name of a bone with the namespace digit removed. */
export function boneKey(name) {
  return String(name).replace(MIXAMO_NAMESPACE, 'mixamorig');
}

/** Find a bone by its Mixamo name, whatever digit the file used. */
export function findBone(character, name) {
  const wanted = 'mixamorig' + name;
  const bones = (character && character.bones) || [];
  for (let i = 0; i < bones.length; i++) {
    if (boneKey(bones[i].name) === wanted) return bones[i];
  }
  return null;
}

/**
 * Put the character into a known pose and measure it.
 *
 * The clip is played with no fade and the mixer is stepped by hand, so the
 * pose that is measured is the pose the character will actually be in -
 * not the one it is passing through on the way there.
 *
 * Everything is measured in the character's own space, so the numbers do
 * not change when the character is moved.
 */
export function measurePose(character, options) {
  const settings = Object.assign({ clip: 'sittingIdle', at: 0.6 }, options || {});
  const group = character.group;
  const hips = findBone(character, 'Hips');
  const head = findBone(character, 'Head');
  const neck = findBone(character, 'Neck');
  const leftFoot = findBone(character, 'LeftFoot');
  const rightFoot = findBone(character, 'RightFoot');
  const leftToe = findBone(character, 'LeftToeBase');
  const rightToe = findBone(character, 'RightToeBase');
  const leftKnee = findBone(character, 'LeftLeg');
  const rightKnee = findBone(character, 'RightLeg');

  // Measure in the character's own space: put the group at the origin for a
  // moment, so the numbers are the model's and not the room's.
  const where = group.position.clone();
  group.position.set(0, 0, 0);
  group.updateMatrixWorld(true);

  // The model is built in its own units - Mixamo uses centimetres - and the
  // scale that turns those into metres is on the group. So the measurement
  // is taken in the model's own space and then scaled, and the numbers that
  // come out are in metres, like the rest of the room.
  const scale = group.getWorldScale(new THREE.Vector3());

  const local = function (bone) {
    if (!bone) return null;
    const point = bone.getWorldPosition(new THREE.Vector3());
    const own = group.worldToLocal(point);
    return own.multiply(scale);
  };

  const measure = {
    hips: local(hips),
    head: local(head),
    neck: local(neck),
    leftFoot: local(leftFoot),
    rightFoot: local(rightFoot),
    leftToe: local(leftToe),
    rightToe: local(rightToe),
    leftKnee: local(leftKnee),
    rightKnee: local(rightKnee)
  };

  group.position.copy(where);
  group.updateMatrixWorld(true);

  // The lowest point of the person: the sole of the feet.
  const soles = [measure.leftToe, measure.rightToe, measure.leftFoot, measure.rightFoot]
    .filter(Boolean);
  measure.contact = soles.reduce(function (lowest, point) {
    return point.y < lowest.y ? point : lowest;
  }, soles[0] || new THREE.Vector3());

  // How high the hips are above the floor they are standing on, and how
  // tall the person is when they are sitting.
  measure.sitHeight = measure.hips ? measure.hips.y - measure.contact.y : 0;
  measure.seatedHeight = measure.head ? measure.head.y - measure.contact.y : 0;
  measure.shoulderHeight = measure.neck ? measure.neck.y - measure.contact.y : measure.seatedHeight;

  return measure;
}

/**
 * Put a character on a seat.
 *
 * The hips go on the top of the cushion, the body turns to face the table,
 * and the character's own proportions are what decide where everything else
 * ends up: the head, the knees and the feet all follow from the hips.
 *
 * The seat is an anchor from the map:
 *
 *   { position, angle, seatTop, eye }
 */
export function seatCharacter(character, seat) {
  const group = character.group;
  const measure = character.measure || (character.measure = measurePose(character));

  // The hips are the anchor. The character's own sitting height decides how
  // far up from their soles the hips are, so the group goes where the hips
  // land on the cushion.
  const hipsAbove = measure.hips ? measure.hips.y : 0;
  group.position.set(seat.position.x, seat.seatTop - hipsAbove, seat.position.z);

  // The body turns to face the table.
  group.rotation.set(0, seat.angle + Math.PI, 0);

  // Where the eyes are: the head, as the character actually sits.
  const eyeAbove = measure.head ? measure.head.y - hipsAbove : 0.58;
  seat.eye = seat.seatTop + eyeAbove;

  character.seated = true;
  character.measure = measure;
  return character;
}

/**
 * Keep a character on their seat.
 *
 * Called after the animation mixer has been stepped, so the hips are where
 * the animation has just put them - and then they are put back on the
 * cushion, exactly, every frame. This is what makes the seating stable
 * whatever the animation is doing.
 */
export function lockToSeat(character, seat) {
  if (!character || !character.seated || !seat) return;
  const hips = findBone(character, 'Hips');
  if (!hips) return;
  const group = character.group;
  const point = hips.getWorldPosition(new THREE.Vector3());
  // How high the hips are above the character's own origin, right now.
  const above = point.y - group.position.y;
  group.position.y = seat.seatTop - above;
}

/**
 * Get a character up and standing behind their chair.
 *
 * The feet go on the floor and the seat lock is released, so the character
 * is not dragged back onto the cushion by the frame loop.
 */
export function standCharacter(character, seat) {
  if (!character || !seat) return character;
  const group = character.group;
  group.position.set(seat.standing.x, 0, seat.standing.z);
  group.rotation.set(0, seat.angle + Math.PI, 0);
  character.seated = false;
  return character;
}

/**
 * Sit a character back down on their chair.
 *
 * The hips go on the cushion, exactly where the seat lock will keep them.
 */
export function sitCharacter(character, seat) {
  if (!character || !seat) return character;
  const group = character.group;
  const measure = character.measure;
  const hipsAbove = measure && measure.hips ? measure.hips.y : null;
  group.position.set(seat.seated.x, hipsAbove === null ? group.position.y : seat.seatTop - hipsAbove, seat.seated.z);
  group.rotation.set(0, seat.angle + Math.PI, 0);
  character.seated = true;
  return character;
}

/**
 * The place a character's eyes are, in the room.
 *
 * The camera for the local player is put here, so the player is looking out
 * of the head of the body everybody else can see.
 */
export function eyePoint(character) {
  const head = findBone(character, 'Head');
  const neck = findBone(character, 'Neck');
  const bone = head || neck;
  if (!bone) return null;
  const point = bone.getWorldPosition(new THREE.Vector3());
  // The eyes are a little above and in front of the bone, which sits at the
  // base of the skull.
  point.y += 0.055;
  return point;
}

/**
 * Which way the character is looking.
 *
 * The head bone carries the direction the face is pointing, so a character
 * can turn their head and the camera can follow them round the table.
 */
export function lookDirection(character) {
  const head = findBone(character, 'Head');
  if (!head) return null;
  const direction = new THREE.Vector3(0, 0, 1);
  direction.applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
  return direction;
}
