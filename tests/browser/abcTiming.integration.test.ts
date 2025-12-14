import abcjs from 'abcjs';
import { describe, expect, it } from 'vitest';
import {
  buildTimingDerivedData,
  VisualObjWithTimings,
} from '../../src/utils/abcTiming';
import { getSubdivisionBoundaries } from '../../src/types/music';

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
  it('extracts Bb scale note data for otamatone roll rendering (subdivision-based)', () => {
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

    // With subdivision-based structure, each quarter note = 1 subdivision (in 4/4)
    // At Q:1/4=120, each note should be 1 subdivision apart
    const condensed = derived.timeline.notes.map((note) => ({
      pitch: note.pitch,
      startSubdivision: Number(note.startSubdivision.toFixed(3)),
      durationSubdivisions: Number(note.durationSubdivisions.toFixed(3)),
    }));
    condensed.forEach((entry, index) => {
      // Each note starts on successive subdivisions (0, 1, 2, 3, ...)
      expect(entry.startSubdivision).toBeCloseTo(index, 2);
      expect(entry.durationSubdivisions).toBeGreaterThan(0);
      // Quarter notes should be 1 subdivision each
      expect(entry.durationSubdivisions).toBeCloseTo(1, 1);
    });

    // Measure boundaries in subdivisions (4/4 time = 4 subdivisions per measure)
    // First measure ends at subdivision 4
    expect(derived.timeline.measureBoundaries).toEqual([4]);

    // Subdivision boundaries should be integer subdivisions (0, 1, 2, 3, 4, 5, 6, 7)
    // but we don't include subdivision 0 or the final subdivision
    expect(
      getSubdivisionBoundaries(derived.timeline.totalSubdivisions)
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('respects pickup measures when deriving boundaries (subdivision-based)', () => {
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

    // In 2/4 time with L:1/16, the pickup "abcd" is 4 sixteenth notes = 1 subdivision (quarter note)
    // Measure boundaries in subdivisions (2/4 = 2 subdivisions per measure)
    // After pickup (1 subdivision), first full measure ends at subdivision 1+2=3, but boundary is at subdivision 1 (end of pickup)
    // Then the next boundary is at subdivision 3 (1 + 2 = 3)
    const boundaries = (derived.timeline.measureBoundaries ?? []).map((value) =>
      Number(value.toFixed(3))
    );
    expect(boundaries).toEqual([1, 3]);

    // Subdivision boundaries (starting from subdivision 1)
    expect(
      getSubdivisionBoundaries(derived.timeline.totalSubdivisions)
    ).toEqual([1, 2, 3]);
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

    // Group notes by startSubdivision instead of startTime
    const groupedByStart = new Map<number, number[]>();
    derived.timeline.notes.forEach((note) => {
      const key = Number(note.startSubdivision.toFixed(6));
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

  it('handles 12/8 compound meter with Q:3/8=bpm tempo correctly', () => {
    // In 12/8 time with Q:3/8=140:
    // - M:12/8 means 12 eighth notes per measure (12 subdivisions)
    // - L:1/8 means each note is an eighth note
    // - Q:3/8=140 means 3 eighth notes = 1 beat at 140 BPM
    // - Each 1/8 note should be 1 subdivision
    const notation = `X:1
T:The Rising Fighting Spirit
M:12/8
L:1/8
Q:3/8=140
K:Em
CDE FGA`;
    const { visualObj, timings } = getTimingsFromNotation(
      'abc-12-8',
      notation,
      140
    );

    // The tempo Q:3/8=140 means 140 dotted-quarter beats per minute
    // secondsPerSubdivision = 60/140/3 = 0.1429 seconds per eighth note subdivision
    const secondsPerSubdivision = 60 / 140 / 3;
    const derived = buildTimingDerivedData(visualObj, timings, {
      secondsPerSubdivision,
    });

    expect(derived.timeline.notes).toHaveLength(6);

    // All notes should have the SAME duration since they're all 1/8 notes
    // In 12/8, each eighth note = 1 subdivision
    const durations = derived.timeline.notes.map((n) => n.durationSubdivisions);
    const firstDuration = durations[0];
    expect(firstDuration).toBeCloseTo(1, 1); // 1/8 note = 1 subdivision
    durations.forEach((dur) => {
      expect(dur).toBeCloseTo(firstDuration!, 1);
    });

    // Notes should be evenly spaced (gap should equal duration)
    const starts = derived.timeline.notes.map((n) => n.startSubdivision);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i]! - starts[i - 1]!;
      expect(gap).toBeCloseTo(firstDuration!, 1);
    }
  });
});
