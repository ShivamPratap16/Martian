// 2D overlay for the landing: NASA-style telemetry, fades and the closing card.
// The same function draws on the full-screen overlay canvas and on every frame of the
// recorded video, so what people share matches what they saw.
//
// state: { fade, hud, end: { k, logoImg, title, subline, cta } }

const FONT = '"Space Grotesk", system-ui, sans-serif';
const FADE_RGB = '236, 212, 188';

function mmss(t) {
  const s = Math.floor(t);
  return `T+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function text(ctx, str, x, y, size, { weight = 400, color = '#f4ebe3', align = 'left', spacing = 0, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = size * 0.35;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function drawHud(ctx, w, h, u, hud) {
  const pad = 44 * u;
  // Top left: live feed marker and mission clock.
  const blink = Math.floor(hud.clock * 2) % 2 === 0;
  ctx.fillStyle = blink ? '#ff4d3a' : 'rgba(255,77,58,0.35)';
  ctx.beginPath();
  ctx.arc(pad + 8 * u, pad + 12 * u, 8 * u, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, 'LIVE · MARS SURFACE', pad + 26 * u, pad + 20 * u, 22 * u, { weight: 700, spacing: 3 * u });
  text(ctx, mmss(hud.clock), pad, pad + 56 * u, 22 * u, { color: '#d9c6b6', spacing: 2 * u });
  // Top right: brand.
  text(ctx, 'CLAIM MARS', w - pad, pad + 20 * u, 22 * u, { weight: 700, align: 'right', spacing: 5 * u });

  // Bottom left: phase and live numbers.
  const base = h - pad - 8 * u;
  text(ctx, hud.phase, pad, base - (hud.showNumbers ? 50 * u : 0), 40 * u, { weight: 700, spacing: 2 * u });
  if (hud.showNumbers) {
    const alt = hud.alt >= 10 ? hud.alt.toFixed(0) : hud.alt.toFixed(1);
    text(ctx, `ALT ${alt} m     VEL ${hud.vel.toFixed(1)} m/s`, pad, base, 26 * u, { color: '#ffb27a', spacing: 2 * u });
  }
  // Thin frame corners, like a camera viewfinder.
  ctx.strokeStyle = 'rgba(244,235,227,0.5)';
  ctx.lineWidth = 2 * u;
  const c = 34 * u;
  const m = 20 * u;
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * c);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * c, y);
    ctx.stroke();
  }
}

function drawEndCard(ctx, w, h, u, end) {
  const k = Math.min(1, end.k);
  const e = 1 - (1 - k) ** 3;
  ctx.save();
  ctx.globalAlpha = e;
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.5, Math.max(w, h) * 0.7);
  g.addColorStop(0, 'rgba(20,10,6,0.55)');
  g.addColorStop(1, 'rgba(8,4,3,0.88)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Logo badge.
  const r = 110 * u * (0.85 + 0.15 * e);
  const cx = w / 2;
  const cy = h * 0.36;
  ctx.shadowColor = 'rgba(255,122,61,0.55)';
  ctx.shadowBlur = 40 * u;
  ctx.fillStyle = '#ff7a3d';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#f7f1ea';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 9 * u, 0, Math.PI * 2);
  ctx.fill();
  if (end.logoImg) {
    const box = r * 1.15;
    const s = Math.min(box / end.logoImg.width, box / end.logoImg.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 9 * u, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(end.logoImg, cx - (end.logoImg.width * s) / 2, cy - (end.logoImg.height * s) / 2, end.logoImg.width * s, end.logoImg.height * s);
    ctx.restore();
  }

  const lift = (1 - e) * 20 * u;
  text(ctx, `${end.title} landed on Mars`, cx, cy + r + 90 * u + lift, 58 * u, { weight: 700, align: 'center' });
  text(ctx, end.subline, cx, cy + r + 140 * u + lift, 28 * u, { color: '#d9c6b6', align: 'center', spacing: 1 * u });

  // Call to action pill.
  const label = end.cta;
  ctx.font = `600 28px ${FONT}`;
  const tw = ctx.measureText(label).width * u + 64 * u;
  const py = cy + r + 200 * u + lift;
  ctx.fillStyle = '#ff7a3d';
  ctx.beginPath();
  ctx.roundRect(cx - tw / 2, py, tw, 60 * u, 30 * u);
  ctx.fill();
  text(ctx, label, cx, py + 40 * u, 28 * u, { weight: 600, align: 'center', color: '#1a0e08' });
  ctx.restore();
}

// Draws on top of whatever is already in ctx (the caller clears it if needed).
export function drawOverlay(ctx, w, h, st) {
  if (!st) return;
  const u = Math.min(w, h) / 1080;
  if (st.hud?.visible) drawHud(ctx, w, h, u, st.hud);
  if (st.fade > 0.001) {
    ctx.fillStyle = `rgba(${FADE_RGB}, ${Math.min(1, st.fade)})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (st.end && st.end.k > 0) drawEndCard(ctx, w, h, u, st.end);
}
