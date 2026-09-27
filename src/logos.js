import * as THREE from 'three';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import { latLonToVec3, GRID_RADIUS } from './planet.js';

const LOGO_DEV_KEY = import.meta.env.VITE_LOGO_DEV_KEY;

// Accepts "notion.so", "https://www.notion.so/product" etc. Returns null if not a web link.
export function normalizeUrl(input) {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return { url: u.href, domain: u.hostname.replace(/^www\./, '') };
  } catch {
    return null;
  }
}

// fallback: '404' to detect missing logos, 'monogram' for Logo.dev's letter badge.
export function logoDevUrl(domain, fallback = 'monogram') {
  const params = new URLSearchParams({ token: LOGO_DEV_KEY, size: '256', format: 'png', retina: 'true', fallback });
  return `https://img.logo.dev/${encodeURIComponent(domain)}?${params}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

// Resolves to a real logo URL for the domain, or null if Logo.dev has none.
export async function findLogo(domain) {
  const src = logoDevUrl(domain, '404');
  try {
    await loadImage(src);
    return src;
  } catch {
    return null;
  }
}

// Shrinks an uploaded file to a 256px PNG data URL so it stays small in storage.
export async function fileToLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG or WebP image.');
  if (file.size > 3 * 1024 * 1024) throw new Error('Image must be under 3 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = 256;
    const k = Math.min(1, s / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Draws the logo on a round light badge so dark and transparent logos stay readable on the terrain.
async function badgeTexture(src) {
  const img = await loadImage(src);
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(250, 244, 238, 0.95)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255, 122, 61, 0.9)';
  ctx.stroke();
  ctx.save();
  ctx.clip();
  const box = s * 0.62;
  const k = Math.min(box / img.width, box / img.height);
  const w = img.width * k;
  const h = img.height * k;
  ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Points on the sphere for one hex, plus a triangle fan filling it.
export function cellFill(cell, r) {
  const v = new THREE.Vector3();
  const ring = cellToBoundary(cell).map(([la, lo]) => latLonToVec3(la, lo, r, v).toArray());
  const [cla, clo] = cellToLatLng(cell);
  const center = latLonToVec3(cla, clo, r, v).toArray();
  const tris = [];
  for (let i = 0; i < ring.length; i++) tris.push(...center, ...ring[i], ...ring[(i + 1) % ring.length]);
  return { center: new THREE.Vector3(...center), ring: ring.map((p) => new THREE.Vector3(...p)), tris };
}

// Claimed plots: a warm tint on every claimed hex (visible from far away) and a logo badge
// lying flat on the surface (readable when zoomed in).
export function createClaimLayer() {
  const group = new THREE.Group();
  const tint = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffb27a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
  );
  group.add(tint);
  const badges = new Map();
  const up = new THREE.Vector3(0, 1, 0);
  const alt = new THREE.Vector3(1, 0, 0);

  function rebuildTint(claims) {
    const pts = [];
    for (const c of claims.values()) pts.push(...cellFill(c.cell, GRID_RADIUS + 0.0002).tris);
    tint.geometry.dispose();
    tint.geometry = new THREE.BufferGeometry();
    tint.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }

  async function addBadge(claim) {
    if (badges.has(claim.cell)) return;
    badges.set(claim.cell, null);
    const { center, ring } = cellFill(claim.cell, GRID_RADIUS + 0.0008);
    // Inscribed circle of the hex, so the round badge never spills over the edges.
    const inner = Math.min(...ring.map((p) => p.distanceTo(center))) * Math.cos(Math.PI / 6);
    let tex;
    try {
      tex = await badgeTexture(claim.logo.src);
    } catch {
      tex = await badgeTexture(logoDevUrl(claim.domain || claim.title || 'mars', 'monogram')).catch(() => null);
    }
    if (!tex) return;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(inner * 1.9, inner * 1.9),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    // Lay the badge flat on the surface with its top pointing north.
    const n = center.clone().normalize();
    const east = new THREE.Vector3().crossVectors(Math.abs(n.y) > 0.99 ? alt : up, n).normalize();
    const north = new THREE.Vector3().crossVectors(n, east);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, north, n));
    mesh.position.copy(center);
    mesh.renderOrder = 2;
    group.add(mesh);
    badges.set(claim.cell, mesh);
  }

  return {
    object: group,
    sync(claims) {
      rebuildTint(claims);
      for (const c of claims.values()) addBadge(c);
    },
  };
}
