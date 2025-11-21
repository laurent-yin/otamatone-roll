import abcjs from 'abcjs';
import { describe, expect, it } from 'vitest';
import {
  buildTimingDerivedData,
  TimingEvent,
  VisualObjWithTimings,
} from './abcTiming';

describe('buildTimingDerivedData', () => {
  const baseVisualObj: VisualObjWithTimings = {
    getMeterFraction: () => ({ num: 4, den: 4 }),
    millisecondsPerMeasure: () => 2000,
  };

  it('creates char map entries and notes from timing events', () => {
    const timings: TimingEvent[] = [
      {
        type: 'event',
        milliseconds: 1000,
        duration: 500,
        startCharArray: [4, 5],
        endCharArray: [6, 7],
        midiPitches: [
          { pitch: 60, volume: 90 },
          { pitch: 64 },
        ],
      },
      {
        type: 'event',
        milliseconds: 1250,
        duration: 250,
        startChar: 8,
        endChar: 9,
        midiPitches: [{ pitch: 67 }],
      },
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
  });

  it('derives timing from beat-based data when milliseconds are missing', () => {
    const visualObj: VisualObjWithTimings = {
      getMeterFraction: () => ({ num: 3, den: 4 }),
    };
    const timings: TimingEvent[] = [
      {
        type: 'event',
        millisecondsPerMeasure: 1800,
        midiPitches: [
          {
            pitch: 72,
            start: 1.5,
            duration: 0.5,
          },
        ],
      },
    ];

    const { charMap, timeline } = buildTimingDerivedData(visualObj, timings);

    expect(charMap).toEqual({});
    expect(timeline.notes).toHaveLength(1);
    const note = timeline.notes[0]!;
    expect(note.startTime).toBeCloseTo(3.6, 5);
    expect(note.duration).toBeCloseTo(1.2, 5);
    expect(timeline.totalDuration).toBeCloseTo(4.8, 5);
  });
});

describe('abcjs integration', () => {
  it('extracts Bb scale note data for piano roll rendering', () => {
    const containerId = 'abc-sample';
    document.body.innerHTML = `<div id="${containerId}"></div>`;

    const notation = `X:1
T:Sample Bb Flats
M:4/4
L:1/4
Q:1/4=120
K:Bb
C _D D _E | E F _G G |
`;

    const visualObjs = abcjs.renderAbc(containerId, notation, {
      responsive: 'resize',
    });

    expect(visualObjs).toHaveLength(1);

    const [visualObj] = visualObjs;
    type VisualObjWithOptionalAudio = VisualObjWithTimings & {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setUpAudio?: (options?: Record<string, any>) => unknown;
    };

    const visualObjWithAudio = visualObj as VisualObjWithOptionalAudio;
    if (typeof visualObjWithAudio.setUpAudio === 'function') {
      visualObjWithAudio.setUpAudio({ qpm: 120 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timingCallbacks = new (abcjs.TimingCallbacks as any)(visualObj, {});
    const timings = (timingCallbacks as { noteTimings?: TimingEvent[] }).noteTimings;

    expect(timings).toBeDefined();
    expect(timings && timings.length).toBeGreaterThanOrEqual(8);

    const derived = buildTimingDerivedData(
      visualObj as VisualObjWithTimings,
      (timings ?? []) as TimingEvent[]
    );

    expect(derived.timeline.notes).toHaveLength(8);
    const pitches = derived.timeline.notes.map((note) => note.pitch);
    expect(pitches).toEqual([60, 61, 61, 63, 63, 65, 66, 66]);

    const condensed = derived.timeline.notes.map((note) => ({
      pitch: note.pitch,
      start: Number(note.startTime.toFixed(3)),
      duration: Number(note.duration.toFixed(3)),
    }));
    console.info('Bb sample timeline', condensed);

    condensed.forEach((entry, index) => {
      const expectedStart = Number((index * 0.5).toFixed(3));
      expect(entry.start).toBeCloseTo(expectedStart, 2);
      expect(entry.duration).toBeGreaterThan(0);
    });
  });
});
