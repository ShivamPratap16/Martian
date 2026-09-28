// Records the landing as a square, shareable clip. Each frame copies the centre of the
// WebGL canvas into a 2D canvas and draws a caption on top, and MediaRecorder encodes it.
// frame() must be called right after renderer.render() in the same animation frame, while
// the WebGL drawing buffer is still valid.

const SIZE = 1080;

function pickMimeType() {
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? null;
}

export function canRecord() {
  return !!pickMimeType() && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export function startRecording(source, caption) {
  const mimeType = pickMimeType();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(250);

  function drawCaption() {
    const pad = 56;
    // Top: brand.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, SIZE, 120);
    ctx.fillStyle = '#ff7a3d';
    ctx.beginPath();
    ctx.arc(pad + 10, 62, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4ebe3';
    ctx.font = '700 30px "Space Grotesk", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('C L A I M   M A R S', pad + 38, 63);

    // Bottom: what just happened.
    const grad = ctx.createLinearGradient(0, SIZE - 260, 0, SIZE);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, SIZE - 260, SIZE, 260);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f4ebe3';
    ctx.font = '700 52px "Space Grotesk", system-ui, sans-serif';
    ctx.fillText(caption.headline, pad, SIZE - 120, SIZE - pad * 2);
    ctx.fillStyle = '#c9b8aa';
    ctx.font = '400 30px "Space Grotesk", system-ui, sans-serif';
    ctx.fillText(caption.subline, pad, SIZE - 70, SIZE - pad * 2);
  }

  return {
    frame() {
      // Cover-crop the centre square of the live canvas.
      const s = Math.min(source.width, source.height);
      ctx.drawImage(source, (source.width - s) / 2, (source.height - s) / 2, s, s, 0, 0, SIZE, SIZE);
      drawCaption();
    },
    stop() {
      return new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const type = mimeType.split(';')[0];
          resolve({ blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm' });
        };
        recorder.stop();
      });
    },
  };
}
