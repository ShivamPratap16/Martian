import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import {
  createMars,
  createAtmosphere,
  createStars,
  createMoons,
  loadElevationSampler,
  latLonToVec3,
  vec3ToLatLon,
} from './planet.js';
import { allPlots, plotAt, plotInfo, createGridLines, createCellHighlight } from './grid.js';
import { FEATURES, featureAt, priceAt } from './features.js';
import { loadClaims, saveClaim, myFreeClaim } from './store.js';
import { createClaimLayer, normalizeUrl, findLogo, logoDevUrl, fileToLogo } from './logos.js';
import { lightDelaySeconds, formatDuration } from './orbits.js';
import { createMarsWind } from './sound.js';
import { createColonyLights } from './colony.js';
import { createLanding } from './landing.js';
import { canRecord, startRecording } from './recorder.js';
import { createTerraform, nextMilestone, reachedMilestone } from './terraform.js';

// ---------- renderer / scene / camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 500);
camera.position.set(0.9, 0.9, 3.6);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 1.12;
controls.maxDistance = 7;
controls.zoomSpeed = 0.7;

// ---------- lighting ----------
const sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x8899bb, 0x1a0d08, 0.12));

// ---------- world ----------
const manager = new THREE.LoadingManager();
manager.onLoad = () => document.getElementById('loader').classList.add('done');

const planet = new THREE.Group(); // everything that spins with Mars
planet.rotation.z = THREE.MathUtils.degToRad(-25.19 * 0.35); // hint of Mars' axial tilt
scene.add(planet);

const spin = new THREE.Group();
planet.add(spin);
const mars = createMars(manager, renderer);
spin.add(mars);

const atmosphere = createAtmosphere();
scene.add(atmosphere.group);
const terraform = createTerraform({ marsMesh: mars, atmosphere, parent: spin });
scene.add(createStars());

const moons = createMoons();
scene.add(moons.group);

// ---------- plots ----------
const cells = allPlots();
document.getElementById('stat-total').textContent = cells.length.toLocaleString();
const grid = createGridLines(cells);
spin.add(grid);

const hover = createCellHighlight(0xffe2c4, 0.12);
const selected = createCellHighlight(0xff7a3d, 0.28);
spin.add(hover.object, selected.object);

const claimLayer = createClaimLayer();
spin.add(claimLayer.object);
const colonies = createColonyLights();
spin.add(colonies.object);
let claims = new Map();
loadClaims().then((c) => {
  claims = c;
  claimLayer.sync(claims);
  colonies.sync(claims);
  updateClaimedStat();
});
function updateClaimedStat() {
  document.getElementById('stat-sold').textContent = claims.size.toLocaleString();
  if (!terraPreview) {
    terraform.setCount(claims.size);
    updateTerraWidget(claims.size);
  }
}

let elevationAt = null;
loadElevationSampler().then((fn) => (elevationAt = fn));

// ---------- landmark labels ----------
const labelsEl = document.getElementById('labels');
const featuresEl = document.getElementById('features');
const labels = FEATURES.filter((f) => Math.abs(f.lat) < 89).map((f) => {
  const el = document.createElement('button');
  el.className = `label tier-${f.tier.toLowerCase()}`;
  el.innerHTML = `<i></i><span>${f.name}</span>`;
  el.addEventListener('click', () => flyTo(f.lat, f.lon, 1.9));
  labelsEl.appendChild(el);
  return { f, el, local: latLonToVec3(f.lat, f.lon, 1.01) };
});
FEATURES.forEach((f) => {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.textContent = f.name;
  chip.addEventListener('click', () => {
    flyTo(f.lat, f.lon, 1.9);
    selectCell(plotAt(f.lat, f.lon));
  });
  featuresEl.appendChild(chip);
});

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const unitSphere = new THREE.Sphere(new THREE.Vector3(), 1);
const invMatrix = new THREE.Matrix4();
const localRay = new THREE.Ray();
const hit = new THREE.Vector3();

function pickLatLon(clientX, clientY) {
  pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  invMatrix.copy(spin.matrixWorld).invert();
  localRay.copy(raycaster.ray).applyMatrix4(invMatrix);
  return localRay.intersectSphere(unitSphere, hit) ? vec3ToLatLon(hit) : null;
}

