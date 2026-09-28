// Sound for the landing: rocket rumble that follows the throttle, touchdown thud,
// pyro cable cut, flag whoosh, and the real Perseverance wind recording underneath.
// Everything goes to the speakers and to a MediaStream so the video gets it too.

export function createLandingAudio() {
  let ctx = null;
  let master = null;
  let streamDest = null;
  let noise = null;
  let thrust = null;
  let wind = null;
  let windBuffer = null;

  function noiseBuffer() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Brown-ish noise: deep and rumbly.
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  function envGain(peak, attack, decay, at = ctx.currentTime) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(master);
    return g;
  }

  function noiseSource() {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    return src;
  }

  return {
    // Must run inside a click handler so browsers allow sound.
    unlock() {
      if (!ctx) {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
        streamDest = ctx.createMediaStreamDestination();
        master.connect(streamDest);
        noise = noiseBuffer();
        fetch('/audio/mars-wind.mp3')
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b))
          .then((b) => (windBuffer = b))
          .catch(() => {});
      }
      ctx.resume();
    },

    get stream() {
      return streamDest?.stream ?? null;
    },

    start() {
      if (!ctx) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(0.9, now);
      // Rocket: low rumble + a hissy upper band.
      const low = noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 200;
      const lowGain = ctx.createGain();
      lowGain.gain.value = 0;
      low.connect(lp).connect(lowGain).connect(master);
      const hiss = noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.6;
      const hissGain = ctx.createGain();
      hissGain.gain.value = 0;
      hiss.connect(bp).connect(hissGain).connect(master);
      low.start();
      hiss.start(now, Math.random());
      thrust = { low, hiss, lp, lowGain, hissGain };

      if (windBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = windBuffer;
        src.loop = true;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.45, now + 2);
        src.connect(g).connect(master);
        src.start();
        wind = { src, g };
      }
    },

    // k: engine throttle scaled by how close the camera is (0..1).
    setThrust(k) {
      if (!thrust) return;
      const now = ctx.currentTime;
      thrust.lp.frequency.setTargetAtTime(140 + 520 * k, now, 0.08);
      thrust.lowGain.gain.setTargetAtTime(1.1 * k, now, 0.08);
      thrust.hissGain.gain.setTargetAtTime(0.12 * k, now, 0.08);
    },

    thud() {
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.45);
      osc.connect(envGain(0.9, 0.01, 0.6));
      osc.start(now);
      osc.stop(now + 0.7);
      const n = noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      n.connect(lp).connect(envGain(0.6, 0.005, 0.5));
      n.start(now);
      n.stop(now + 0.6);
    },

    // Pyrotechnic cable cutters: two sharp metallic clicks.
    snap() {
      if (!ctx) return;
      for (const [f, dt] of [[1900, 0], [2600, 0.06]]) {
        const at = ctx.currentTime + dt;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        osc.connect(envGain(0.18, 0.002, 0.22, at));
        osc.start(at);
        osc.stop(at + 0.3);
      }
    },

    whoosh() {
      if (!ctx) return;
      const now = ctx.currentTime;
      const n = noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(300, now);
      bp.frequency.exponentialRampToValueAtTime(2400, now + 0.9);
      n.connect(bp).connect(envGain(0.22, 0.25, 0.8));
      n.start(now);
      n.stop(now + 1.2);
    },

    stop(fade = 1.2) {
      if (!ctx) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0.0001, now + fade);
      const t = thrust;
      const w = wind;
      thrust = null;
      wind = null;
      setTimeout(() => {
        try {
          t?.low.stop();
          t?.hiss.stop();
          w?.src.stop();
        } catch {
          // already stopped
        }
      }, fade * 1000 + 100);
    },
  };
}
