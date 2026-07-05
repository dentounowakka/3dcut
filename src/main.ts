import './style.css';
import * as THREE from 'three';
import { createLearningScene } from './scene';
import { createSectionView } from './section2d';
import { createUi, type UiController } from './ui';
import { createInitialSlicerState, setSlicerFromPlane, updateSlicer } from './slicer';
import { createSolid, getSolidDimensions, type SolidKind, type SolidModel, type SolidVertex } from './solids';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('#app が見つかりません');
}

app.innerHTML = `
  <main class="app-shell">
    <section class="viewer-panel" aria-label="3D表示エリア">
      <div id="scene-container" class="scene-container"></div>
      <div class="viewer-status" id="viewer-status"></div>
    </section>
    <div class="mobile-action-bar" aria-label="スマホ用操作">
      <button id="mobile-menu-button" type="button">操作</button>
      <button id="mobile-section-button" type="button">断面図</button>
    </div>
    <button id="drawer-backdrop" class="drawer-backdrop" type="button" aria-label="メニューを閉じる"></button>
    <aside class="side-panel">
      <div class="drawer-header">
        <span>メニュー</span>
        <button id="drawer-close-button" type="button" aria-label="メニューを閉じる">閉じる</button>
      </div>
      <section class="control-panel" aria-label="操作パネル">
        <div class="panel-heading">
          <p class="eyebrow">空間図形</p>
          <h1>断面ビューア</h1>
        </div>
        <div id="controls"></div>
      </section>
      <section class="section-panel" aria-label="断面図エリア">
        <div class="section-header">
          <h2>断面図</h2>
          <span id="section-shape-name" class="shape-badge">-</span>
        </div>
        <canvas id="section-canvas" width="420" height="300"></canvas>
        <dl class="section-readout">
          <div>
            <dt>切断位置</dt>
            <dd id="readout-offset">0.00</dd>
          </div>
          <div>
            <dt>角度</dt>
            <dd id="readout-angles">X 0° / Y 0° / Z 0°</dd>
          </div>
        </dl>
        <p id="section-note" class="section-note"></p>
      </section>
    </aside>
  </main>
`;

const sceneContainer = document.querySelector<HTMLDivElement>('#scene-container');
const controlsContainer = document.querySelector<HTMLDivElement>('#controls');
const viewerStatus = document.querySelector<HTMLDivElement>('#viewer-status');
const sectionCanvas = document.querySelector<HTMLCanvasElement>('#section-canvas');
const sectionShapeName = document.querySelector<HTMLSpanElement>('#section-shape-name');
const readoutOffset = document.querySelector<HTMLElement>('#readout-offset');
const readoutAngles = document.querySelector<HTMLElement>('#readout-angles');
const sectionNote = document.querySelector<HTMLElement>('#section-note');
const sidePanel = document.querySelector<HTMLElement>('.side-panel');
const sectionPanel = document.querySelector<HTMLElement>('.section-panel');
const mobileMenuButton = document.querySelector<HTMLButtonElement>('#mobile-menu-button');
const mobileSectionButton = document.querySelector<HTMLButtonElement>('#mobile-section-button');
const drawerBackdrop = document.querySelector<HTMLButtonElement>('#drawer-backdrop');
const drawerCloseButton = document.querySelector<HTMLButtonElement>('#drawer-close-button');

if (
  !sceneContainer ||
  !controlsContainer ||
  !viewerStatus ||
  !sectionCanvas ||
  !sectionShapeName ||
  !readoutOffset ||
  !readoutAngles ||
  !sectionNote ||
  !sidePanel ||
  !sectionPanel ||
  !mobileMenuButton ||
  !mobileSectionButton ||
  !drawerBackdrop ||
  !drawerCloseButton
) {
  throw new Error('必要なDOM要素を作成できませんでした');
}

const urlParams = new URLSearchParams(window.location.search);
const isPresentationWindow = urlParams.get('presentation') === '1';
const presentationChannel =
  typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('solid-section-viewer');

if (isPresentationWindow) {
  document.body.classList.add('presentation-window');
}

const openMobileDrawer = (focusSection = false) => {
  document.body.classList.add('drawer-open');
  sidePanel.setAttribute('aria-hidden', 'false');

  if (focusSection) {
    window.setTimeout(() => {
      sidePanel.scrollTo({
        top: Math.max(sectionPanel.offsetTop - 54, 0),
        behavior: 'smooth',
      });
    }, 60);
  } else {
    sidePanel.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

const closeMobileDrawer = () => {
  document.body.classList.remove('drawer-open');
  sidePanel.setAttribute('aria-hidden', 'true');
};

mobileMenuButton.addEventListener('click', () => openMobileDrawer(false));
mobileSectionButton.addEventListener('click', () => openMobileDrawer(true));
drawerBackdrop.addEventListener('click', closeMobileDrawer);
drawerCloseButton.addEventListener('click', closeMobileDrawer);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMobileDrawer();
  }
});