let hoverCell = null;
const hovercard = document.getElementById('hovercard');
// A logo pin stands above its plot, so check pins before the ground under the cursor.
function pickCell(x, y) {
  const pinned = claimLayer.pinAt(x, y);
  if (pinned) return pinned.cell;
  const ll = pickLatLon(x, y);
  return ll ? plotAt(ll.lat, ll.lon) : null;
}

canvas.addEventListener('pointermove', (e) => {
  const cell = pickCell(e.clientX, e.clientY);
  if (cell !== hoverCell) {
    hoverCell = cell;
    hover.set(cell);
    showHovercard(claims.get(cell));
  }
  if (!hovercard.classList.contains('hidden')) positionHovercard(e.clientX, e.clientY);
  canvas.style.cursor = cell ? 'pointer' : 'grab';
});
canvas.addEventListener('pointerleave', () => {
  hoverCell = null;
  hover.set(null);
  showHovercard(null);
});

function showHovercard(claim) {
  hovercard.classList.toggle('hidden', !claim);
  if (!claim) return;
  $('hc-logo').src = claim.logo.src;
  $('hc-title').textContent = claim.title;
  $('hc-desc').textContent = claim.description;
  $('hc-domain').textContent = claim.domain;
}

function positionHovercard(x, y) {
  const w = hovercard.offsetWidth;
  const h = hovercard.offsetHeight;
  const left = x + 18 + w > window.innerWidth ? x - w - 18 : x + 18;
  const top = Math.min(window.innerHeight - h - 8, Math.max(8, y - h / 2));
  hovercard.style.transform = `translate(${left}px, ${top}px)`;
}

// Distinguish a click from a drag.
let downAt = null;
canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  userActive();
});
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  selectCell(pickCell(e.clientX, e.clientY));
});
canvas.addEventListener('wheel', userActive, { passive: true });

// ---------- plot panel ----------
const panel = document.getElementById('panel');
const $ = (id) => document.getElementById(id);
const fmtLat = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;

const show = (id, on) => $(id).classList.toggle('hidden', !on);
let selectedCell = null;

function selectCell(cell) {
  selectedCell = cell;
  selected.set(cell);
  show('claim-form', false);
  if (!cell) {
    panel.classList.add('hidden');
    return;
  }
  const info = plotInfo(cell);
  const feature = featureAt(info.lat, info.lon);
  const price = priceAt(info.lat, info.lon);
  const claim = claims.get(cell);
  const mine = myFreeClaim();

  $('panel-tag').textContent = feature ? `Famous plot · ${feature.tier}` : 'Founding Settler plot';
  $('panel-tag').className = `panel-tag tier-${(feature?.tier ?? 'standard').toLowerCase()}`;
  $('panel-title').textContent = feature ? feature.name : 'Martian plot';
  $('panel-region').textContent = claim
    ? ''
    : feature
      ? feature.blurb
      : 'Open terrain, free to claim. One free plot per person.';
  $('panel-id').textContent = cell;
  $('panel-coords').textContent = `${fmtLat(info.lat)}, ${fmtLon(info.lon)}`;
  $('panel-elev').textContent = elevationAt
    ? `${Math.round(elevationAt(info.lat, info.lon)).toLocaleString()} m`
    : '…';
  $('panel-area').textContent = `${Math.round(info.areaKm2).toLocaleString()} km²`;

  // Claimed: show the owner. Otherwise: price + the right call to action.
  show('owner', !!claim);
  show('panel-price-row', !claim);
  show('panel-cta', !claim);
  show('panel-goto-mine', false);
  if (claim) {
    $('owner-logo').src = claim.logo.src;
    $('owner-title').textContent = claim.title;
    $('owner-domain').textContent = claim.domain;
    $('owner-desc').textContent = claim.description;
    show('owner-desc', !!claim.description);
    $('owner-visit').href = claim.url;
    show('owner-visit', !!claim.url);
    $('owner-since').textContent =
      `${claim.free ? 'Founding Settler' : 'Owner'} since ${new Date(claim.createdAt).toLocaleDateString()}` +
      (cell === mine ? ' · this is your plot' : '');
    updateOwnerSignal();
    const video = videos.get(cell);
    show('owner-video', !!video);
    if (video) {
      $('owner-video').href = video.url;
      $('owner-video').download = `my-plot-on-mars.${video.ext}`;
    }
  } else {
    const cta = $('panel-cta');
    $('panel-price').textContent = price ? `$${price}` : 'Free';
    $('panel-status').textContent = 'Available';
    if (price) {
      cta.textContent = `Buy for $${price} · checkout coming soon`;
      cta.disabled = true;
    } else if (mine) {
      cta.textContent = 'You already claimed your free plot';
      cta.disabled = true;
      show('panel-goto-mine', true);
    } else {
      cta.textContent = 'Claim for free';
      cta.disabled = false;
    }
  }
  panel.classList.remove('hidden');
}
$('panel-close').addEventListener('click', () => selectCell(null));

