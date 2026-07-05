import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SlicerState } from './slicer';
import { calculateMeshSectionPolygon } from './sectionMath';
import { setSolidMaterialOpacity, type SolidModel, type SolidVertex } from './solids';

export type VertexSelection = {
  solid: SolidModel;
  vertices: SolidVertex[];
};

export type LearningScene = {
  clippingPlane: THREE.Plane;
  setSolid: (model: SolidModel) => void;
  setSolids: (models: SolidModel[]) => void;
  getSolids: () => SolidModel[];
  setSolidTransparency: (enabled: boolean) => void;
  setPlaneVisible: (visible: boolean) => void;
  setVertexSelectionHandler: (handler: (selection: VertexSelection) => void) => void;
  clearVertexSelection: () => void;
  refreshSectionSurface: () => void;
  saveScreenshot: () => void;
  start: () => void;
};

export function createLearningScene(container: HTMLElement, _initialState: SlicerState): LearningScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eef5f8');

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(5, 4, 5);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);

  const ambientLight = new THREE.HemisphereLight('#ffffff', '#9caeb7', 2.0);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight('#ffffff', 2.2);
  keyLight.position.set(5, 6, 4);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight('#b7d6ff', 0.8);
  fillLight.position.set(-5, 3, -4);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(8, 16, '#8799a5', '#d0dbe0');
  scene.add(grid);

  const axes = new THREE.AxesHelper(3.1);
  scene.add(axes);

  const clippingPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  const sectionMaterial = new THREE.MeshBasicMaterial({
    color: '#ffb43c',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.76,
    depthTest: false,
    depthWrite: false,
  });
  const planeMesh = new THREE.Mesh(new THREE.BufferGeometry(), sectionMaterial);
  planeMesh.renderOrder = 4;
  scene.add(planeMesh);

  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0xdf7a1d,
    depthTest: false,
    linewidth: 2,
  });
  const planeHelper = new THREE.LineLoop(new THREE.BufferGeometry(), outlineMaterial);
  planeHelper.renderOrder = 5;
  const sectionGroup = new THREE.Group();
  sectionGroup.add(planeMesh);
  sectionGroup.add(planeHelper);
  scene.add(sectionGroup);

  let currentSolid: SolidModel | undefined;
  let currentSolids: SolidModel[] = [];
  let transparentView = false;
  let vertexSelectionHandler: ((selection: VertexSelection) => void) | undefined;
  const selectedVertexIds = new Set<string>();

  const vertexGroup = new THREE.Group();
  scene.add(vertexGroup);

  const markerGeometry = new THREE.SphereGeometry(0.105, 18, 14);
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#1f5f99',
    emissiveIntensity: 0.35,
    roughness: 0.35,
  });
  const selectedMarkerMaterial = new THREE.MeshStandardMaterial({
    color: '#ffb43c',
    emissive: '#df7a1d',
    emissiveIntensity: 0.55,
    roughness: 0.35,
  });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointerDown = new THREE.Vector2();
  let suppressNextClick = false;

  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const disposeSolid = (model: SolidModel) => {
    scene.remove(model.mesh);
    model.mesh.geometry.dispose();
    const material = model.mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material.dispose();
    }
  };

  const setSolids = (models: SolidModel[]) => {
    currentSolids.forEach(disposeSolid);
    currentSolids = models;
    currentSolid = currentSolids[0];

    currentSolids.forEach((model) => {
      setSolidMaterialOpacity(model, transparentView);
      scene.add(model.mesh);
    });

    if (currentSolid) {
      rebuildVertexMarkers(currentSolid);
    } else {
      vertexGroup.clear();
      selectedVertexIds.clear();
    }

    refreshSectionSurface();
    emitVertexSelection();
  };

  const setSolid = (model: SolidModel) => {
    setSolids([model]);
  };

  const getSolids = () => currentSolids;

  const disposeSectionGroup = () => {
    sectionGroup.children.forEach((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineLoop) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) {
          material.forEach((entry: THREE.Material) => entry.dispose());
        } else {
          material.dispose();
        }
      }
    });
    sectionGroup.clear();
  };

  const rebuildVertexMarkers = (model: SolidModel) => {
    vertexGroup.clear();
    selectedVertexIds.clear();

    model.vertices.forEach((vertex, index) => {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.copy(vertex.position);
      marker.userData.vertexIndex = index;
      marker.userData.vertexId = vertex.id;
      marker.userData.vertexLabel = vertex.label;
      marker.renderOrder = 3;
      vertexGroup.add(marker);
    });
  };

  const setSolidTransparency = (enabled: boolean) => {
    transparentView = enabled;
    currentSolids.forEach((model) => setSolidMaterialOpacity(model, transparentView));
  };

  const setPlaneVisible = (visible: boolean) => {
    sectionGroup.visible = visible;
  };

  const refreshSectionSurface = () => {
    disposeSectionGroup();

    if (currentSolids.length === 0) {
      return;
    }

    currentSolids.forEach((model, index) => {
      const polygon = calculateMeshSectionPolygon(model.mesh, clippingPlane);
      addSectionGeometries(polygon, clippingPlane.normal, model.sectionColor, index);
    });
  };

  const addSectionGeometries = (polygon: THREE.Vector3[], normal: THREE.Vector3, color: string, index: number) => {
    if (polygon.length < 3) {
      return;
    }

    const offset = normal.clone().normalize().multiplyScalar(0.002);
    const displayPolygon = polygon.map((point) => point.clone().add(offset));
    const center = displayPolygon
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .divideScalar(displayPolygon.length);
    const vertices = [center, ...displayPolygon];
    const indices: number[] = [];

    for (let i = 1; i <= displayPolygon.length; i += 1) {
      indices.push(0, i, i === displayPolygon.length ? 1 : i + 1);
    }

    const capGeometry = new THREE.BufferGeometry().setFromPoints(vertices);
    capGeometry.setIndex(indices);
    capGeometry.computeVertexNormals();
    const capMaterial = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: index === 0 ? 0.76 : 0.82,
      depthTest: false,
      depthWrite: false,
    });
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.renderOrder = 4 + index;
    sectionGroup.add(cap);

    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(displayPolygon),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        depthTest: false,
      }),
    );
    outline.renderOrder = 8 + index;
    sectionGroup.add(outline);
  };

  const setVertexSelectionHandler = (handler: (selection: VertexSelection) => void) => {
    vertexSelectionHandler = handler;
  };

  const selectedVertices = () => {
    if (!currentSolid) {
      return [];
    }

    return currentSolid.vertices.filter((vertex) => selectedVertexIds.has(vertex.id));
  };

  const emitVertexSelection = () => {
    if (currentSolid) {
      vertexSelectionHandler?.({ solid: currentSolid, vertices: selectedVertices() });
    }
  };

  const updateMarkerMaterials = () => {
    vertexGroup.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = selectedVertexIds.has(String(child.userData.vertexId)) ? selectedMarkerMaterial : markerMaterial;
      }
    });
  };

  const clearVertexSelection = () => {
    selectedVertexIds.clear();
    updateMarkerMaterials();
    emitVertexSelection();
  };

  const saveScreenshot = () => {
    renderer.render(scene, camera);
    const link = document.createElement('a');
    link.download = 'section-viewer.png';
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
  };

  const animate = () => {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const selectVertexAtClientPoint = (clientX: number, clientY: number): boolean => {
    if (!currentSolid) {
      return false;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const intersections = raycaster.intersectObjects(vertexGroup.children, false);
    const marker = intersections[0]?.object;
    if (!(marker instanceof THREE.Mesh)) {
      return false;
    }

    const vertex = currentSolid.vertices[Number(marker.userData.vertexIndex)];
    if (!vertex) {
      return false;
    }

    if (selectedVertexIds.has(vertex.id)) {
      selectedVertexIds.delete(vertex.id);
    } else if (selectedVertexIds.size < 4) {
      selectedVertexIds.add(vertex.id);
    }

    updateMarkerMaterials();
    emitVertexSelection();
    return true;
  };

  renderer.domElement.addEventListener('pointerdown', (event) => {
    pointerDown.set(event.clientX, event.clientY);
  });

  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!currentSolid || pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 6) {
      return;
    }

    suppressNextClick = selectVertexAtClientPoint(event.clientX, event.clientY);
  });

  renderer.domElement.addEventListener('click', (event) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

    selectVertexAtClientPoint(event.clientX, event.clientY);
  });

  return {
    clippingPlane,
    setSolid,
    setSolids,
    getSolids,
    setSolidTransparency,
    setPlaneVisible,
    setVertexSelectionHandler,
    clearVertexSelection,
    refreshSectionSurface,
    saveScreenshot,
    start: animate,
  };
}