window.matchMedia('(max-width: 680px)').addEventListener('change', (event) => {
  if (!event.matches) {
    closeMobileDrawer();
  }
});

const slicerState = createInitialSlicerState();
slicerState.offset = readNumber(urlParams.get('offset'), slicerState.offset);
slicerState.rotationX = readNumber(urlParams.get('rx'), slicerState.rotationX);
slicerState.rotationY = readNumber(urlParams.get('ry'), slicerState.rotationY);
slicerState.rotationZ = readNumber(urlParams.get('rz'), slicerState.rotationZ);
slicerState.clipSide = readClipSide(urlParams.get('side'), slicerState.clipSide);

const learningScene = createLearningScene(sceneContainer, slicerState);
const sectionView = createSectionView(sectionCanvas);

let selectedSolid: SolidKind = readSolidKind(urlParams.get('outer')) ?? 'cube';
let selectedInnerSolid: SolidKind | null = readSolidKind(urlParams.get('inner'));
let currentSolid = createSolid(selectedSolid, learningScene.clippingPlane);
let selectedVertexLabels: string[] = [];
let vertexSelectionMessage = '3点で仮の切断面、4点で確定します。';
let ui: UiController | undefined;
applySolidComposition();

const renderReadouts = () => {
  viewerStatus.textContent =
    selectedVertexLabels.length > 0
      ? `${currentSolid.label}を切断中 / ${selectedVertexLabels.length}点を選択`
      : `${currentSolid.label}を切断中`;
  readoutOffset.textContent = slicerState.offset.toFixed(2);
  readoutAngles.textContent = `X ${Math.round(slicerState.rotationX)}° / Y ${Math.round(
    slicerState.rotationY,
  )}° / Z ${Math.round(slicerState.rotationZ)}°`;

  const result = sectionView.render({
    solids: learningScene.getSolids(),
    slicer: slicerState,
  });

  sectionShapeName.textContent = result.shapeName;
  sectionNote.textContent = selectedVertexLabels.length > 0 ? `${result.note} ${vertexSelectionMessage}` : result.note;
  ui?.updateSelectedPoints(selectedVertexLabels, vertexSelectionMessage);
  broadcastPresentationState();
};

const applySlicer = () => {
  selectedVertexLabels = [];
  vertexSelectionMessage = 'スライダーで手動調整中です。';
  learningScene.clearVertexSelection();
  updateSlicer(slicerState, learningScene);
  renderReadouts();
};

ui = createUi(controlsContainer, {
  state: slicerState,
  onStateChange: applySlicer,
  onSolidChange: (solidKind) => {
    selectedSolid = solidKind;
    selectedVertexLabels = [];
    vertexSelectionMessage = '3点で仮の切断面、4点で確定します。';
    applySolidComposition();
    renderReadouts();
  },
  onInnerSolidChange: (solidKind) => {
    selectedInnerSolid = solidKind;
    selectedVertexLabels = [];
    vertexSelectionMessage = solidKind ? '内側図形も同じ切断面で切断します。' : '内側図形を外しました。';
    applySolidComposition();
    renderReadouts();
  },
  onOpenPresentationWindow: openPresentationWindow,
  onClearVertexSelection: () => {
    selectedVertexLabels = [];
    vertexSelectionMessage = '点の選択をクリアしました。';
    learningScene.clearVertexSelection();
    renderReadouts();
  },
  onReset: () => {
    selectedVertexLabels = [];
    vertexSelectionMessage = '3点で仮の切断面、4点で確定します。';
    learningScene.clearVertexSelection();
    ui?.setState(createInitialSlicerState());
  },
  onToggleTransparent: (enabled) => {
    learningScene.setSolidTransparency(enabled);
  },
  onTogglePlaneVisible: (visible) => {
    learningScene.setPlaneVisible(visible);
  },
  onScreenshot: () => {
    learningScene.saveScreenshot();
  },
});

learningScene.setVertexSelectionHandler(({ vertices }) => {
  selectedVertexLabels = vertices.map((vertex) => vertex.label);

  const result = calculatePlaneFromSelection(vertices);
  vertexSelectionMessage = result.message;

  if (result.plane) {
    setSlicerFromPlane(slicerState, result.plane.normal, result.plane.constant);
    ui?.syncFromState();
    updateSlicer(slicerState, learningScene);
  }

  renderReadouts();
});

applySlicer();
learningScene.start();

type PresentationState = {
  outer: SolidKind;
  inner: SolidKind | null;
  offset: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  clipSide: 1 | -1;
};