$('panel-goto-mine').addEventListener('click', () => {
  const cell = myFreeClaim();
  if (!cell) return;
  const { lat, lon } = plotInfo(cell);
  flyTo(lat, lon, 1.35);
  selectCell(cell);
});

// ---------- claim form ----------
let formLogo = null; // { type: 'logodev' | 'monogram' | 'upload', src }
let lookupSeq = 0;
let lookupTimer = null;

function setFormLogo(logo, status) {
  formLogo = logo;
  $('f-logo').src = logo ? logo.src : '';
  $('f-logo-box').classList.toggle('empty', !logo);
  $('f-logo-status').textContent = status;
}

function resetForm() {
  $('claim-form').reset();
  $('f-desc-count').textContent = '0/100';
  $('f-error').textContent = '';
  setFormLogo(null, "Paste your link and we'll fetch your logo.");
}

$('panel-cta').addEventListener('click', () => {
  resetForm();
  show('panel-cta', false);
  show('panel-price-row', false);
  show('claim-form', true);
  $('f-url').focus();
});
$('f-cancel').addEventListener('click', () => selectCell(selectedCell));

$('f-url').addEventListener('input', () => {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(lookupLogo, 500);
});

async function lookupLogo() {
  if (formLogo?.type === 'upload') return; // an uploaded logo always wins
  const link = normalizeUrl($('f-url').value);
  if (!link) {
    setFormLogo(null, $('f-url').value.trim() ? 'That does not look like a website link.' : "Paste your link and we'll fetch your logo.");
    return;
  }
  const seq = ++lookupSeq;
  setFormLogo(null, 'Looking for your logo…');
  const src = await findLogo(link.domain);
  if (seq !== lookupSeq || formLogo?.type === 'upload') return;
  if (src) setFormLogo({ type: 'logodev', src }, `Found the logo for ${link.domain}.`);
  else setFormLogo({ type: 'monogram', src: logoDevUrl(link.domain) }, 'No logo found, so we made a letter badge. Upload yours for a better look.');
  if (!$('f-title').value.trim()) $('f-title').placeholder = link.domain;
}

$('f-upload-btn').addEventListener('click', () => $('f-file').click());
$('f-file').addEventListener('change', async () => {
  const file = $('f-file').files[0];
  if (!file) return;
  try {
    setFormLogo({ type: 'upload', src: await fileToLogo(file) }, 'Using your uploaded logo.');
  } catch (err) {
    $('f-error').textContent = err.message;
  }
});

$('f-desc').addEventListener('input', () => {
  $('f-desc-count').textContent = `${$('f-desc').value.length}/100`;
});

$('claim-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rawUrl = $('f-url').value.trim();
  const link = normalizeUrl(rawUrl);
  const err = (msg) => ($('f-error').textContent = msg);
  if (rawUrl && !link) return err('Check your website link.');
  if (!link && formLogo?.type !== 'upload') return err('Add your website link or upload a logo.');
  const title = $('f-title').value.trim() || link?.domain;
  if (!title) return err('Add a name for your plot.');
  const { lat, lon } = plotInfo(selectedCell);
  if (priceAt(lat, lon) > 0) return err('Famous plots can only be bought.');
  if (link && !formLogo) await lookupLogo(); // submitted before the lookup finished

  $('f-submit').disabled = true;
  try {
    await saveClaim(claims, {
      cell: selectedCell,
      title,
      description: $('f-desc').value.trim(),
      url: link?.url ?? '',
      domain: link?.domain ?? '',
      logo: formLogo,
      free: true,
      createdAt: new Date().toISOString(),
      // The claim "travels" to Mars at the speed of light, using today's real distance.
      landsAt: new Date(Date.now() + lightDelaySeconds() * 1000).toISOString(),
    });
    claimLayer.sync(claims);
    colonies.sync(claims);
    updateClaimedStat();
    selectCell(selectedCell);
    showSignalToast(claims.get(selectedCell));
    playLanding(claims.get(selectedCell));
  } catch (e2) {
    err(e2.message);
  } finally {
    $('f-submit').disabled = false;
  }
});

