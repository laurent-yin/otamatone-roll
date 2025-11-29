import { describe, expect, it } from 'vitest';
import {
  buildTimingDerivedData,
  TimingEvent,
  VisualObjWithTimings,
} from './abcTiming';

/**
 * Helper to create partial mock objects for testing.
 * Since we're testing the timing extraction logic, we only need
 * the subset of properties that our code actually uses.
 */
const createMockVisualObj = (
  overrides: Partial<{
    getMeterFraction: () => { num: number; den: number };
    millisecondsPerMeasure: () => number;
  }> = {}
): VisualObjWithTimings =>
  ({
    getMeterFraction: () => ({ num: 4, den: 4 }),
    millisecondsPerMeasure: () => 2000, // 4 beats at 0.5s/beat = 2000ms
    ...overrides,
  }) as VisualObjWithTimings;

/**
 * Helper to create partial timing events for testing.
 */
const createTimingEvent = (overrides: Partial<TimingEvent>): TimingEvent =>
  overrides as TimingEvent;

describe('buildTimingDerivedData', () => {
  const baseVisualObj = createMockVisualObj();

  it('creates char map entries and notes from timing events (in beats)', () => {
    // With 4/4 time and 2000ms per measure, secondsPerBeat = 0.5
    // So 1000ms = 2 beats, 500ms duration = 1 beat
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 1000, // 2 beats
        duration: 500, // 1 beat
        startCharArray: [4, 5],
        endCharArray: [6, 7],
        midiPitches: [
          { pitch: 60, volume: 90 },
          { pitch: 64 },
        ] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 1250, // 2.5 beats
        duration: 250, // 0.5 beat
        startChar: 8,
        endChar: 9,
        midiPitches: [{ pitch: 67 }] as TimingEvent['midiPitches'],
      }),
    ];

    const { charMap, timeline, secondsPerBeat } = buildTimingDerivedData(
      baseVisualObj,
      timings
    );

    // charMap is still in seconds for cursor sync
    expect(charMap).toMatchObject({
      4: 1,
      5: 1,
      8: 1.25,
    });
    expect(secondsPerBeat).toBeCloseTo(0.5);
    expect(timeline.notes).toHaveLength(3);
    const firstNote = timeline.notes[0]!;
    const secondNote = timeline.notes[1]!;
    const thirdNote = timeline.notes[2]!;

    // Notes are now in beats
    expect(firstNote).toMatchObject({
      pitch: 60,
      startBeat: 2, // 1000ms / 500ms per beat
      durationBeats: 1, // 500ms / 500ms per beat
      velocity: 90,
      source: { startChar: 4, endChar: 6 },
    });
    expect(secondNote).toMatchObject({
      pitch: 64,
      startBeat: 2,
      durationBeats: 1,
      velocity: 80,
      source: { startChar: 5, endChar: 7 },
    });
    expect(thirdNote).toMatchObject({ pitch: 67, startBeat: 2.5 });
    expect(timeline.totalBeats).toBeCloseTo(3); // 2.5 + 0.5
    expect(timeline.measureBoundaries).toEqual([]);
    expect(timeline.beatBoundaries).toEqual([1, 2]); // beats at 1, 2 (not 0 or >= 3)
  });

  it('derives timing from beat-based pitchInfo data when milliseconds are missing', () => {
    const visualObj = createMockVisualObj({
      getMeterFraction: () => ({ num: 3, den: 4 }),
      millisecondsPerMeasure: undefined,
    });
    // pitchInfo.start and duration are in whole notes
    // 1.5 whole notes = 6 quarter note beats, 0.5 whole notes = 2 quarter note beats
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        millisecondsPerMeasure: 1800, // 3 beats at 0.6s/beat = 1800ms
        midiPitches: [
          {
            pitch: 72,
            start: 1.5, // 6 beats
            duration: 0.5, // 2 beats
          },
        ] as TimingEvent['midiPitches'],
      }),
    ];

    const { charMap, timeline, secondsPerBeat } = buildTimingDerivedData(
      visualObj,
      timings
    );

    expect(charMap).toEqual({});
    expect(secondsPerBeat).toBeCloseTo(0.6); // 1800ms / 3 beats
    expect(timeline.notes).toHaveLength(1);
    const note = timeline.notes[0]!;
    // With no milliseconds, it uses pitchInfo.start * 4 for beats
    expect(note.startBeat).toBeCloseTo(6); // 1.5 whole notes * 4 beats/whole
    expect(note.durationBeats).toBeCloseTo(2); // 0.5 whole notes * 4 beats/whole
    expect(timeline.totalBeats).toBeCloseTo(8); // 6 + 2
    expect(timeline.measureBoundaries).toEqual([3, 6]); // 3 beats per measure
    expect(timeline.beatBoundaries?.[0]).toBeCloseTo(1);
  });

  it('records measure boundaries from bar events when provided (in beats)', () => {
    // With 4/4 at 2000ms per measure, 0.5s per beat
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 0,
        duration: 1000, // 2 beats
        midiPitches: [{ pitch: 60 }] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({ type: 'bar', milliseconds: 2000 }), // 4 beats
      createTimingEvent({
        type: 'event',
        milliseconds: 2000, // 4 beats
        duration: 1000, // 2 beats
        midiPitches: [{ pitch: 62 }] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({ type: 'bar', milliseconds: 4000 }), // 8 beats
    ];

    const { timeline } = buildTimingDerivedData(baseVisualObj, timings);

    expect(timeline.measureBoundaries).toEqual([4, 8]); // in beats now
    expect(timeline.beatBoundaries).toEqual([1, 2, 3, 4, 5]); // beats 1-5 (not 0 or >= 6)
  });

  it('derives measure boundaries from barNumber increments when bar events are absent', () => {
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 0,
        duration: 500, // 1 beat
        midiPitches: [{ pitch: 60 }] as TimingEvent['midiPitches'],
        barNumber: 0,
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 500, // 1 beat
        duration: 500,
        midiPitches: [{ pitch: 62 }] as TimingEvent['midiPitches'],
        barNumber: 1,
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 1500, // 3 beats
        duration: 500,
        midiPitches: [{ pitch: 64 }] as TimingEvent['midiPitches'],
        barNumber: 2,
      }),
    ];

    const { timeline } = buildTimingDerivedData(baseVisualObj, timings);

    expect(timeline.measureBoundaries).toEqual([1, 3]); // in beats
    expect(timeline.beatBoundaries).toEqual([1, 2, 3]); // beats 1-3
  });
});
