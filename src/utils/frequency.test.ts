import { describe, it, expect } from 'vitest';
import { centsDistance, nearestMidiPitch } from './frequency';

describe('centsDistance', () => {
  it('returns 0 for identical frequencies', () => {
    expect(centsDistance(440, 440)).toBe(0);
  });

  it('returns 1200 for an octave up', () => {
    expect(centsDistance(880, 440)).toBeCloseTo(1200, 1);
  });

  it('returns -1200 for an octave down', () => {
    expect(centsDistance(220, 440)).toBeCloseTo(-1200, 1);
  });

  it('returns ~100 for one semitone', () => {
    // A4 to A#4
    const a4 = 440;
    const aSharp4 = 440 * Math.pow(2, 1 / 12);
    expect(centsDistance(aSharp4, a4)).toBeCloseTo(100, 1);
  });

  it('returns 0 for invalid inputs', () => {
    expect(centsDistance(0, 440)).toBe(0);
    expect(centsDistance(440, 0)).toBe(0);
    expect(centsDistance(-1, 440)).toBe(0);
    expect(centsDistance(NaN, 440)).toBe(0);
    expect(centsDistance(Infinity, 440)).toBe(0);
  });
});

describe('nearestMidiPitch', () => {
  it('returns 69 for 440 Hz (A4)', () => {
    expect(nearestMidiPitch(440)).toBe(69);
  });

  it('returns 60 for ~261.63 Hz (C4)', () => {
    expect(nearestMidiPitch(261.63)).toBe(60);
  });

  it('rounds to nearest MIDI note', () => {
    // Slightly sharp A4 — still closest to 69
    expect(nearestMidiPitch(445)).toBe(69);
    // A#4 = ~466.16 Hz → MIDI 70
    expect(nearestMidiPitch(466.16)).toBe(70);
  });

  it('returns 69 for invalid input', () => {
    expect(nearestMidiPitch(0)).toBe(69);
    expect(nearestMidiPitch(-100)).toBe(69);
  });
});