// ---------- camera fly-to & idle spin ----------
let idleSince = performance.now() - 10000;
let flight = null;
function userActive() {
  idleSince = performance.now();
  flight = null;
  document.getElementById('hint').classList.add('faded');
}

function flyTo(lat, lon, distance) {
  userActive();
  spin.updateMatrixWorld();
  const target = spin.localToWorld(latLonToVec3(lat, lon, 1)).normalize();
  flight = {
    fromDir: camera.position.clone().normalize(),
    toDir: target,
    fromDist: camera.position.length(),
    toDist: distance,
    t: 0,
  };
}

const q = new THREE.Quaternion();
const qa = new THREE.Quaternion();
function updateFlight(dt) {
  if (!flight) return;
  flight.t = Math.min(1, flight.t + dt / 1.6);
  const k = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2; // easeInOutCubic
  qa.setFromUnitVectors(flight.fromDir, flight.toDir);
  q.identity().slerp(qa, k);
  const dir = flight.fromDir.clone().applyQuaternion(q);
  camera.position.copy(dir.multiplyScalar(THREE.MathUtils.lerp(flight.fromDist, flight.toDist, k)));
  idleSince = performance.now();
  if (flight.t >= 1) flight = null;
}

// ---------- landing cinematic ----------
// After a claim: swoop down to an angled shot of the plot, watch the lander touch down,
// then pull back out to orbit. The whole sequence is recorded as a shareable clip.
const landing = createLanding(spin);
const CINE_IN = 1.8;
const CINE_OUT = 1.6;
const ease = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const origin = new THREE.Vector3();
const lookAt = new THREE.Vector3();
let cine = null;
const videos = new Map(); // cell -> { url, ext }

function playLanding(claim) {
  const { lat, lon } = plotInfo(claim.cell);
  spin.updateMatrixWorld();
  const p = spin.localToWorld(latLonToVec3(lat, lon, 1));
  const n = p.clone().normalize();
  // Film from the south side of the plot so the horizon sits at the top of the frame.
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y);
  if (north.lengthSq() < 1e-4) north.set(1, 0, 0).addScaledVector(n, -n.x);
  north.normalize();
  const shot = p.clone().addScaledVector(n, 0.16).addScaledVector(north, -0.2);

  userActive();
  controls.enabled = false;
  claimLayer.holdPin(claim.cell, Infinity);
  let recording = null;
  try {
    if (canRecord())
      recording = startRecording(canvas, {
        headline: `${claim.title} just landed on Mars`,
        subline: `${fmtLat(lat)}, ${fmtLon(lon)} · ${location.host}`,
      });
  } catch {
    recording = null; // recording is a bonus; the landing still plays
  }
  cine = { t: 0, p, n, shot, from: camera.position.clone(), outFrom: null, outStart: 0, recording, claim };
  landing
    .play(claim.cell, { delay: CINE_IN, touchdown: () => claimLayer.holdPin(claim.cell, Date.now()) })
    .then(() => {
      cine.outStart = cine.t;
      cine.outFrom = camera.position.clone();
    });
}

function updateCinematic(dt) {
  if (!cine) return false;
  cine.t += dt;
  if (!cine.outFrom) {
    const k = ease(Math.min(1, cine.t / CINE_IN));
    // Slow drift around the plot while the lander comes down.
    const drift = cine.shot.clone().sub(cine.p).applyAxisAngle(cine.n, cine.t * 0.05).add(cine.p);
    camera.position.lerpVectors(cine.from, drift, k);
    lookAt.lerpVectors(origin, cine.p, k);
  } else {
    const k = ease(Math.min(1, (cine.t - cine.outStart) / CINE_OUT));
    camera.position.lerpVectors(cine.outFrom, cine.n.clone().multiplyScalar(1.6), k);
    lookAt.lerpVectors(cine.p, origin, k);
    if (k >= 1) finishCinematic();
  }
  if (camera.position.length() < 1.03) camera.position.setLength(1.03);
  camera.lookAt(lookAt);
  idleSince = performance.now();
  return true;
}

async function finishCinematic() {
  const { recording, claim } = cine;
  cine = null;
  controls.enabled = true;
  if (!recording) return;
  const { blob, ext } = await recording.stop();
  videos.set(claim.cell, { url: URL.createObjectURL(blob), ext });
  if (selectedCell === claim.cell) selectCell(claim.cell);
}

