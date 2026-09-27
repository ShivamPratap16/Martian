import * as THREE from 'three';
import {
  getRes0Cells,
  cellToChildren,
  originToDirectedEdges,
  getDirectedEdgeDestination,
  directedEdgeToBoundary,
  cellToBoundary,
  cellToLatLng,
  latLngToCell,
  cellArea,
  UNITS,
} from 'h3-js';
import { latLonToVec3, GRID_RADIUS } from './planet.js';

// H3 resolution for plots. 3 → 41,162 plots of ~3,500 km² each on Mars.
// 4 → 288,122 plots of ~500 km² (more inventory, heavier grid).
export const PLOT_RES = 3;

// H3 is defined on a unit sphere; areas it reports assume Earth's radius.
const MARS_AREA_FACTOR = (3389.5 / 6371.0088) ** 2;

export function allPlots() {
  return getRes0Cells().flatMap((c) => cellToChildren(c, PLOT_RES));
}

export function plotAt(lat, lon) {
  return latLngToCell(lat, lon, PLOT_RES);
}

export function plotInfo(cell) {
  const [lat, lon] = cellToLatLng(cell);
  return { id: cell, lat, lon, areaKm2: cellArea(cell, UNITS.km2) * MARS_AREA_FACTOR };
}

// One LineSegments object with every hex edge drawn once.
export function createGridLines(cells) {
  const pts = [];
  const a = new THREE.Vector3();
  for (const cell of cells) {
    for (const edge of originToDirectedEdges(cell)) {
      if (cell > getDirectedEdgeDestination(edge)) continue; // shared edge, draw from one side only
      const b = directedEdgeToBoundary(edge);
      for (let i = 0; i < b.length - 1; i++) {
        latLonToVec3(b[i][0], b[i][1], GRID_RADIUS, a);
        pts.push(a.x, a.y, a.z);
        latLonToVec3(b[i + 1][0], b[i + 1][1], GRID_RADIUS, a);
        pts.push(a.x, a.y, a.z);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffd9b8, transparent: true, opacity: 0.1, depthWrite: false })
  );
}

// Outline + translucent fill for a single hex, reused for hover and selection.
export function createCellHighlight(color, fillOpacity) {
  const group = new THREE.Group();
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
  );
  const fill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: fillOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  group.add(fill, line);
  group.visible = false;

  const v = new THREE.Vector3();
  return {
    object: group,
    set(cell) {
      if (!cell) {
        group.visible = false;
        return;
      }
      const boundary = cellToBoundary(cell);
      const r = GRID_RADIUS + 0.0003;
      const ring = boundary.flatMap(([la, lo]) => latLonToVec3(la, lo, r, v).toArray());
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry();
      line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));

      const [cla, clo] = cellToLatLng(cell);
      const center = latLonToVec3(cla, clo, r, v).toArray();
      const tris = [];
      const n = boundary.length;
      for (let i = 0; i < n; i++) {
        tris.push(...center, ...ring.slice(i * 3, i * 3 + 3), ...ring.slice(((i + 1) % n) * 3, ((i + 1) % n) * 3 + 3));
      }
      fill.geometry.dispose();
      fill.geometry = new THREE.BufferGeometry();
      fill.geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
      group.visible = true;
    },
  };
}
