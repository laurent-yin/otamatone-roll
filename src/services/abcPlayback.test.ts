import { describe, expect, it } from 'vitest';
import { normalizeMidiPitches } from './abcPlayback';

describe('normalizeMidiPitches', () => {
  it('returns numbers unchanged when already normalized', () => {
    expect(normalizeMidiPitches([60, 64, 67])).toEqual([60, 64, 67]);
  });

  it('extracts pitch and midi properties from objects', () => {
    const input = [{ pitch: 72 }, { midi: 75 }, { pitch: 79, velocity: 90 }];
    expect(normalizeMidiPitches(input)).toEqual([72, 75, 79]);
  });

  it('filters out invalid entries and non-numeric values', () => {
    const input = [
      { pitch: 'bad' },
      null,
      undefined,
      { midi: Number.NaN },
      'text',
      80,
    ];
    expect(normalizeMidiPitches(input)).toEqual([80]);
  });
});
