import { beforeEach, describe, expect, it, vi } from 'vitest';
import abcjs from 'abcjs';
import { TimingEvent } from '../utils/abcTiming';
import {
  DEFAULT_SECONDS_PER_BEAT,
  buildTimelineFromNotation,
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

describe('buildTimelineFromNotation', () => {
  beforeEach(() => {
    getRenderAbcMock().mockReset();
    getTimingCallbacksCtorMock().mockReset();
  });

  it('returns empty timeline for empty notation', () => {
    const result = buildTimelineFromNotation('');

    expect(result.notes).toEqual([]);
    expect(result.totalBeats).toBe(0);
    expect(result.secondsPerBeat).toBe(DEFAULT_SECONDS_PER_BEAT);
  });

  it('derives beat-based notes from abcjs timing callbacks', () => {
    const visualObj = {
      setUpAudio: vi.fn(),
      getMeterFraction: () => ({ num: 4, den: 4 }),
      millisecondsPerMeasure: () => 2000, // 2000ms per measure = 500ms per beat at 4/4
    };
    getRenderAbcMock().mockReturnValue([visualObj]);

    // At 120 BPM, 1 beat = 500ms
    // First event: 3 notes starting at 0ms, duration 1000ms (2 beats)
    // Second event: 1 note starting at 1000ms (beat 2), duration 500ms (1 beat)
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

    const timeline = buildTimelineFromNotation('ignored');

    // Should have 4 notes total (3 from chord + 1 single)
    expect(timeline.notes).toHaveLength(4);

    // First chord - 3 notes starting at beat 0
    const chordNotes = timeline.notes
      .filter((note) => note.startBeat === 0)
      .map((note) => note.pitch)
      .sort();
    expect(chordNotes).toEqual([60, 64, 67]);

    // Chord notes should have durationBeats = 2 (1000ms / 500ms per beat)
    const chordNote = timeline.notes.find(
      (note) => note.pitch === 60 && note.startBeat === 0
    );
    expect(chordNote?.durationBeats).toBeCloseTo(2);

    // Second note at beat 2
    const laterNote = timeline.notes.find((note) => note.pitch === 72);
    expect(laterNote?.startBeat).toBeCloseTo(2);
    expect(laterNote?.durationBeats).toBeCloseTo(1);

    // Tempo info
    expect(timeline.secondsPerBeat).toBeCloseTo(0.5); // 60/120 = 0.5

    // Beat boundaries start at 1 (no marker needed at beat 0)
    expect(timeline.beatBoundaries).toEqual([1, 2]);
  });

  it('handles notation with explicit tempo', () => {
    const visualObj = {
      setUpAudio: vi.fn(),
      getMeterFraction: () => ({ num: 4, den: 4 }),
      millisecondsPerMeasure: () => 1000, // 1000ms per measure = 250ms per beat at 4/4
    };
    getRenderAbcMock().mockReturnValue([visualObj]);

    // At 240 BPM (quarter note = 240), 1 beat = 250ms
    const timingCallbacksInstance = {
      replaceTarget: vi.fn(),
      noteTimings: [
        {
          type: 'event',
          milliseconds: 0,
          duration: 250,
          startCharArray: [0],
          endCharArray: [5],
          midiPitches: [{ pitch: 60 }],
        },
      ] as TimingEvent[],
      qpm: 240,
    };

    getTimingCallbacksCtorMock().mockImplementation(
      function MockTimingCallbacks() {
        return timingCallbacksInstance;
      }
    );

    const timeline = buildTimelineFromNotation('ignored');

    expect(timeline.notes).toHaveLength(1);
    expect(timeline.notes[0]?.startBeat).toBe(0);
    expect(timeline.notes[0]?.durationBeats).toBeCloseTo(1);
    expect(timeline.secondsPerBeat).toBeCloseTo(0.25); // 60/240 = 0.25
  });

  it('timeline is invariant - beat values do not depend on playback speed', () => {
    // This test verifies the key architectural property:
    // The timeline stores beats, which are invariant to tempo/warp changes
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
          duration: 500,
          startCharArray: [0],
          endCharArray: [5],
          midiPitches: [{ pitch: 60 }],
        },
        {
          type: 'event',
          milliseconds: 500,
          duration: 500,
          startCharArray: [6],
          endCharArray: [10],
          midiPitches: [{ pitch: 64 }],
        },
      ] as TimingEvent[],
      qpm: 120,
    };

    getTimingCallbacksCtorMock().mockImplementation(
      function MockTimingCallbacks() {
        return timingCallbacksInstance;
      }
    );

    const timeline = buildTimelineFromNotation('ignored');

    // Beat values are invariant
    expect(timeline.notes[0]?.startBeat).toBe(0);
    expect(timeline.notes[0]?.durationBeats).toBeCloseTo(1);
    expect(timeline.notes[1]?.startBeat).toBeCloseTo(1);
    expect(timeline.notes[1]?.durationBeats).toBeCloseTo(1);
    expect(timeline.totalBeats).toBeCloseTo(2);

    // The secondsPerBeat is the baseline tempo from the notation
    // When playback speed changes, only secondsPerBeat would change,
    // but note startBeat/durationBeats stay the same
    expect(timeline.secondsPerBeat).toBeCloseTo(0.5);
  });
});
