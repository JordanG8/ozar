/* global AudioWorkletProcessor, registerProcessor, sampleRate */

// Resamples the microphone to 24 kHz mono and posts 20 ms frames, so audio can stream while the learner holds the mic.
const targetRate = 24000;
const frameSize = 480;

class VoiceCapture extends AudioWorkletProcessor {
  step = sampleRate / targetRate;
  frame = new Float32Array(frameSize);
  offset = 0;
  sum = 0;
  count = 0;
  position = 0;

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      // Average the input samples that fall inside each output step (a box filter against aliasing).
      this.sum += sample;
      this.count++;
      this.position++;
      if (this.position < this.step) continue;
      const value = this.sum / this.count;
      this.sum = 0;
      this.count = 0;
      // Below 24 kHz one input sample covers several output samples.
      while (this.position >= this.step) {
        this.position -= this.step;
        this.frame[this.offset++] = value;
        if (this.offset === frameSize) {
          this.port.postMessage(this.frame, [this.frame.buffer]);
          this.frame = new Float32Array(frameSize);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("ozar-voice-capture", VoiceCapture);
