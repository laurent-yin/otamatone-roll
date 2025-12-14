import { describe, expect, it } from 'vitest';
import {
  buildTimingDerivedData,
  TimingEvent,
  VisualObjWithTimings,
} from './abcTiming';
import { getSubdivisionBoundaries } from '../types/music';

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
    millisecondsPerMeasure: () => 2000, // 4 subdivisions at 0.5s/subdivision = 2000ms
    ...overrides,
  }) as VisualObjWithTimings;

/**
 * Helper to create partial timing events for testing.
 */
const createTimingEvent = (overrides: Partial<TimingEvent>): TimingEvent =>
  overrides as TimingEvent;

describe('buildTimingDerivedData', () => {
  const baseVisualObj = createMockVisualObj();

  it('creates char map entries and notes from timing events (in subdivisions)', () => {
    // With 4/4 time and 2000ms per measure, secondsPerSubdivision = 0.5
    // So 1000ms = 2 subdivisions, 500ms duration = 1 subdivision
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 1000, // 2 subdivisions
        duration: 500, // 1 subdivision
        startCharArray: [4, 5],
        endCharArray: [6, 7],
        midiPitches: [
          { pitch: 60, volume: 90 },
          { pitch: 64 },
        ] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 1250, // 2.5 subdivisions
        duration: 250, // 0.5 subdivision
        startChar: 8,
        endChar: 9,
        midiPitches: [{ pitch: 67 }] as TimingEvent['midiPitches'],
      }),
    ];

    const { charMap, timeline, secondsPerSubdivision } = buildTimingDerivedData(
      baseVisualObj,
      timings
    );

    // charMap is still in seconds for cursor sync
    expect(charMap).toMatchObject({
      4: 1,
      5: 1,
      8: 1.25,
    });
    expect(secondsPerSubdivision).toBeCloseTo(0.5);
    expect(timeline.notes).toHaveLength(3);
    const firstNote = timeline.notes[0]!;
    const secondNote = timeline.notes[1]!;
    const thirdNote = timeline.notes[2]!;

    // Notes are now in subdivisions
    expect(firstNote).toMatchObject({
      pitch: 60,
      startSubdivision: 2, // 1000ms / 500ms per subdivision
      durationSubdivisions: 1, // 500ms / 500ms per subdivision
      velocity: 90,
      source: { startChar: 4, endChar: 6 },
    });
    expect(secondNote).toMatchObject({
      pitch: 64,
      startSubdivision: 2,
      durationSubdivisions: 1,
      velocity: 80,
      source: { startChar: 5, endChar: 7 },
    });
    expect(thirdNote).toMatchObject({ pitch: 67, startSubdivision: 2.5 });
    expect(timeline.totalSubdivisions).toBeCloseTo(3); // 2.5 + 0.5
    expect(timeline.measureBoundaries).toEqual([]);
    expect(getSubdivisionBoundaries(timeline.totalSubdivisions)).toEqual([
      1, 2,
    ]); // subdivisions at 1, 2 (not 0 or >= 3)
  });

  it('derives timing from subdivision-based pitchInfo data when milliseconds are missing', () => {
    const visualObj = createMockVisualObj({
      getMeterFraction: () => ({ num: 3, den: 4 }),
      millisecondsPerMeasure: undefined,
    });
    // pitchInfo.start and duration are in whole notes
    // 1.5 whole notes = 6 quarter note subdivisions, 0.5 whole notes = 2 quarter note subdivisions
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        millisecondsPerMeasure: 1800, // 3 subdivisions at 0.6s/subdivision = 1800ms
        midiPitches: [
          {
            pitch: 72,
            start: 1.5, // 6 subdivisions
            duration: 0.5, // 2 subdivisions
          },
        ] as TimingEvent['midiPitches'],
      }),
    ];

    const { charMap, timeline, secondsPerSubdivision } = buildTimingDerivedData(
      visualObj,
      timings
    );

    expect(charMap).toEqual({});
    expect(secondsPerSubdivision).toBeCloseTo(0.6); // 1800ms / 3 subdivisions
    expect(timeline.notes).toHaveLength(1);
    const note = timeline.notes[0]!;
    // With no milliseconds, it uses pitchInfo.start * 4 for subdivisions
    expect(note.startSubdivision).toBeCloseTo(6); // 1.5 whole notes * 4 subdivisions/whole
    expect(note.durationSubdivisions).toBeCloseTo(2); // 0.5 whole notes * 4 subdivisions/whole
    expect(timeline.totalSubdivisions).toBeCloseTo(8); // 6 + 2
    expect(timeline.measureBoundaries).toEqual([3, 6]); // 3 subdivisions per measure
    expect(getSubdivisionBoundaries(timeline.totalSubdivisions)[0]).toBeCloseTo(
      1
    );
  });

  it('records measure boundaries from bar events when provided (in subdivisions)', () => {
    // With 4/4 at 2000ms per measure, 0.5s per subdivision
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 0,
        duration: 1000, // 2 subdivisions
        midiPitches: [{ pitch: 60 }] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({ type: 'bar', milliseconds: 2000 }), // 4 subdivisions
      createTimingEvent({
        type: 'event',
        milliseconds: 2000, // 4 subdivisions
        duration: 1000, // 2 subdivisions
        midiPitches: [{ pitch: 62 }] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({ type: 'bar', milliseconds: 4000 }), // 8 subdivisions
    ];

    const { timeline } = buildTimingDerivedData(baseVisualObj, timings);

    expect(timeline.measureBoundaries).toEqual([4, 8]); // in subdivisions now
    expect(getSubdivisionBoundaries(timeline.totalSubdivisions)).toEqual([
      1, 2, 3, 4, 5,
    ]); // subdivisions 1-5 (not 0 or >= 6)
  });

  it('derives measure boundaries from barNumber increments when bar events are absent', () => {
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 0,
        duration: 500, // 1 subdivision
        midiPitches: [{ pitch: 60 }] as TimingEvent['midiPitches'],
        barNumber: 0,
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 500, // 1 subdivision
        duration: 500,
        midiPitches: [{ pitch: 62 }] as TimingEvent['midiPitches'],
        barNumber: 1,
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 1500, // 3 subdivisions
        duration: 500,
        midiPitches: [{ pitch: 64 }] as TimingEvent['midiPitches'],
        barNumber: 2,
      }),
    ];

    const { timeline } = buildTimingDerivedData(baseVisualObj, timings);

    expect(timeline.measureBoundaries).toEqual([1, 3]); // in subdivisions
    expect(getSubdivisionBoundaries(timeline.totalSubdivisions)).toEqual([
      1, 2, 3,
    ]); // subdivisions 1-3
  });

  it('handles compound meters (12/8) with pitchInfo.duration in whole notes', () => {
    // In 12/8 time:
    // - Meter: 12/8 (12 eighth note subdivisions per measure)
    // - msPerMeasure = 1714ms
    // - secondsPerSubdivision = 1.714 / 12 = 0.1429s
    // - An eighth note (0.125 whole notes) = 0.125 * 8 = 1 subdivision
    const visualObj = createMockVisualObj({
      getMeterFraction: () => ({ num: 12, den: 8 }),
      millisecondsPerMeasure: () => 1714,
    });

    // When event.duration is undefined, code falls back to pitchInfo.duration
    // pitchInfo.duration is in whole notes (0.125 = 1/8 note)
    // Note: secondsPerSubdivision is derived as msPerMeasure / subdivisionsPerMeasure
    // With subdivisionsPerMeasure=12, secondsPerSubdivision = 1.714/12 = 0.1429s
    // wholeNoteInSubdivisions = subdivisionUnit = 8
    const timings: TimingEvent[] = [
      createTimingEvent({
        type: 'event',
        milliseconds: 0,
        midiPitches: [
          { pitch: 60, duration: 0.125 },
        ] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 143,
        midiPitches: [
          { pitch: 62, duration: 0.125 },
        ] as TimingEvent['midiPitches'],
      }),
      createTimingEvent({
        type: 'event',
        milliseconds: 286,
        midiPitches: [
          { pitch: 64, duration: 0.125 },
        ] as TimingEvent['midiPitches'],
      }),
    ];

    const { timeline, secondsPerSubdivision } = buildTimingDerivedData(
      visualObj,
      timings
    );

    // Without tempo override, secondsPerSubdivision = msPerMeasure/subdivisionsPerMeasure
    expect(secondsPerSubdivision).toBeCloseTo(1.714 / 12, 3);

    // With this mock (no tempo override):
    // - wholeNoteInSubdivisions = 8 (the subdivision unit)
    // - durationSubdivisions = 0.125 * 8 = 1.0
    // This is correct: each eighth note = 1 subdivision
    expect(timeline.notes).toHaveLength(3);
    timeline.notes.forEach((note) => {
      expect(note.durationSubdivisions).toBeCloseTo(1.0, 2);
    });

    // Start times are derived from milliseconds, so spacing = 143ms / 142.9ms/subdivision ≈ 1 subdivision
    expect(
      timeline.notes[1]!.startSubdivision - timeline.notes[0]!.startSubdivision
    ).toBeCloseTo(1.0, 1);
    expect(
      timeline.notes[2]!.startSubdivision - timeline.notes[1]!.startSubdivision
    ).toBeCloseTo(1.0, 1);
  });
});