presentationChannel?.addEventListener('message', (event: MessageEvent<PresentationState>) => {
  if (!isPresentationWindow || !isPresentationState(event.data)) {
    return;
  }

  selectedSolid = event.data.outer;
  selectedInnerSolid = event.data.inner;
  selectedVertexLabels = [];
  vertexSelectionMessage = '';
  slicerState.offset = event.data.offset;
  slicerState.rotationX = event.data.rotationX;
  slicerState.rotationY = event.data.rotationY;
  slicerState.rotationZ = event.data.rotationZ;
  slicerState.clipSide = event.data.clipSide;
  learningScene.clearVertexSelection();
  applySolidComposition();
  updateSlicer(slicerState, learningScene);
  renderReadouts();
});

function openPresentationWindow(): void {
  const url = new URL(window.location.href);
  const state = getPresentationState();
  url.search = new URLSearchParams({
    presentation: '1',
    outer: state.outer,
    inner: state.inner ?? '',
    offset: String(state.offset),
    rx: String(state.rotationX),
    ry: String(state.rotationY),
    rz: String(state.rotationZ),
    side: String(state.clipSide),
  }).toString();

  const opened = window.open(url.toString(), 'solid-section-presentation', 'popup,width=1280,height=720');
  opened?.focus();
  window.setTimeout(broadcastPresentationState, 250);
}

function getPresentationState(): PresentationState {
  return {
    outer: selectedSolid,
    inner: selectedInnerSolid,
    offset: slicerState.offset,
    rotationX: slicerState.rotationX,
    rotationY: slicerState.rotationY,
    rotationZ: slicerState.rotationZ,
    clipSide: slicerState.clipSide,
  };
}

function broadcastPresentationState(): void {
  if (isPresentationWindow) {
    return;
  }

  presentationChannel?.postMessage(getPresentationState());
}

function applySolidComposition(): void {
  const hasInnerSolid = selectedInnerSolid !== null;
  const outer = createSolid(selectedSolid, learningScene.clippingPlane, {
    color: '#4f8edb',
    opacity: hasInnerSolid ? 0.32 : 0.9,
    roleLabel: '外側',
    sectionColor: '#ffb43c',
  });
  outer.mesh.renderOrder = hasInnerSolid ? 2 : 0;
  const models = [outer];

  if (selectedInnerSolid) {
    const inner = createSolid(selectedInnerSolid, learningScene.clippingPlane, {
      color: '#e65d5d',
      opacity: 0.92,
      roleLabel: '内側',
      sectionColor: '#e65d5d',
    });
    inner.mesh.renderOrder = 1;
    fitInsideOuter(inner, outer);
    models.push(inner);
  }

  currentSolid = outer;
  learningScene.setSolids(models);
}

type SelectionPlaneResult = {
  plane?: THREE.Plane;
  message: string;
};

function calculatePlaneFromSelection(vertices: SolidVertex[]): SelectionPlaneResult {
  if (vertices.length === 0) {
    return { message: '点を4つ選んでください。' };
  }

  if (vertices.length < 3) {
    return { message: `あと${4 - vertices.length}点選ぶと切断面を作れます。` };
  }

  const plane = planeFromNonCollinearTriple(vertices);
  if (!plane) {
    return { message: '選んだ点が一直線上にあるため、切断面を決められません。' };
  }

  if (vertices.length === 3) {
    return {
      plane,
      message: '3点から仮の切断面を表示しています。あと1点選ぶと4点切断を確定します。',
    };
  }

  const maxDistance = Math.max(...vertices.map((vertex) => Math.abs(plane.distanceToPoint(vertex.position))));
  if (maxDistance > 0.03) {
    return {
      message: '4点が同じ平面上にありません。いずれかの点をクリックして外し、同一平面上の4点を選んでください。',
    };
  }

  return {
    plane,
    message: '4点を通る切断面で切断しています。',
  };
}

function planeFromNonCollinearTriple(vertices: SolidVertex[]): THREE.Plane | undefined {
  for (let i = 0; i < vertices.length - 2; i += 1) {
    for (let j = i + 1; j < vertices.length - 1; j += 1) {
      for (let k = j + 1; k < vertices.length; k += 1) {
        const a = vertices[i].position;
        const b = vertices[j].position;
        const c = vertices[k].position;
        const normal = b.clone().sub(a).cross(c.clone().sub(a));

        if (normal.length() > 1e-5) {
          return new THREE.Plane().setFromCoplanarPoints(a, b, c);
        }
      }
    }
  }

  return undefined;
}

