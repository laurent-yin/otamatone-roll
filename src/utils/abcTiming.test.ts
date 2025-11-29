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
    millisecondsPerMeasure: () => 2000,
    ...overrides,
  }) as VisualObjWithTimings;

/**
 * Helper to create partial timing events for testing.
 */
const createTimingEvent = (
  overrides: Partial<TimingEvent>
): TimingEvent => overrides as TimingEvent;

describe('buildTimingDerivedData', () => {
  const baseVisualObj = createMockVisualObj();

  it('creates char map entries and notes from timing events', () => {
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 1000,
        duration: 500,
        startCharArray: [4, 5],
        endCharArray: [6, 7],
        midiPitches: [{ pitch: 60, volume: 90 }, { pitch: 64 }] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 1250,
        duration: 250,
        startChar: 8,
        endChar: 9,
        midiPitches: [{ pitch: 67 }] as TimingEvent['midiPitches'],
      }),
    ];

    const { charMap, timeline } = buildTimingDerivedData(
      baseVisualObj,
      timings
    );

    expect(charMap).toMatchObject({
      4: 1,
      5: 1,
      8: 1.25,
    });
    expect(timeline.notes).toHaveLength(3);
    const firstNote = timeline.notes[0]!;
    const secondNote = timeline.notes[1]!;
    const thirdNote = timeline.notes[2]!;

    expect(firstNote).toMatchObject({
      pitch: 60,
      startTime: 1,
      duration: 0.5,
      velocity: 90,
      source: { startChar: 4, endChar: 6 },
    });
    expect(secondNote).toMatchObject({
      pitch: 64,
      startTime: 1,
      duration: 0.5,
      velocity: 80,
      source: { startChar: 5, endChar: 7 },
    });
    expect(thirdNote).toMatchObject({ pitch: 67, startTime: 1.25 });
    expect(timeline.totalDuration).toBeCloseTo(1.5);
    expect(timeline.measureBoundaries).toEqual([]);
    expect(timeline.beatBoundaries).toEqual([0.5, 1]);
  });

  it('derives timing from beat-based data when milliseconds are missing', () => {
    const visualObj = createMockVisualObj({
      getMeterFraction: () => ({ num: 3, den: 4 }),
      millisecondsPerMeasure: undefined,
    });
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        millisecondsPerMeasure: 1800,
        midiPitches: [
          {
            pitch: 72,
            start: 1.5,
            duration: 0.5,
          },
        ] as TimingEvent['midiPitches'],
      }),
    ];

    const { charMap, timeline } = buildTimingDerivedData(visualObj, timings);

    expect(charMap).toEqual({});
    expect(timeline.notes).toHaveLength(1);
    const note = timeline.notes[0]!;
    expect(note.startTime).toBeCloseTo(3.6, 5);
    expect(note.duration).toBeCloseTo(1.2, 5);
    expect(timeline.totalDuration).toBeCloseTo(4.8, 5);
    expect(timeline.measureBoundaries).toEqual([1.8, 3.6]);
    expect(timeline.beatBoundaries?.[0]).toBeCloseTo(0.6, 5);
    expect(timeline.beatBoundaries?.slice(-1)[0]).toBeCloseTo(4.2, 5);
  });

  it('records measure boundaries from bar events when provided', () => {
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 0,
        duration: 1000,
        midiPitches: [{ pitch: 60 }] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({ type: 'bar', milliseconds: 2000 }),
      createTimingEvent({
        type: 'event',
        milliseconds: 2000,
        duration: 1000,
        midiPitches: [{ pitch: 62 }] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({ type: 'bar', milliseconds: 4000 }),
    ];

    const { timeline } = buildTimingDerivedData(baseVisualObj, timings);

    expect(timeline.measureBoundaries).toEqual([2, 4]);
    expect(timeline.beatBoundaries).toEqual([0.5, 1, 1.5, 2, 2.5]);
  });

  it('derives measure boundaries from barNumber increments when bar events are absent', () => {
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 0,
        duration: 500,
        midiPitches: [{ pitch: 60 }] as TimingEvent['midiPitches'],
        barNumber: 0,
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 500,
        duration: 500,
        midiPitches: [{ pitch: 62 }] as TimingEvent['midiPitches'],
        barNumber: 1,
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 1500,
        duration: 500,
        midiPitches: [{ pitch: 64 }] as TimingEvent['midiPitches'],
        barNumber: 2,
      }),
    ];

    const { timeline } = buildTimingDerivedData(baseVisualObj, timings);

    expect(timeline.measureBoundaries).toEqual([0.5, 1.5]);
    expect(timeline.beatBoundaries).toEqual([0.5, 1, 1.5]);
  });
});
