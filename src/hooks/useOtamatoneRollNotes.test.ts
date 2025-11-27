import { beforeEach, describe, expect, it, vi } from 'vitest';
import abcjs from 'abcjs';
import { Note, NoteTimeline } from '../types/music';
import { TimingEvent } from '../utils/abcTiming';
import {
  normalizeTimelineToBaseline,
  createOtamatoneRollNotesResult,
  DEFAULT_SECONDS_PER_BEAT,
  buildBaselineTimelineFromNotation,
} from './useOtamatoneRollNotes';

vi.mock('abcjs', () => {
  return {
    __esModule: true,
    default: {
      renderAbc: vi.fn(),
      TimingCallbacks: vi.fn(),
    },
  };
});

const getRenderAbcMock = () =>
  abcjs.renderAbc as unknown as ReturnType<typeof vi.fn>;
const getTimingCallbacksCtorMock = () =>
  abcjs.TimingCallbacks as unknown as ReturnType<typeof vi.fn>;

const makeNote = (startTime: number, duration: number): Note => ({
  pitch: 60,
  startTime,
  duration,
  velocity: 80,
});

describe('createOtamatoneRollNotesResult', () => {
  const baseline: NoteTimeline = {
    notes: [makeNote(0, 1)],
    totalDuration: 1,
    secondsPerBeat: DEFAULT_SECONDS_PER_BEAT,
    beatBoundaries: [DEFAULT_SECONDS_PER_BEAT],
  };

  it('falls back to baseline when override is missing', () => {
    const result = createOtamatoneRollNotesResult(baseline, undefined);
    expect(result.notes).toEqual(baseline.notes);
    expect(result.totalDuration).toBeCloseTo(1);
    expect(result.baselineSecondsPerBeat).toBeCloseTo(DEFAULT_SECONDS_PER_BEAT);
    expect(result.playbackSecondsPerBeat).toBeCloseTo(DEFAULT_SECONDS_PER_BEAT);
  });

  it('normalizes override against baseline tempo', () => {
    const override: NoteTimeline = {
      notes: [makeNote(0, 2)],
      totalDuration: 2,
      secondsPerBeat: DEFAULT_SECONDS_PER_BEAT * 2,
    };

    const result = createOtamatoneRollNotesResult(baseline, override);

    expect(result.notes[0]?.duration).toBeCloseTo(2);
    expect(result.baselineSecondsPerBeat).toBeCloseTo(DEFAULT_SECONDS_PER_BEAT);
    expect(result.playbackSecondsPerBeat).toBeCloseTo(
      DEFAULT_SECONDS_PER_BEAT * 2
    );
  });

  it('uses default tempo when baseline omits secondsPerBeat', () => {
    const baselineWithoutTempo: NoteTimeline = {
      notes: [makeNote(0, 1)],
      totalDuration: 1,
    };

    const result = createOtamatoneRollNotesResult(
      baselineWithoutTempo,
      undefined
    );

    expect(result.baselineSecondsPerBeat).toBeCloseTo(DEFAULT_SECONDS_PER_BEAT);
    expect(result.playbackSecondsPerBeat).toBeCloseTo(DEFAULT_SECONDS_PER_BEAT);
  });

  it('preserves measure boundaries from the active timeline', () => {
    const baselineWithBars: NoteTimeline = {
      notes: [makeNote(0, 1)],
      totalDuration: 1,
      secondsPerBeat: DEFAULT_SECONDS_PER_BEAT,
      measureBoundaries: [1, 2, 3],
      beatBoundaries: [0.5, 1, 1.5],
    };
    const overrideWithBars: NoteTimeline = {
      notes: [makeNote(0, 2)],
      totalDuration: 2,
      secondsPerBeat: DEFAULT_SECONDS_PER_BEAT,
      measureBoundaries: [2],
      beatBoundaries: [0.5, 1],
    };

    const result = createOtamatoneRollNotesResult(
      baselineWithBars,
      overrideWithBars
    );

    expect(result.measureBoundaries).toEqual([2]);
    expect(result.beatBoundaries).toEqual([0.5, 1]);
  });
});

describe('normalizeTimelineToBaseline', () => {
  const baselineSecondsPerBeat = 0.5; // quarter note at 120 BPM

  it('returns identical timings when playback matches baseline tempo', () => {
    const baselineTimeline: NoteTimeline = {
      notes: [makeNote(0, 1), makeNote(1, 1)],
      totalDuration: 2,
      secondsPerBeat: baselineSecondsPerBeat,
      measureBoundaries: [2, 4],
      beatBoundaries: [0.5, 1, 1.5],
    };

    const normalized = normalizeTimelineToBaseline(
      baselineTimeline,
      baselineSecondsPerBeat
    );

    expect(normalized.notes).toHaveLength(2);
    expect(normalized.notes[1]?.startTime).toBeCloseTo(1);
    expect(normalized.notes[1]?.duration).toBeCloseTo(1);
    expect(normalized.totalDuration).toBeCloseTo(2);
    expect(normalized.measureBoundaries).toEqual([2, 4]);
    expect(normalized.measureBoundaries).not.toBe(
      baselineTimeline.measureBoundaries
    );
    expect(normalized.beatBoundaries).toEqual([0.5, 1, 1.5]);
    expect(normalized.beatBoundaries).not.toBe(baselineTimeline.beatBoundaries);
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

describe('buildBaselineTimelineFromNotation', () => {
  beforeEach(() => {
    getRenderAbcMock().mockReset();
    getTimingCallbacksCtorMock().mockReset();
  });

  it('derives notes from abcjs timing callbacks', () => {
    const visualObj = {
      setUpAudio: vi.fn(),
      getMeterFraction: () => ({ num: 4, den: 4 }),
      millisecondsPerMeasure: () => 2000,
    };
    getRenderAbcMock().mockReturnValue([visualObj]);

    const timingCallbacksInstance = {
      replaceTarget: vi.fn(),
      noteTimings: [
        {
          type: 'event',
          milliseconds: 0,
          duration: 1000,
          startCharArray: [0, 0, 0],
          endCharArray: [5, 5, 5],
          midiPitches: [{ pitch: 60 }, { pitch: 64 }, { pitch: 67 }],
        },
        {
          type: 'event',
          milliseconds: 1000,
          duration: 500,
          startCharArray: [6],
          endCharArray: [10],
          midiPitches: [{ pitch: 72 }],
        },
      ] as TimingEvent[],
      qpm: 120,
    };

    getTimingCallbacksCtorMock().mockImplementation(
      function MockTimingCallbacks() {
        return timingCallbacksInstance;
      }
    );

    const timeline = buildBaselineTimelineFromNotation('ignored');

    expect(timeline.notes).toHaveLength(4);
    const simultaneousPitches = timeline.notes
      .filter((note) => note.startTime === 0)
      .map((note) => note.pitch)
      .sort();
    expect(simultaneousPitches).toEqual([60, 64, 67]);

    const sustained = timeline.notes.find(
      (note) => note.pitch === 60 && note.startTime === 0
    );
    expect(sustained?.duration).toBeCloseTo(1);

    const laterNote = timeline.notes.find(
      (note) => note.pitch === 72 && note.startTime > 0
    );
    expect(laterNote?.startTime).toBeCloseTo(1);
    expect(timeline.secondsPerBeat).toBeCloseTo(0.5);
    expect(timeline.measureBoundaries).toEqual([]);
    expect(timeline.beatBoundaries).toEqual([0.5, 1]);
  });
});
