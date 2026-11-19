export const voiceSampleRate = 16_000;
export const maxVoiceSeconds = 12;
export const minVoiceSamples = 1536;
const wavHeaderBytes = 44;
export const maxVoiceBytes = wavHeaderBytes + 2 * voiceSampleRate * maxVoiceSeconds;

export function encodeVoiceClip(frames: Float32Array[], sampleCount: number) {
  const samples = Math.min(sampleCount, voiceSampleRate * maxVoiceSeconds);
  const buffer = new ArrayBuffer(wavHeaderBytes + samples * 2);
  const header = new DataView(buffer);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, "RIFF");
  header.setUint32(4, buffer.byteLength - 8, true);
  tag(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, voiceSampleRate, true);
  header.setUint32(28, voiceSampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  tag(36, "data");
  header.setUint32(40, samples * 2, true);
  let index = 0;
  for (const frame of frames) {
    for (const sample of frame) {
      if (index === samples) return buffer;
      const clamped = Math.max(-1, Math.min(1, sample));
      header.setInt16(wavHeaderBytes + index++ * 2, clamped * (clamped < 0 ? 32768 : 32767), true);
    }
  }
  return buffer;
}

export function isVoiceClip(buffer: ArrayBuffer) {
  if (buffer.byteLength < wavHeaderBytes + minVoiceSamples * 2 || buffer.byteLength > maxVoiceBytes) return false;
  const header = new DataView(buffer);
  return header.getUint32(0) === 0x52494646 && header.getUint32(8) === 0x57415645 &&
    header.getUint32(12) === 0x666d7420 && header.getUint32(36) === 0x64617461 &&
    header.getUint32(16, true) === 16 && header.getUint16(20, true) === 1 &&
    header.getUint16(22, true) === 1 && header.getUint32(24, true) === voiceSampleRate &&
    header.getUint32(28, true) === voiceSampleRate * 2 && header.getUint16(32, true) === 2 &&
    header.getUint16(34, true) === 16 && header.getUint32(40, true) === buffer.byteLength - wavHeaderBytes &&
    header.getUint32(4, true) === buffer.byteLength - 8 && buffer.byteLength % 2 === 0;
}
