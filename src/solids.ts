import * as THREE from 'three';

export type SolidKind = 'cube' | 'box' | 'cylinder' | 'cone' | 'sphere';

export type SolidVertex = {
  id: string;
  label: string;
  position: THREE.Vector3;
};

export type SolidModel = {
  kind: SolidKind;
  label: string;
  roleLabel: string;
  sectionColor: string;
  mesh: THREE.Mesh;
  vertices: SolidVertex[];
};

const solidNames: Record<SolidKind, string> = {
  cube: '立方体',
  box: '直方体',
  cylinder: '円柱',
  cone: '円錐',
  sphere: '球',
};

type SolidSpec = {
  geometry: () => THREE.BufferGeometry;
  height: number;
  vertices: () => SolidVertex[];
};

export type CreateSolidOptions = {
  color?: string;
  opacity?: number;
  roleLabel?: string;
  sectionColor?: string;
};

const rectangleVertices = (width: number, height: number, depth: number): SolidVertex[] => {
  const x = width / 2;
  const y = height;
  const z = depth / 2;
  const positions = [
    [-x, 0, -z],
    [x, 0, -z],
    [x, 0, z],
    [-x, 0, z],
    [-x, y, -z],
    [x, y, -z],
    [x, y, z],
    [-x, y, z],
  ];

  return positions.map(([px, py, pz], index) => ({
    id: `v${index + 1}`,
    label: `頂点 ${index + 1}`,
    position: new THREE.Vector3(px, py, pz),
  }));
};

const radialVertices = (radius: number, y: number, prefix: string): SolidVertex[] => {
  const points = [
    [radius, y, 0],
    [0, y, radius],
    [-radius, y, 0],
    [0, y, -radius],
  ];

  return points.map(([px, py, pz], index) => ({
    id: `${prefix}${index + 1}`,
    label: `${radialLabel(prefix)} 点 ${index + 1}`,
    position: new THREE.Vector3(px, py, pz),
  }));
};

const radialLabel = (prefix: string): string => {
  if (prefix === 'top') return '上面';
  if (prefix === 'bottom') return '底面';
  if (prefix === 'middle') return '中段';
  return '選択';
};

const specs: Record<SolidKind, SolidSpec> = {
  cube: {
    geometry: () => new THREE.BoxGeometry(2.4, 2.4, 2.4),
    height: 2.4,
    vertices: () => rectangleVertices(2.4, 2.4, 2.4),
  },
  box: {
    geometry: () => new THREE.BoxGeometry(3.1, 1.8, 2.2),
    height: 1.8,
    vertices: () => rectangleVertices(3.1, 1.8, 2.2),
  },
  cylinder: {
    geometry: () => new THREE.CylinderGeometry(1.15, 1.15, 2.7, 72, 1),
    height: 2.7,
    vertices: () => [
      ...radialVertices(1.15, 0, 'bottom'),
      ...radialVertices(1.15, 2.7, 'top'),
      { id: 'bottom-center', label: '底面中心', position: new THREE.Vector3(0, 0, 0) },
      { id: 'top-center', label: '上面中心', position: new THREE.Vector3(0, 2.7, 0) },
    ],
  },
  cone: {
    geometry: () => new THREE.ConeGeometry(1.25, 2.8, 72, 1),
    height: 2.8,
    vertices: () => [
      ...radialVertices(1.25, 0, 'bottom'),
      { id: 'apex', label: '頂点', position: new THREE.Vector3(0, 2.8, 0) },
      { id: 'bottom-center', label: '底面中心', position: new THREE.Vector3(0, 0, 0) },
    ],
  },
  sphere: {
    geometry: () => new THREE.SphereGeometry(1.35, 72, 36),
    height: 2.7,
    vertices: () => [
      { id: 'bottom', label: '下端', position: new THREE.Vector3(0, 0, 0) },
      { id: 'top', label: '上端', position: new THREE.Vector3(0, 2.7, 0) },
      ...radialVertices(1.35, 1.35, 'middle'),
    ],
  },
};

export function createSolid(kind: SolidKind, clippingPlane: THREE.Plane, options: CreateSolidOptions = {}): SolidModel {
  const opacity = options.opacity ?? 0.9;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(options.color ?? '#4f8edb'),
    metalness: 0.05,
    roughness: 0.52,
    side: THREE.DoubleSide,
    clippingPlanes: [clippingPlane],
    clipShadows: true,
    transparent: true,
    opacity,
  });
  material.depthWrite = opacity >= 0.75;
  material.userData.baseOpacity = opacity;
  material.userData.baseDepthWrite = material.depthWrite;

  const spec = specs[kind];
  const mesh = new THREE.Mesh(spec.geometry(), material);
  mesh.name = solidNames[kind];
  mesh.position.y = spec.height / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return {
    kind,
    label: solidNames[kind],
    roleLabel: options.roleLabel ?? '外側',
    sectionColor: options.sectionColor ?? '#ffb43c',
    mesh,
    vertices: spec.vertices(),
  };
}

export function setSolidMaterialOpacity(model: SolidModel, transparentView: boolean): void {
  const material = model.mesh.material;
  if (!Array.isArray(material) && material instanceof THREE.MeshStandardMaterial) {
    const baseOpacity = typeof material.userData.baseOpacity === 'number' ? material.userData.baseOpacity : 0.9;
    const baseDepthWrite =
      typeof material.userData.baseDepthWrite === 'boolean' ? material.userData.baseDepthWrite : baseOpacity >= 0.75;
    material.opacity = transparentView ? Math.min(0.42, baseOpacity) : baseOpacity;
    material.depthWrite = transparentView ? false : baseDepthWrite;
    material.needsUpdate = true;
  }
}
