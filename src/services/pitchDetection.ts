import type { PitchDetectionResult } from '../types/music';

/** Result from the custom YIN wrapper including probability */
interface YinResult {
  frequency: number;
  probability: number;
}

/**
 * Custom YIN pitch detection implementation that exposes the probability
 * (periodicity) value that pitchfinder's YIN computes internally but doesn't return.
 * Based on the YIN paper by de Cheveigné & Kawahara (2002).
 *
 * @param sampleRate - Audio sample rate in Hz
 * @param threshold - Aperiodicity threshold (0–1). Lower = more permissive.
 * @returns A function that takes a Float32Array audio buffer and returns { frequency, probability } or null
 */
function createYinDetector(
  sampleRate: number,
  threshold: number
): (buf: Float32Array) => YinResult | null {
  return (float32AudioBuffer: Float32Array): YinResult | null => {
    // Buffer size = highest power of two <= input length
    let bufferSize = 1;
    while (bufferSize < float32AudioBuffer.length) bufferSize *= 2;
    bufferSize /= 2;

    const halfSize = bufferSize / 2;
    const yinBuffer = new Float32Array(halfSize);

    // Step 2: Difference function
    for (let t = 1; t < halfSize; t++) {
      let sum = 0;
      for (let i = 0; i < halfSize; i++) {
        const delta = float32AudioBuffer[i]! - float32AudioBuffer[i + t]!;
        sum += delta * delta;
      }
      yinBuffer[t] = sum;
    }

    // Step 3: Cumulative mean normalized difference
    yinBuffer[0] = 1;
    let runningSum = 0;
    for (let t = 1; t < halfSize; t++) {
      runningSum += yinBuffer[t]!;
      yinBuffer[t]! *= t / runningSum;
    }

    // Step 4: Absolute threshold
    let tau = -1;
    let probability = 0;
    for (let t = 2; t < halfSize; t++) {
      if (yinBuffer[t]! < threshold) {
        while (t + 1 < halfSize && yinBuffer[t + 1]! < yinBuffer[t]!) t++;
        probability = 1 - yinBuffer[t]!;
        tau = t;
        break;
      }
    }

    if (tau === -1) return null;

    // Step 5: Parabolic interpolation
    let betterTau: number;
    const x0 = tau < 1 ? tau : tau - 1;
    const x2 = tau + 1 < halfSize ? tau + 1 : tau;

    if (x0 === tau) {
      betterTau = yinBuffer[tau]! <= yinBuffer[x2]! ? tau : x2;
    } else if (x2 === tau) {
      betterTau = yinBuffer[tau]! <= yinBuffer[x0]! ? tau : x0;
    } else {
      const s0 = yinBuffer[x0]!;
      const s1 = yinBuffer[tau]!;
      const s2 = yinBuffer[x2]!;
      betterTau = tau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
    }

    return {
      frequency: sampleRate / betterTau,
      probability,
    };
  };
}

/** Minimum detectable frequency in Hz (filters out sub-bass noise) */
export const MIN_FREQUENCY_HZ = 50;

/** Maximum detectable frequency in Hz (filters out ultrasonic artifacts) */
export const MAX_FREQUENCY_HZ = 2000;

/** FFT size for the analyser node — larger = more accurate pitch, more latency */
const FFT_SIZE = 2048;

/** YIN probability threshold (0–1). Higher = stricter, fewer false detections. */
const YIN_THRESHOLD = 0.15;

/**
 * Number of consecutive frames a new pitch must be seen before accepting
 * an octave jump (ratio near 2:1 or 1:2 relative to current pitch).
 * Prevents momentary harmonic flicker.
 */
const OCTAVE_JUMP_FRAMES = 5;

/** Frequency ratio tolerance for detecting an octave relationship */
const OCTAVE_RATIO_TOLERANCE = 0.08;

/** Cents threshold within which two readings are considered the "same" pitch */
const STABLE_CENTS_THRESHOLD = 100;

/**
 * Callback invoked on each pitch detection cycle.
 * Called with the detection result, or null when no valid pitch is detected.
 */
export type PitchCallback = (result: PitchDetectionResult | null) => void;

/**
 * Real-time pitch detection service using the Web Audio API and the pitchfinder YIN algorithm.
 *
 * Captures audio from the user's microphone, analyses it with the YIN pitch detection
 * algorithm (which is resistant to octave errors), and reports the fundamental frequency
 * via a callback.
 *
 * @example
 * const service = new PitchDetectionService((result) => {
 *   if (result) console.log(`${result.frequency} Hz (confidence: ${result.confidence})`);
 * });
 * await service.start();
 * // ... later
 * service.stop();
 */
