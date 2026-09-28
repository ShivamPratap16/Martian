// Records the landing as a square, shareable clip with sound. Each frame copies the centre
// of the WebGL canvas into a 2D canvas, then `overlay(ctx, size)` draws captions on top,
// and MediaRecorder encodes the result together with the audio stream.
// frame() must be called right after rendering in the same animation frame, while the
// WebGL drawing buffer is still valid.

const SIZE = 1080;

function pickMimeType(withAudio) {
  const types = withAudio
    ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? null;
}

export function canRecord() {
  return !!pickMimeType(false) && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export function startRecording(source, { overlay, audioStream = null }) {
  const audioTracks = audioStream?.getAudioTracks() ?? [];
  const mimeType = pickMimeType(audioTracks.length > 0) ?? pickMimeType(false);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  // Frame rate 0 = only capture when we say so (requestFrame after each draw), so every
  // rendered frame lands in the video even if the browser skips repaints.
  const video = canvas.captureStream(0);
  const track = video.getVideoTracks()[0];
  const stream = new MediaStream([...video.getVideoTracks(), ...audioTracks]);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 160_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(250);

  return {
    frame() {
      // Cover-crop the centre square of the live canvas.
      const s = Math.min(source.width, source.height);
      ctx.drawImage(source, (source.width - s) / 2, (source.height - s) / 2, s, s, 0, 0, SIZE, SIZE);
      overlay(ctx, SIZE);
      track.requestFrame?.();
    },
    stop() {
      return new Promise((resolve) => {
        recorder.onstop = () => {
          video.getTracks().forEach((t) => t.stop());
          const type = mimeType.split(';')[0];
          resolve({ blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm' });
        };
        recorder.stop();
      });
    },
  };
}
