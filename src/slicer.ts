import * as THREE from 'three';
import type { LearningScene } from './scene';

export type SlicerState = {
  offset: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  clipSide: 1 | -1;
};

export function createInitialSlicerState(): SlicerState {
  return {
    offset: 3.5,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    clipSide: 1,
  };
}

export function copySlicerState(target: SlicerState, source: SlicerState): void {
  target.offset = source.offset;
  target.rotationX = source.rotationX;
  target.rotationY = source.rotationY;
  target.rotationZ = source.rotationZ;
  target.clipSide = source.clipSide;
}

export function normalFromSlicer(state: SlicerState): THREE.Vector3 {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(state.rotationX),
    THREE.MathUtils.degToRad(state.rotationY),
    THREE.MathUtils.degToRad(state.rotationZ),
    'XYZ',
  );

  return new THREE.Vector3(1, 0, 0).applyEuler(euler).normalize();
}

export function setSlicerFromPlane(state: SlicerState, normal: THREE.Vector3, constant: number): void {
  const normalized = normal.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), normalized);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');

  state.offset = constant;
  state.rotationX = THREE.MathUtils.radToDeg(euler.x);
  state.rotationY = THREE.MathUtils.radToDeg(euler.y);
  state.rotationZ = THREE.MathUtils.radToDeg(euler.z);
}

export function updateSlicer(state: SlicerState, learningScene: LearningScene): void {
  const normal = normalFromSlicer(state);
  learningScene.clippingPlane.normal.copy(normal).multiplyScalar(state.clipSide);
  learningScene.clippingPlane.constant = state.offset * state.clipSide;
  learningScene.refreshSectionSurface();
}
