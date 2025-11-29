import { describe, expect, it } from 'vitest';
import simpleScaleAbc from '../fixtures/simple-scale.abc?raw';
import { buildTimelineFromNotation } from '../../src/hooks/useOtamatoneRollNotes';

const getPitchSequence = (notes: { pitch: number }[]) =>
  notes.map((note) => note.pitch);

const getStartBeats = (notes: { startBeat: number }[]) =>
  notes.map((note) => Number(note.startBeat.toFixed(3)));

const getDurationBeats = (notes: { durationBeats: number }[]) =>
  notes.map((note) => Number(note.durationBeats.toFixed(3)));

describe('abcjs integration', () => {
  it('derives beat-based timeline data that feeds the Otamatone roll', () => {
    const result = buildTimelineFromNotation(simpleScaleAbc);

    expect(result.notes).toHaveLength(8);
    expect(result.secondsPerBeat).toBeCloseTo(0.5, 5); // 120 BPM = 0.5 seconds per beat
    expect(result.totalBeats).toBeGreaterThan(7.9);
    expect(result.totalBeats).toBeLessThan(8.1);

    const pitches = getPitchSequence(result.notes);
    expect(pitches).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);

    // Each note is a quarter note = 1 beat in beat-based timeline
    const startBeats = getStartBeats(result.notes);
    expect(startBeats).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // Each quarter note = 1 beat
    const durationBeats = getDurationBeats(result.notes);
    expect(durationBeats).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});