// ---------- terraforming progress ----------
let terraPreview = null; // { t, from } while "Preview the future" runs
const PREVIEW_UP = 8;
const PREVIEW_HOLD = 3.5;
const PREVIEW_DOWN = 2;

function updateTerraWidget(count, previewing = false) {
  const total = terraform.total;
  const pct = (count / total) * 100;
  document.getElementById('terra-pct').textContent = `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
  document.getElementById('terra-fill').style.width = `${Math.min(100, pct)}%`;
  const next = nextMilestone(count);
  const reached = reachedMilestone(count);
  let text;
  if (previewing) text = reached ? `Preview · ${reached.icon} ${reached.name}` : 'Preview · today';
  else if (next) text = `Next: ${next.icon} ${next.name} at ${next.at.toLocaleString()} settlers · ${(next.at - count).toLocaleString()} to go`;
  else text = '🌍 Mars is fully terraformed. Thank you, settlers.';
  document.getElementById('terra-next').textContent = text;
  document.getElementById('terra').classList.toggle('previewing', previewing);
}

function updateTerraPreview(dt) {
  if (!terraPreview) return;
  const p = terraPreview;
  p.t += dt;
  const total = terraform.total;
  let count;
  if (p.t < PREVIEW_UP) count = p.from + (total - p.from) * ease(p.t / PREVIEW_UP);
  else if (p.t < PREVIEW_UP + PREVIEW_HOLD) count = total;
  else if (p.t < PREVIEW_UP + PREVIEW_HOLD + PREVIEW_DOWN) count = total + (p.from - total) * ease((p.t - PREVIEW_UP - PREVIEW_HOLD) / PREVIEW_DOWN);
  else {
    terraPreview = null;
    document.getElementById('terra-preview').textContent = '▶ Preview the future';
    updateClaimedStat();
    return;
  }
  terraform.setCount(count);
  updateTerraWidget(count, true);
}

document.getElementById('terra-preview').addEventListener('click', () => {
  if (terraPreview) {
    terraPreview.t = Math.max(terraPreview.t, PREVIEW_UP + PREVIEW_HOLD); // skip to the way back
    return;
  }
  terraPreview = { t: 0, from: claims.size };
  document.getElementById('terra-preview').textContent = '■ Back to today';
  // Pull back so the whole planet is in view.
  if (camera.position.length() < 2.8) {
    const { lat, lon } = vec3ToLatLon(spin.worldToLocal(camera.position.clone()));
    flyTo(lat, lon, 3.4);
  }
});

// ---------- per-frame ----------
// Sun angle from the camera direction: day keeps the visible disk lit, night puts it in shadow.
const DAY_SUN = 0.95;
const NIGHT_SUN = 2.75;
let sunAngle = DAY_SUN;
let sunTarget = DAY_SUN;
const clock = new THREE.Clock();
const up = new THREE.Vector3(0, 1, 0);
const sunDir = new THREE.Vector3();
const camDir = new THREE.Vector3();
const tmp = new THREE.Vector3();

function updateLabels() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camDir.copy(camera.position).normalize();
  const dist = camera.position.length();
  for (const { el, local } of labels) {
    tmp.copy(local);
    spin.localToWorld(tmp);
    const facing = tmp.clone().normalize().dot(camDir);
    const visible = facing > 0.35 + (dist < 2 ? 0.3 : 0);
    el.classList.toggle('off', !visible);
    if (!visible) continue;
    tmp.project(camera);
    el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px)`;
  }
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (!updateCinematic(dt)) {
    updateFlight(dt);
    // Slow sidereal-ish spin while idle.
    if (performance.now() - idleSince > 6000 && panel.classList.contains('hidden')) spin.rotation.y += dt * 0.03;
    controls.rotateSpeed = THREE.MathUtils.clamp((camera.position.length() - 1) * 0.5, 0.08, 0.8);
    controls.update();
  }

  // Sun sits off to the side of the camera so the visible disk shows a day/night terminator.
  // Night view swings the sun around behind Mars so the colony lights come out.
  sunAngle += (sunTarget - sunAngle) * Math.min(1, dt * 2.2);
  sunDir.copy(camera.position).normalize().applyAxisAngle(up, sunAngle);
  sunDir.y += 0.25;
  sunDir.normalize();
  sun.position.copy(sunDir).multiplyScalar(10);
  atmosphere.uniforms.sunDir.value.copy(sunDir);
  colonies.uniforms.sunDir.value.copy(sunDir);
  colonies.uniforms.time.value = t;

  // Grid fades in as you zoom closer.
  const d = camera.position.length();
  grid.material.opacity = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(d, 3.2, 1.5, 0.05, 0.4), 0.05, 0.4);

  moons.update(t);
  updateTerraPreview(dt);
  terraform.update(dt, t);
  updateLabels();
  claimLayer.update(camera, window.innerWidth, window.innerHeight, dt);
  const shake = landing.update(dt);
  camera.position.add(shake);
  renderer.render(scene, camera);
  camera.position.sub(shake);
  cine?.recording?.frame();
  requestAnimationFrame(animate);
}
animate();

