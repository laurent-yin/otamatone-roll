import abcjs from 'abcjs';
import { describe, expect, it } from 'vitest';
import {
  buildTimingDerivedData,
  VisualObjWithTimings,
} from '../../src/utils/abcTiming';
import { getBeatBoundaries } from '../../src/types/music';

type VisualObjWithOptionalAudio = VisualObjWithTimings & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setUpAudio?: (options?: Record<string, any>) => unknown;
};

const getTimingsFromNotation = (
  containerId: string,
  notation: string,
  qpm: number
) => {
  document.body.innerHTML = `<div id="${containerId}"></div>`;
  const visualObjs = abcjs.renderAbc(containerId, notation, {
    responsive: 'resize',
  });
  expect(visualObjs).toHaveLength(1);
  const [visualObj] = visualObjs;
  const visualObjWithAudio = visualObj as VisualObjWithOptionalAudio;
  if (typeof visualObjWithAudio.setUpAudio === 'function') {
    visualObjWithAudio.setUpAudio({ qpm });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timingCallbacks = new (abcjs.TimingCallbacks as any)(visualObj, {});
  const timings = (timingCallbacks as { noteTimings?: unknown }).noteTimings;
  expect(Array.isArray(timings)).toBe(true);
  return {
    visualObj: visualObj as VisualObjWithTimings,
    timings: (timings ?? []) as Parameters<typeof buildTimingDerivedData>[1],
  };
};

describe('abcjs integration (browser)', () => {
  it('extracts Bb scale note data for otamatone roll rendering (beat-based)', () => {
    const notation = `X:1
T:Sample Bb Flats
M:4/4
L:1/4
Q:1/4=120
K:Bb
C _D D _E | E F _G G |
`;
    const { visualObj, timings } = getTimingsFromNotation(
      'abc-sample',
      notation,
      120
    );
    const derived = buildTimingDerivedData(visualObj, timings);
    expect(derived.timeline.notes).toHaveLength(8);
    const pitches = derived.timeline.notes.map((note) => note.pitch);
    expect(pitches).toEqual([60, 61, 61, 63, 63, 65, 66, 66]);

    // With beat-based structure, each quarter note = 1 beat
    // At Q:1/4=120, each note should be 1 beat apart
    const condensed = derived.timeline.notes.map((note) => ({
      pitch: note.pitch,
      startBeat: Number(note.startBeat.toFixed(3)),
      durationBeats: Number(note.durationBeats.toFixed(3)),
    }));
    condensed.forEach((entry, index) => {
      // Each note starts on successive beats (0, 1, 2, 3, ...)
      expect(entry.startBeat).toBeCloseTo(index, 2);
      expect(entry.durationBeats).toBeGreaterThan(0);
      // Quarter notes should be 1 beat each
      expect(entry.durationBeats).toBeCloseTo(1, 1);
    });

    // Measure boundaries in beats (4/4 time = 4 beats per measure)
    // First measure ends at beat 4
    expect(derived.timeline.measureBoundaries).toEqual([4]);

    // Beat boundaries should be integer beats (0, 1, 2, 3, 4, 5, 6, 7)
    // but we don't include beat 0 or the final beat
    expect(getBeatBoundaries(derived.timeline.totalBeats)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('respects pickup measures when deriving boundaries (beat-based)', () => {
    const notation = `X:1
T:test
M:2/4
L:1/16
Q:1/4=60
K:C
abcd || e4- eedf- | f2
`;
    const { visualObj, timings } = getTimingsFromNotation(
      'abc-pickup',
      notation,
      60
    );
    const derived = buildTimingDerivedData(visualObj, timings);

    // In 2/4 time with L:1/16, the pickup "abcd" is 4 sixteenth notes = 1 beat
    // Measure boundaries in beats (2/4 = 2 beats per measure)
    // After pickup (1 beat), first full measure ends at beat 1+2=3, but boundary is at beat 1 (end of pickup)
    // Then the next boundary is at beat 3 (1 + 2 = 3)
    const boundaries = (derived.timeline.measureBoundaries ?? []).map((value) =>
      Number(value.toFixed(3))
    );
    expect(boundaries).toEqual([1, 3]);

    // Beat boundaries in beats (starting from beat 1)
    expect(getBeatBoundaries(derived.timeline.totalBeats)).toEqual([1, 2, 3]);
  });

  it('identifies the top pitch for the Dm chord example', () => {
    const notation = `X:1
P:ABBACA
M:2/4
L:1/16
Q:1/4=65
K:Dm clef=treble
P:A
ab[CGd]4
`;
    const { visualObj, timings } = getTimingsFromNotation(
      'abc-leading-tone',
      notation,
      65
    );
    const derived = buildTimingDerivedData(visualObj, timings);

    // Group notes by startBeat instead of startTime
    const groupedByStart = new Map<number, number[]>();
    derived.timeline.notes.forEach((note) => {
      const key = Number(note.startBeat.toFixed(6));
      const existing = groupedByStart.get(key) ?? [];
      existing.push(note.pitch);
      groupedByStart.set(key, existing);
    });

    const chordGroup = Array.from(groupedByStart.values()).find(
      (group) => group.length >= 3
    );
    expect(chordGroup).toBeDefined();
    const pitches = chordGroup ?? [];
    const highestPitch = Math.max(...pitches);
    const lowestPitch = Math.min(...pitches);
    expect(pitches).toContain(74);
    expect(highestPitch).toBe(74);
    expect(highestPitch).toBeGreaterThan(lowestPitch);
  });
});
