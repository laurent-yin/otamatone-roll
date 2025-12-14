import { describe, expect, it } from 'vitest';
import simpleScaleAbc from '../fixtures/simple-scale.abc?raw';
import { buildTimelineFromNotation } from '../../src/hooks/useOtamatoneRollNotes';

const getPitchSequence = (notes: { pitch: number }[]) =>
  notes.map((note) => note.pitch);

const getStartSubdivisions = (notes: { startSubdivision: number }[]) =>
  notes.map((note) => Number(note.startSubdivision.toFixed(3)));

const getDurationSubdivisions = (notes: { durationSubdivisions: number }[]) =>
  notes.map((note) => Number(note.durationSubdivisions.toFixed(3)));

describe('abcjs integration', () => {
  it('derives subdivision-based timeline data that feeds the Otamatone roll', () => {
    const result = buildTimelineFromNotation(simpleScaleAbc);

    expect(result.notes).toHaveLength(8);
    expect(result.secondsPerSubdivision).toBeCloseTo(0.5, 5); // 120 BPM = 0.5 seconds per subdivision
    expect(result.totalSubdivisions).toBeGreaterThan(7.9);
    expect(result.totalSubdivisions).toBeLessThan(8.1);

    const pitches = getPitchSequence(result.notes);
    expect(pitches).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);

    // Each note is a quarter note = 1 subdivision in 4/4 time (subdivisionUnit=4)
    const startSubdivisions = getStartSubdivisions(result.notes);
    expect(startSubdivisions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // Each quarter note = 1 subdivision
    const durationSubdivisions = getDurationSubdivisions(result.notes);
    expect(durationSubdivisions).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});