function fitInsideOuter(inner: SolidModel, outer: SolidModel): void {
  const outerDimensions = getSolidDimensions(outer.kind);
  const outerCenter = new THREE.Vector3(0, outerDimensions.height / 2, 0);
  const innerMetrics = measureInnerSolid(inner);

  if (outer.kind === 'cone') {
    fitInsideCone(inner, innerMetrics, outerDimensions.radius ?? outerDimensions.width / 2, outerDimensions.height);
    return;
  }

  if (outer.kind === 'cylinder') {
    const radius = outerDimensions.radius ?? outerDimensions.width / 2;
    const scale = Math.min(
      outerDimensions.height / innerMetrics.size.y,
      radius / innerMetrics.radialRadius,
    );
    placeInnerByBoundingCenter(inner, scale, outerCenter);
    return;
  }

  if (outer.kind === 'sphere') {
    const radius = outerDimensions.radius ?? outerDimensions.width / 2;
    const scale = radius / innerMetrics.boundingSphereRadius;
    placeInnerByBoundingSphereCenter(inner, innerMetrics, scale, outerCenter);
    return;
  }

  const scale = Math.min(
    outerDimensions.width / innerMetrics.size.x,
    outerDimensions.height / innerMetrics.size.y,
    outerDimensions.depth / innerMetrics.size.z,
  );
  placeInnerByBoundingCenter(inner, scale, outerCenter);
}

type InnerMetrics = {
  box: THREE.Box3;
  size: THREE.Vector3;
  center: THREE.Vector3;
  boundingSphereCenter: THREE.Vector3;
  boundingSphereRadius: number;
  radialRadius: number;
};

function measureInnerSolid(inner: SolidModel): InnerMetrics {
  inner.mesh.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(inner.mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const sphere = getGeometryBoundingSphere(inner.mesh);

  return {
    box,
    size,
    center,
    boundingSphereCenter: sphere.center.clone(),
    boundingSphereRadius: sphere.radius,
    radialRadius: getHorizontalRadius(inner.mesh),
  };
}

function placeInnerByBoundingCenter(inner: SolidModel, scale: number, targetCenter: THREE.Vector3): void {
  inner.mesh.scale.setScalar(scale);
  inner.mesh.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(inner.mesh);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  inner.mesh.position.add(targetCenter.clone().sub(scaledCenter));
  inner.mesh.updateMatrixWorld(true);
}

function placeInnerByBoundingSphereCenter(
  inner: SolidModel,
  metrics: InnerMetrics,
  scale: number,
  targetCenter: THREE.Vector3,
): void {
  inner.mesh.scale.setScalar(scale);
  inner.mesh.updateMatrixWorld(true);

  const scaledSphereCenter = getGeometryBoundingSphere(inner.mesh).center;
  inner.mesh.position.add(targetCenter.clone().sub(scaledSphereCenter));
  inner.mesh.updateMatrixWorld(true);
}

function fitInsideCone(inner: SolidModel, metrics: InnerMetrics, coneRadius: number, coneHeight: number): void {
  const slant = Math.hypot(coneRadius, coneHeight);
  const insphereRadius = (coneRadius * coneHeight) / (slant + coneRadius);
  const scale = insphereRadius / metrics.boundingSphereRadius;
  const targetCenter = new THREE.Vector3(0, insphereRadius, 0);

  placeInnerByBoundingSphereCenter(inner, metrics, scale, targetCenter);
}

function getGeometryBoundingSphere(mesh: THREE.Mesh): THREE.Sphere {
  mesh.geometry.computeBoundingSphere();
  const localSphere = mesh.geometry.boundingSphere;

  if (!localSphere) {
    throw new Error('図形の外接球を計算できませんでした');
  }

  const worldScale = new THREE.Vector3();
  mesh.getWorldScale(worldScale);

  return new THREE.Sphere(
    localSphere.center.clone().applyMatrix4(mesh.matrixWorld),
    localSphere.radius * Math.max(worldScale.x, worldScale.y, worldScale.z),
  );
}

function getHorizontalRadius(mesh: THREE.Mesh): number {
  const position = mesh.geometry.getAttribute('position');
  const point = new THREE.Vector3();
  let radius = 0;

  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    radius = Math.max(radius, Math.hypot(point.x, point.z));
  }

  return radius;
}

function readSolidKind(value: string | null): SolidKind | null {
  const solidKinds: SolidKind[] = ['cube', 'box', 'cylinder', 'cone', 'sphere'];
  return value && solidKinds.includes(value as SolidKind) ? (value as SolidKind) : null;
}

function readNumber(value: string | null, fallback: number): number {
  const nextValue = value === null ? Number.NaN : Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function readClipSide(value: string | null, fallback: 1 | -1): 1 | -1 {
  return value === '-1' ? -1 : value === '1' ? 1 : fallback;
}

function isPresentationState(value: unknown): value is PresentationState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as PresentationState;
  return (
    readSolidKind(state.outer) !== null &&
    (state.inner === null || readSolidKind(state.inner) !== null) &&
    Number.isFinite(state.offset) &&
    Number.isFinite(state.rotationX) &&
    Number.isFinite(state.rotationY) &&
    Number.isFinite(state.rotationZ) &&
    (state.clipSide === 1 || state.clipSide === -1)
  );
}
