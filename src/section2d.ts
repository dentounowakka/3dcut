import * as THREE from 'three';
import { normalFromSlicer, type SlicerState } from './slicer';
import { calculateMeshSectionPolygon, createPlaneProjection, projectPointToPlane, type ProjectedPoint } from './sectionMath';
import type { SolidKind, SolidModel } from './solids';

export type SectionRenderInput = {
  solids: SolidModel[];
  slicer: SlicerState;
};

export type SectionRenderResult = {
  shapeName: string;
  note: string;
};

type SectionContour = {
  label: string;
  color: string;
  points: ProjectedPoint[];
  shapeName: string;
};

export function createSectionView(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('2D Canvas を初期化できませんでした');
  }

  const render = (input: SectionRenderInput): SectionRenderResult => {
    resizeCanvas(canvas);
    clear(context, canvas);

    const planeNormal = normalFromSlicer(input.slicer);
    const plane = new THREE.Plane(planeNormal, input.slicer.offset);
    const polygons = input.solids
      .map((solid) => ({
        solid,
        polygon: calculateMeshSectionPolygon(solid.mesh, plane),
      }))
      .filter((entry) => entry.polygon.length >= 3);

    if (polygons.length === 0) {
      drawEmpty(context, canvas);
      return {
        shapeName: '断面なし',
        note: '切断平面が表示中の図形に触れていません。',
      };
    }

    const allPoints = polygons.flatMap((entry) => entry.polygon);
    const origin = allPoints.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(allPoints.length);
    const projection = createPlaneProjection(planeNormal);
    const contours: SectionContour[] = polygons.map(({ solid, polygon }) => ({
      label: `${solid.roleLabel}: ${solid.label}`,
      color: solid.sectionColor,
      points: polygon.map((point) => projectPointToPlane(point, projection, origin)),
      shapeName: sectionShapeName(solid.kind, polygon.length, planeNormal),
    }));

    drawContours(context, canvas, contours);

    return {
      shapeName: contours.length > 1 ? '複合断面' : contours[0].shapeName,
      note: `${contours.map((contour) => `${contour.label}=${contour.shapeName}`).join(' / ')} を表示しています。`,
    };
  };

  return { render };
}

function drawContours(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, contours: SectionContour[]): void {
  drawGrid(context, canvas);

  const padding = 42;
  const allPoints = contours.flatMap((contour) => contour.points);
  const maxAbs = Math.max(...allPoints.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]), 1);
  const scale = Math.max(10, Math.min(canvas.width, canvas.height) / 2 - padding);
  const normalizedScale = scale / maxAbs;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  contours
    .slice()
    .sort((a, b) => polygonArea(b.points) - polygonArea(a.points))
    .forEach((contour) => {
      context.beginPath();
      contour.points.forEach((point, index) => {
        const x = centerX + point.x * normalizedScale;
        const y = centerY - point.y * normalizedScale;
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.closePath();

      context.fillStyle = colorWithAlpha(contour.color, 0.24);
      context.strokeStyle = contour.color;
      context.lineWidth = 3;
      context.fill();
      context.stroke();

      contour.points.forEach((point) => {
        const x = centerX + point.x * normalizedScale;
        const y = centerY - point.y * normalizedScale;
        context.beginPath();
        context.arc(x, y, 3.5, 0, Math.PI * 2);
        context.fillStyle = contour.color;
        context.fill();
      });
    });

  drawLegend(context, canvas, contours);
}

function drawLegend(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, contours: SectionContour[]): void {
  const x = 16;
  let y = 24;

  contours.forEach((contour) => {
    context.fillStyle = contour.color;
    context.fillRect(x, y - 10, 12, 12);
    context.fillStyle = '#33515f';
    context.font = '13px system-ui, sans-serif';
    context.textAlign = 'left';
    context.fillText(`${contour.label} (${contour.shapeName})`, x + 18, y);
    y += 20;
  });
}

function drawEmpty(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  drawGrid(context, canvas);
  context.fillStyle = '#64727a';
  context.font = '15px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText('断面がありません', canvas.width / 2, canvas.height / 2);
}

function drawGrid(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  context.strokeStyle = '#dbe5e9';
  context.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 24) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 24) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }
}

function clear(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f8fbfc';
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(280, Math.floor(rect.width * ratio));
  const height = Math.max(220, Math.floor(rect.height * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function polygonArea(points: ProjectedPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(area / 2);
}

function sectionShapeName(kind: SolidKind, sides: number, normal: THREE.Vector3): string {
  if (kind === 'sphere') {
    return '円';
  }

  if (kind === 'cylinder') {
    if (sides >= 16) {
      return Math.abs(normal.y) > 0.92 ? '円' : '楕円';
    }
    return polygonName(sides);
  }

  if (kind === 'cone') {
    if (sides >= 16) {
      return Math.abs(normal.y) > 0.92 ? '円' : '楕円';
    }
    return polygonName(sides);
  }

  return polygonName(sides);
}

function polygonName(sides: number): string {
  const names: Record<number, string> = {
    3: '三角形',
    4: '四角形',
    5: '五角形',
    6: '六角形',
  };
  return names[sides] ?? `${sides}角形`;
}

function colorWithAlpha(color: string, alpha: number): string {
  const parsed = new THREE.Color(color);
  return `rgba(${Math.round(parsed.r * 255)}, ${Math.round(parsed.g * 255)}, ${Math.round(parsed.b * 255)}, ${alpha})`;
}