// ---------- signal delay (real Earth–Mars light time) ----------
const secondsUntil = (iso) => (new Date(iso).getTime() - Date.now()) / 1000;
let toastClaim = null;
let toastHideTimer = null;

function showSignalToast(claim) {
  if (!claim?.landsAt) return;
  toastClaim = claim;
  clearTimeout(toastHideTimer);
  $('toast-title').textContent = 'Signal sent to Mars';
  show('toast', true);
  updateSignal();
}

function updateOwnerSignal() {
  const claim = claims.get(selectedCell);
  const el = $('owner-signal');
  if (!claim?.landsAt) return show('owner-signal', false);
  const left = secondsUntil(claim.landsAt);
  el.textContent = left > 0 ? `📡 Signal in transit · reaches Mars in ${formatDuration(left)}` : '🟢 Flag landed on Mars';
  el.classList.toggle('in-transit', left > 0);
  show('owner-signal', true);
}

function updateSignal() {
  $('stat-delay').textContent = formatDuration(lightDelaySeconds());
  if (!panel.classList.contains('hidden')) updateOwnerSignal();
  if (toastClaim) {
    const left = secondsUntil(toastClaim.landsAt);
    if (left > 0) {
      $('toast-body').textContent = `Travelling at the speed of light. Your flag reaches Mars in ${formatDuration(left)}.`;
    } else {
      $('toast-title').textContent = 'Your flag has landed on Mars';
      $('toast-body').textContent = `${toastClaim.title} is now part of the Martian map.`;
      toastClaim = null;
      toastHideTimer = setTimeout(() => show('toast', false), 8000);
    }
  }
}
updateSignal();
setInterval(updateSignal, 1000);
$('toast').addEventListener('click', () => {
  toastClaim = null;
  show('toast', false);
});

// ---------- night view ----------
$('night-btn').addEventListener('click', () => {
  const night = sunTarget === DAY_SUN;
  sunTarget = night ? NIGHT_SUN : DAY_SUN;
  $('night-btn').setAttribute('aria-pressed', String(night));
  $('night-label').textContent = night ? 'Day view' : 'Night view';
  $('night-btn').querySelector('.sound-icon').textContent = night ? '☀️' : '🌙';
});

// ---------- real Mars wind ----------
const wind = createMarsWind();
$('sound-btn').addEventListener('click', async () => {
  const btn = $('sound-btn');
  if (wind.playing) {
    wind.stop();
  } else {
    $('sound-label').textContent = 'Loading…';
    try {
      await wind.start();
    } catch {
      $('sound-caption').textContent = 'Could not play audio in this browser.';
    }
  }
  btn.setAttribute('aria-pressed', String(wind.playing));
  btn.querySelector('.sound-icon').textContent = wind.playing ? '🔈' : '🔊';
  $('sound-label').textContent = wind.playing ? 'Listening to Mars' : 'Hear Mars';
  $('sound-caption').textContent = wind.playing
    ? "Recorded at Jezero Crater by NASA's Perseverance rover, 20 Feb 2021"
    : "Real wind recorded by NASA's Perseverance rover";
});

if (import.meta.env.DEV) {
  window.__mars = {
    camera,
    controls,
    spin,
    flyTo,
    // Preview a busy Mars: __mars.previewColonies(5000). Visual only, nothing is saved.
    previewColonies(n) {
      const pick = new Set();
      while (pick.size < Math.min(n, cells.length)) pick.add(cells[Math.floor(Math.random() * cells.length)]);
      colonies.preview([...pick, ...claims.keys()]);
    },
  };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
