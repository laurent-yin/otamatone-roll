import abcjs from 'abcjs';
import { describe, expect, it } from 'vitest';
import {
  buildTimingDerivedData,
  VisualObjWithTimings,
} from '../../src/utils/abcTiming';

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
  it('extracts Bb scale note data for otamatone roll rendering', () => {
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
    const condensed = derived.timeline.notes.map((note) => ({
      pitch: note.pitch,
      start: Number(note.startTime.toFixed(3)),
      duration: Number(note.duration.toFixed(3)),
    }));
    condensed.forEach((entry, index) => {
      const expectedStart = Number((index * 0.5).toFixed(3));
      expect(entry.start).toBeCloseTo(expectedStart, 2);
      expect(entry.duration).toBeGreaterThan(0);
    });
    expect(derived.timeline.measureBoundaries).toEqual([2]);
    expect(derived.timeline.beatBoundaries).toEqual([
      0.5, 1, 1.5, 2, 2.5, 3, 3.5,
    ]);
  });

  it('respects pickup measures when deriving boundaries', () => {
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
    const boundaries = (derived.timeline.measureBoundaries ?? []).map((value) =>
      Number(value.toFixed(3))
    );
    expect(boundaries).toEqual([1, 3]);
    expect(derived.timeline.beatBoundaries).toEqual([1, 2, 3]);
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
    const groupedByStart = new Map<number, number[]>();
    derived.timeline.notes.forEach((note) => {
      const key = Number(note.startTime.toFixed(6));
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
