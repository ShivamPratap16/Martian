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

// Draws a map pin: a round light badge holding the logo, with a tail pointing at the plot.
// The light background keeps dark and transparent logos readable on the terrain.
const PIN_W = 128;
const PIN_H = 160;
async function pinTexture(src) {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = PIN_W;
  c.height = PIN_H;
  const ctx = c.getContext('2d');
  const r = 58;
  const cx = PIN_W / 2;
  const cy = r + 4;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#ff7a3d';
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy + r - 8);
  ctx.lineTo(cx, PIN_H - 2);
  ctx.lineTo(cx + 16, cy + r - 8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.fillStyle = '#faf4ee';
  ctx.fill();
  ctx.save();
  ctx.clip();
  const box = r * 1.25;
  const k = Math.min(box / img.width, box / img.height);
  const w = img.width * k;
  const h = img.height * k;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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

// Claimed plots: a warm tint on every claimed hex, plus a logo pin standing on it.
// Pins keep a fixed size on screen so logos stay readable from orbit; when pins would
// overlap, the older claims win and the rest fade out until you zoom in.
export function createClaimLayer() {
  const group = new THREE.Group();
  const tint = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffb27a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
  );
  group.add(tint);
  const pins = new Map(); // cell -> { sprite, claim, rect }; sprite is null while the logo loads

  function rebuildTint(claims) {
    const pts = [];
    for (const c of claims.values()) pts.push(...cellFill(c.cell, GRID_RADIUS + 0.0002).tris);
    tint.geometry.dispose();
    tint.geometry = new THREE.BufferGeometry();
    tint.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }

  async function addPin(claim) {
    if (pins.has(claim.cell)) return;
    const pin = { sprite: null, claim, rect: null };
    pins.set(claim.cell, pin);
    const tex = await pinTexture(claim.logo.src).catch(() =>
      pinTexture(logoDevUrl(claim.domain || claim.title || 'mars', 'monogram')).catch(() => null)
    );
    if (!tex) return;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 })
    );
    sprite.center.set(0.5, 0); // tail tip sits on the plot
    sprite.position.copy(cellFill(claim.cell, GRID_RADIUS).center);
    sprite.renderOrder = 10;
    group.add(sprite);
    pin.sprite = sprite;
  }

  const world = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const ndc = new THREE.Vector3();

  return {
    object: group,

    sync(claims) {
      rebuildTint(claims);
      for (const c of claims.values()) addPin(c);
    },

    // Call every frame before rendering.
    update(camera, width, height, dt) {
      const dist = camera.position.length();
      // Pin height in pixels: compact from orbit, bigger when zoomed in.
      const px = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(dist, 4, 1.2, 34, 68), 34, 68);
      const pinW = (px * PIN_W) / PIN_H;
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const now = Date.now();
      const placed = [];
      const ordered = [...pins.values()]
        .filter((p) => p.sprite)
        .sort((a, b) => a.claim.createdAt.localeCompare(b.claim.createdAt));

      for (const pin of ordered) {
        const { sprite } = pin;
        sprite.getWorldPosition(world);
        toCam.subVectors(camera.position, world);
        const camDist = toCam.length();
        const facing = normal.copy(world).normalize().dot(toCam.divideScalar(camDist));

        // World size that projects to `px` pixels at this distance.
        const h = (px * 2 * camDist * Math.tan(halfFov)) / height;
        sprite.scale.set((h * PIN_W) / PIN_H, h, 1);

        let show = facing > 0.08;
        pin.rect = null;
        if (show) {
          ndc.copy(world).project(camera);
          const x = (ndc.x * 0.5 + 0.5) * width;
          const y = (-ndc.y * 0.5 + 0.5) * height;
          const rect = { x0: x - pinW / 2, x1: x + pinW / 2, y0: y - px, y1: y };
          const pad = 4;
          show = !placed.some((r) => rect.x0 < r.x1 + pad && rect.x1 > r.x0 - pad && rect.y0 < r.y1 + pad && rect.y1 > r.y0 - pad);
          if (show) {
            placed.push(rect);
            pin.rect = rect;
          }
        }
        // Fade in/out, and fade out towards the planet's edge. A pin whose signal is
        // still travelling to Mars pulses faintly until it lands.
        let target = show ? THREE.MathUtils.smoothstep(facing, 0.08, 0.3) : 0;
        if (pin.claim.landsAt && Date.parse(pin.claim.landsAt) > now) target *= 0.55 + 0.25 * Math.sin(now / 250);
        const m = sprite.material;
        m.opacity += (target - m.opacity) * Math.min(1, dt * 10);
        sprite.visible = m.opacity > 0.01;
      }
    },

    // The claim whose pin is under the given screen point, if any.
    pinAt(x, y) {
      let hit = null;
      for (const pin of pins.values()) {
        const r = pin.rect;
        if (r && pin.sprite.material.opacity > 0.5 && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) hit = pin.claim;
      }
      return hit;
    },
  };
}
