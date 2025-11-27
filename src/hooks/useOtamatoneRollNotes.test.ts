import { beforeEach, describe, expect, it, vi } from 'vitest';
import abcjs from 'abcjs';
import { Note, NoteTimeline } from '../types/music';
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
      parseOnly: vi.fn(),
    },
  };
});

const getParseOnlyMock = () => vi.mocked(abcjs.parseOnly);

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

describe('buildBaselineTimelineFromNotation', () => {
  beforeEach(() => {
    getParseOnlyMock().mockReset();
  });

  it('returns one note per pitch in a chord and merges ties per pitch', () => {
    getParseOnlyMock().mockReturnValue([
      {
        getBpm: () => 120,
        getBeatLength: () => 0.25,
        lines: [
          {
            staff: [
              {
                key: undefined,
                voices: [
                  [
                    {
                      el_type: 'note',
                      duration: 0.5,
                      startChar: 0,
                      endChar: 5,
                      pitches: [
                        { pitch: 0, tie: 'start' },
                        { pitch: 2 },
                        { pitch: 4 },
                      ],
                    },
                    {
                      el_type: 'note',
                      duration: 0.5,
                      startChar: 6,
                      endChar: 10,
                      pitches: [{ pitch: 0, tie: 'end' }, { pitch: 7 }],
                    },
                  ],
                ],
              },
            ],
          },
        ],
      },
    ] as unknown as ReturnType<typeof abcjs.parseOnly>);

    const timeline = buildBaselineTimelineFromNotation('ignored');

    expect(timeline.notes).toHaveLength(4);

    const simultaneousPitches = timeline.notes
      .filter((note) => note.startTime === 0)
      .map((note) => note.pitch)
      .sort();
    expect(simultaneousPitches).toEqual([60, 64, 67]);

    const tiedPitch = timeline.notes.find((note) => note.pitch === 60);
    expect(tiedPitch?.duration).toBeCloseTo(2);

    const laterNote = timeline.notes.find(
      (note) => note.startTime > 0 && note.pitch === 72
    );
    expect(laterNote?.startTime).toBeCloseTo(1);
  });
});
