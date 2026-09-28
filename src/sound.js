// Real Martian wind, recorded by NASA's Perseverance rover microphone on 20 Feb 2021
// (filtered to remove rover self-noise). The clip has fades baked in, so overlapping
// copies scheduled back to back give a seamless crossfaded loop.

const SRC = '/audio/mars-wind.mp3';
const OVERLAP = 1.6; // seconds, matches the fades in the file

export function createMarsWind() {
  let ctx = null;
  let buffer = null;
  let master = null;
  let timer = null;
  let nextStart = 0;
  let playing = false;

  async function init() {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const data = await fetch(SRC).then((r) => r.arrayBuffer());
    buffer = await ctx.decodeAudioData(data);
  }

  function schedule() {
    // Keep ~one clip queued ahead of the playhead.
    while (nextStart < ctx.currentTime + buffer.duration) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(master);
      src.start(nextStart);
      nextStart += buffer.duration - OVERLAP;
    }
  }

  return {
    get playing() {
      return playing;
    },
    async start() {
      if (!ctx) await init();
      await ctx.resume();
      if (playing) return;
      playing = true;
      nextStart = Math.max(nextStart, ctx.currentTime + 0.05);
      schedule();
      timer = setInterval(schedule, 2000);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      // Let already-queued sources play out silently, then suspend to save CPU.
      setTimeout(() => !playing && ctx.suspend(), 1500);
    },
  };
}
