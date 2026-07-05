import * as THREE from 'three';

export type PlaneProjection = {
  axisU: THREE.Vector3;
  axisV: THREE.Vector3;
};

export type ProjectedPoint = {
  x: number;
  y: number;
};

export function calculateMeshSectionPolygon(mesh: THREE.Mesh, plane: THREE.Plane): THREE.Vector3[] {
  mesh.updateMatrixWorld(true);

  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const points: THREE.Vector3[] = [];
  const triangle = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const epsilon = 1e-5;

  const readVertex = (vertexIndex: number, target: THREE.Vector3) => {
    target.fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld);
  };

  const triangleCount = index ? index.count / 3 : position.count / 3;
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = index ? index.getX(triangleIndex * 3 + corner) : triangleIndex * 3 + corner;
      readVertex(vertexIndex, triangle[corner]);
    }

    addEdgeIntersection(points, plane, triangle[0], triangle[1], epsilon);
    addEdgeIntersection(points, plane, triangle[1], triangle[2], epsilon);
    addEdgeIntersection(points, plane, triangle[2], triangle[0], epsilon);
  }

  const unique = uniquePoints(points, 1e-4);
  if (unique.length < 3) {
    return [];
  }

  return convexHullOnPlane(unique, plane.normal);
}

export function createPlaneProjection(normal: THREE.Vector3): PlaneProjection {
  const normalized = normal.clone().normalize();
  const reference = Math.abs(normalized.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);

  return {
    axisU: new THREE.Vector3().crossVectors(reference, normalized).normalize(),
    axisV: new THREE.Vector3().crossVectors(normalized, new THREE.Vector3().crossVectors(reference, normalized).normalize()).normalize(),
  };
}

export function projectPointToPlane(point: THREE.Vector3, projection: PlaneProjection, origin: THREE.Vector3): ProjectedPoint {
  const relative = point.clone().sub(origin);
  return {
    x: relative.dot(projection.axisU),
    y: relative.dot(projection.axisV),
  };
}

function addEdgeIntersection(
  points: THREE.Vector3[],
  plane: THREE.Plane,
  start: THREE.Vector3,
  end: THREE.Vector3,
  epsilon: number,
): void {
  const startDistance = plane.distanceToPoint(start);
  const endDistance = plane.distanceToPoint(end);

  if (Math.abs(startDistance) < epsilon) {
    points.push(start.clone());
  }

  if (startDistance * endDistance < 0) {
    const t = startDistance / (startDistance - endDistance);
    points.push(start.clone().lerp(end, t));
  }

  if (Math.abs(endDistance) < epsilon) {
    points.push(end.clone());
  }
}

function uniquePoints(points: THREE.Vector3[], threshold: number): THREE.Vector3[] {
  const unique: THREE.Vector3[] = [];

  points.forEach((candidate) => {
    if (!unique.some((point) => point.distanceTo(candidate) < threshold)) {
      unique.push(candidate);
    }
  });

  return unique;
}

function convexHullOnPlane(points: THREE.Vector3[], normal: THREE.Vector3): THREE.Vector3[] {
  const projection = createPlaneProjection(normal);
  const projected = points.map((point) => ({
    point,
    x: point.dot(projection.axisU),
    y: point.dot(projection.axisV),
  }));

  projected.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (origin: (typeof projected)[number], a: (typeof projected)[number], b: (typeof projected)[number]) =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);

  const lower: typeof projected = [];
  for (const item of projected) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], item) <= 1e-6) {
      lower.pop();
    }
    lower.push(item);
  }

  const upper: typeof projected = [];
  for (let i = projected.length - 1; i >= 0; i -= 1) {
    const item = projected[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], item) <= 1e-6) {
      upper.pop();
    }
    upper.push(item);
  }

  return lower
    .slice(0, -1)
    .concat(upper.slice(0, -1))
    .map((item) => item.point);
}
