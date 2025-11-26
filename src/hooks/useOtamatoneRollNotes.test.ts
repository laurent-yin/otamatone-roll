import { describe, expect, it } from 'vitest';
import { NoteTimeline } from '../types/music';
import { normalizeTimelineToBaseline } from './useOtamatoneRollNotes';

const makeNote = (startTime: number, duration: number) => ({
  pitch: 60,
  startTime,
  duration,
  velocity: 80,
});

describe('normalizeTimelineToBaseline', () => {
  const baselineSecondsPerBeat = 0.5; // quarter note at 120 BPM

  it('returns identical timings when playback matches baseline tempo', () => {
    const baselineTimeline: NoteTimeline = {
      notes: [makeNote(0, 1), makeNote(1, 1)],
      totalDuration: 2,
      secondsPerBeat: baselineSecondsPerBeat,
    };

    const normalized = normalizeTimelineToBaseline(
      baselineTimeline,
      baselineSecondsPerBeat
    );

    expect(normalized.notes).toHaveLength(2);
    expect(normalized.notes[1]?.startTime).toBeCloseTo(1);
    expect(normalized.notes[1]?.duration).toBeCloseTo(1);
    expect(normalized.totalDuration).toBeCloseTo(2);
  });

  it('stretches note timings back to baseline when playback is slower', () => {
    const playbackSecondsPerBeat = 1; // warp to 50% speed (twice as slow)
    const playbackTimeline: NoteTimeline = {
      // abcjs timeline reports everything scaled by the warp ratio (x2 here)
      notes: [makeNote(0, 2), makeNote(2, 2)],
      totalDuration: 4,
      secondsPerBeat: playbackSecondsPerBeat,
    };

    const normalized = normalizeTimelineToBaseline(
      playbackTimeline,
      baselineSecondsPerBeat
    );

    expect(normalized.notes[1]?.startTime).toBeCloseTo(2);
    expect(normalized.notes[1]?.duration).toBeCloseTo(2);
    expect(normalized.totalDuration).toBeCloseTo(4);
  });

  it('compresses note timings when playback is faster than baseline', () => {
    const playbackSecondsPerBeat = 0.25; // warp to 200% speed (twice as fast)
    const playbackTimeline: NoteTimeline = {
      // abcjs timeline reports everything scaled by warp ratio (x0.5 here)
      notes: [makeNote(0, 0.5), makeNote(0.5, 0.5)],
      totalDuration: 1,
      secondsPerBeat: playbackSecondsPerBeat,
    };

    const normalized = normalizeTimelineToBaseline(
      playbackTimeline,
      baselineSecondsPerBeat
    );

    expect(normalized.notes[0]?.duration).toBeCloseTo(0.5);
    expect(normalized.notes[1]?.startTime).toBeCloseTo(0.5);
    expect(normalized.totalDuration).toBeCloseTo(1);
  });
});
