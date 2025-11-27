import { describe, expect, it } from 'vitest';
import simpleScaleAbc from '../fixtures/simple-scale.abc?raw';
import {
  buildBaselineTimelineFromNotation,
  createOtamatoneRollNotesResult,
} from '../../src/hooks/useOtamatoneRollNotes';

const getPitchSequence = (notes: { pitch: number }[]) =>
  notes.map((note) => note.pitch);

const getStartTimes = (notes: { startTime: number }[]) =>
  notes.map((note) => Number(note.startTime.toFixed(3)));

const getDurations = (notes: { duration: number }[]) =>
  notes.map((note) => Number(note.duration.toFixed(3)));

describe('abcjs integration', () => {
  it('derives timeline data that feeds the Otamatone roll', () => {
    const baselineTimeline = buildBaselineTimelineFromNotation(simpleScaleAbc);
    const result = createOtamatoneRollNotesResult(baselineTimeline);

    expect(result.notes).toHaveLength(8);
    expect(result.secondsPerBeat).toBeCloseTo(0.5, 5);
    expect(result.totalDuration).toBeGreaterThan(3.9);
    expect(result.totalDuration).toBeLessThan(4.1);

    const pitches = getPitchSequence(result.notes);
    expect(pitches).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);

    const startTimes = getStartTimes(result.notes);
    expect(startTimes).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);

    const durations = getDurations(result.notes);
    expect(durations).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });
});