export class PitchDetectionService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private detectPitch: ((buf: Float32Array) => YinResult | null) | null = null;
  private animationFrameId: number | null = null;
  private inputBuffer: Float32Array<ArrayBuffer> | null = null;
  private running = false;

  /** Last accepted pitch frequency for octave-jump hysteresis */
  private lastAcceptedFreq: number | null = null;
  /** Count of consecutive frames at a candidate octave-jump frequency */
  private octaveJumpCount = 0;
  /** The candidate frequency that looks like an octave jump */
  private octaveJumpCandidate: number | null = null;

  private readonly onPitch: PitchCallback;

  constructor(onPitch: PitchCallback) {
    this.onPitch = onPitch;
  }

  /**
   * Requests microphone access, sets up the audio processing graph,
   * and begins the pitch detection loop.
   *
   * @throws If microphone access is denied or Web Audio API is unavailable
   */
  async start(): Promise<void> {
    if (this.running) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaStream = stream;

    const audioContext = new AudioContext();
    this.audioContext = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    this.sourceNode = source;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    this.analyserNode = analyser;

    source.connect(analyser);

    this.inputBuffer = new Float32Array(
      analyser.fftSize
    ) as Float32Array<ArrayBuffer>;
    this.detectPitch = createYinDetector(
      audioContext.sampleRate,
      YIN_THRESHOLD
    );

    this.running = true;
    this.detect();
  }

  /**
   * Stops the pitch detection loop, releases the microphone,
   * and disconnects audio nodes.
   */
  stop(): void {
    this.running = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }

    this.analyserNode = null;
    this.detectPitch = null;
    this.inputBuffer = null;
    this.lastAcceptedFreq = null;
    this.octaveJumpCount = 0;
    this.octaveJumpCandidate = null;
  }

  /**
   * Fully cleans up the service. Alias for stop().
   */
  destroy(): void {
    this.stop();
  }

  /** Whether the service is currently running */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Internal detection loop — runs once per animation frame.
   * Reads time-domain data from the analyser, runs pitch detection,
   * and invokes the callback.
   */
  private detect = (): void => {
    if (!this.running) return;

    if (this.analyserNode && this.inputBuffer && this.detectPitch) {
      this.analyserNode.getFloatTimeDomainData(this.inputBuffer);

      const result = this.detectPitch(this.inputBuffer);

      if (
        result !== null &&
        result.frequency >= MIN_FREQUENCY_HZ &&
        result.frequency <= MAX_FREQUENCY_HZ
      ) {
        const { frequency: rawFrequency, probability } = result;
        const frequency = this.applyOctaveHysteresis(rawFrequency);
        const hysteresisActive = frequency !== rawFrequency;
        this.onPitch({
          frequency,
          confidence: probability,
          rawFrequency,
          probability,
          hysteresisActive,
        });
      } else {
        this.onPitch(null);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.detect);
  };

  /**
   * Applies octave-jump hysteresis: if the new frequency is roughly an octave
   * above or below the last accepted pitch, require several consecutive frames
   * at that new pitch before accepting the jump. This prevents the ball from
   * flickering between octaves when harmonics are strong.
   */
  private applyOctaveHysteresis(newFreq: number): number {
    const last = this.lastAcceptedFreq;

    // First reading or no prior pitch — accept immediately
    if (last === null) {
      this.lastAcceptedFreq = newFreq;
      this.octaveJumpCount = 0;
      this.octaveJumpCandidate = null;
      return newFreq;
    }

    // Check if the new frequency is close enough to the current pitch (not a jump)
    const cents = Math.abs(1200 * Math.log2(newFreq / last));
    if (cents < STABLE_CENTS_THRESHOLD) {
      // Same pitch region — accept and reset jump counter
      this.lastAcceptedFreq = newFreq;
      this.octaveJumpCount = 0;
      this.octaveJumpCandidate = null;
      return newFreq;
    }

    // Check if this looks like an octave jump (ratio near 2:1 or 1:2)
    const ratio = newFreq / last;
    const isOctaveJump =
      Math.abs(ratio - 2) < OCTAVE_RATIO_TOLERANCE * 2 ||
      Math.abs(ratio - 0.5) < OCTAVE_RATIO_TOLERANCE ||
      Math.abs(ratio - 3) < OCTAVE_RATIO_TOLERANCE * 3 ||
      Math.abs(ratio - 1 / 3) < OCTAVE_RATIO_TOLERANCE;

    if (isOctaveJump) {
      // Potential octave jump — require consecutive frames before accepting
      if (
        this.octaveJumpCandidate !== null &&
        Math.abs(1200 * Math.log2(newFreq / this.octaveJumpCandidate)) <
          STABLE_CENTS_THRESHOLD
      ) {
        this.octaveJumpCount++;
      } else {
        // New candidate
        this.octaveJumpCandidate = newFreq;
        this.octaveJumpCount = 1;
      }

      if (this.octaveJumpCount >= OCTAVE_JUMP_FRAMES) {
        // Enough consecutive frames — accept the jump
        this.lastAcceptedFreq = newFreq;
        this.octaveJumpCount = 0;
        this.octaveJumpCandidate = null;
        return newFreq;
      }

      // Not enough frames yet — stick with the last accepted pitch
      return last;
    }

    // Non-octave pitch change (e.g., different note) — accept immediately
    this.lastAcceptedFreq = newFreq;
    this.octaveJumpCount = 0;
    this.octaveJumpCandidate = null;
    return newFreq;
  }
}
