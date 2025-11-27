import { useMemo } from 'react';
import abcjs from 'abcjs';
import { Note, NoteTimeline } from '../types/music';

export type OtamatoneRollNotesResult = NoteTimeline & {
  baselineSecondsPerBeat: number;
  playbackSecondsPerBeat: number;
};
interface AbcKeySignatureLike {
  accidentals?: Array<{
    note?: string;
    acc?: string;
  }>;
}
interface AbcPitch {
  pitch: number;
  octave?: number;
  accidental?: string;
}
interface AbcNotePitch extends AbcPitch {
  tie?: string | string[];
}
interface AbcNoteElement {
  el_type: 'note';
  duration?: number;
  pitches?: AbcNotePitch[];
  tie?: string | string[];
  startTie?: boolean;
  endTie?: boolean;
  startChar?: number;
  endChar?: number;
}
interface AbcRestElement {
  el_type: 'rest';
  duration?: number;
}
interface AbcKeyElement extends AbcKeySignatureLike {
  el_type: 'key';
}

type AbcElement = AbcNoteElement | AbcRestElement | AbcKeyElement;
interface AbcjsTuneLike {
  metaText?: {
    tempo?: {
      bpm?: number;
      duration?: number[];
    };
  };
  getBpm?: (tempo?: { bpm?: number; duration?: number[] }) => number;
  getBeatLength?: () => number;
  lines?: Array<{
    staff?: Array<{
      key?: AbcKeySignatureLike;
      voices?: AbcNoteElement[][];
    }>;
  }>;
}
type TieFlags = {
  continuesFromPrevious: boolean;
  continuesToNext: boolean;
};
type ActiveTieMap = Map<string, Map<string, Note>>;
const DEFAULT_BPM = 120;
const DEFAULT_BEAT_LENGTH = 0.25;
export const DEFAULT_SECONDS_PER_BEAT = 60 / DEFAULT_BPM;
const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const createEmptyTimeline = (secondsPerBeat = DEFAULT_SECONDS_PER_BEAT) => ({
  notes: [],
  totalDuration: 0,
  secondsPerBeat,
});
const getTempoDetails = (tune: AbcjsTuneLike) => {
  const tempoMeta = tune.metaText?.tempo;
  const bpmFromTune =
    typeof tune.getBpm === 'function' ? tune.getBpm(tempoMeta) : undefined;
  const beatLengthFromTune =
    typeof tune.getBeatLength === 'function' ? tune.getBeatLength() : undefined;

  const effectiveBpm =
    bpmFromTune && bpmFromTune > 0 ? bpmFromTune : DEFAULT_BPM;
  const effectiveBeatLength =
    (typeof beatLengthFromTune === 'number' && beatLengthFromTune > 0
      ? beatLengthFromTune
      : undefined) ?? DEFAULT_BEAT_LENGTH;
  const secondsPerBeat = 60 / effectiveBpm;
  const secondsPerWholeNote = secondsPerBeat / effectiveBeatLength;

  return { secondsPerWholeNote, secondsPerBeat };
};
const ensureVoiceTieMap = (
  tieState: ActiveTieMap,
  voiceKey: string
): Map<string, Note> => {
  let voiceMap = tieState.get(voiceKey);
  if (!voiceMap) {
    voiceMap = new Map();
    tieState.set(voiceKey, voiceMap);
  }
  return voiceMap;
};
const removeTieEntry = (
  tieState: ActiveTieMap,
  voiceKey: string,
  tieKey: string
) => {
  const voiceMap = tieState.get(voiceKey);
  voiceMap?.delete(tieKey);
  if (voiceMap && voiceMap.size === 0) {
    tieState.delete(voiceKey);
  }
};
const clearVoiceTies = (tieState: ActiveTieMap, voiceKey: string) => {
  tieState.delete(voiceKey);
};
export const buildBaselineTimelineFromNotation = (
  notation: string
): NoteTimeline => {
  if (!notation || notation.trim() === '') {
    return createEmptyTimeline();
  }

  try {
    const tunes = abcjs.parseOnly(notation);
    const tune = tunes?.[0] as AbcjsTuneLike | undefined;

    if (!tune) {
      return createEmptyTimeline();
    }

    const { secondsPerWholeNote, secondsPerBeat } = getTempoDetails(tune);
    const extractedNotes: Note[] = [];
    const voiceTimes = new Map<string, number>();
    const tieStateByVoice: ActiveTieMap = new Map();
    let maxTimeSeconds = 0;

    const lines = Array.isArray(tune.lines) ? tune.lines : [];

    lines.forEach((line, lineIndex) => {
      const staffEntries = Array.isArray(line?.staff) ? line?.staff : [];

      staffEntries.forEach((staff, staffIndex) => {
        const effectiveStaffIndex = staffIndex ?? lineIndex;
        if (!staff) {
          return;
        }

        const staffKeyOffsets = extractKeyAccidentals(staff.key);
        const voices = Array.isArray(staff.voices) ? staff.voices : [];

        voices.forEach((voice, voiceIndex) => {
          const voiceKey = `${effectiveStaffIndex}-${voiceIndex}`;
          let voiceTimeSeconds = voiceTimes.get(voiceKey) ?? 0;
          let currentKeyOffsets = staffKeyOffsets.slice();

          const elements = Array.isArray(voice) ? voice : [];

          elements.forEach((element) => {
            if (
              !element ||
              typeof element !== 'object' ||
              !('el_type' in element)
            ) {
              return;
            }

            const typedElement = element as AbcElement;

            if (isAbcKeyElement(typedElement)) {
              currentKeyOffsets = extractKeyAccidentals(typedElement);
              return;
            }

            if (
              isAbcNoteElement(typedElement) &&
              typedElement.pitches?.length
            ) {
              const durationUnits = typedElement.duration || 0.25;
              const durationSeconds = durationUnits * secondsPerWholeNote;
              const startChar =
                typeof typedElement.startChar === 'number'
                  ? typedElement.startChar
                  : undefined;
              const endChar =
                typeof typedElement.endChar === 'number'
                  ? typedElement.endChar
                  : undefined;

              typedElement.pitches.forEach((pitch, pitchIndex) => {
                if (!pitch) {
                  return;
                }

                const midiNote = pitchToMidi(pitch, currentKeyOffsets);
                const tieFlags = analyzeTieFlags(typedElement, pitchIndex);
                const tieKey = midiNote.toFixed(3);
                const voiceTieMap = tieStateByVoice.get(voiceKey);
                const activeTie = voiceTieMap?.get(tieKey);

                if (!tieFlags.continuesFromPrevious && activeTie) {
                  removeTieEntry(tieStateByVoice, voiceKey, tieKey);
                }

                let targetNote: Note;

                if (tieFlags.continuesFromPrevious && activeTie) {
                  targetNote = activeTie;
                  targetNote.duration += durationSeconds;
                  targetNote.source = {
                    ...targetNote.source,
                    endChar,
                  };
                } else {
                  targetNote = {
                    pitch: midiNote,
                    startTime: voiceTimeSeconds,
                    duration: durationSeconds,
                    velocity: 80,
                    source: {
                      startChar,
                      endChar,
                      staffIndex: effectiveStaffIndex,
                      voiceIndex,
                    },
                  };
                  extractedNotes.push(targetNote);
                }

                if (tieFlags.continuesToNext) {
                  const mapForVoice = ensureVoiceTieMap(
                    tieStateByVoice,
                    voiceKey
                  );
                  mapForVoice.set(tieKey, targetNote);
                } else {
                  removeTieEntry(tieStateByVoice, voiceKey, tieKey);
                }
              });

              voiceTimeSeconds += durationSeconds;
              return;
            }

            if (isAbcRestElement(typedElement)) {
              const restDurationUnits = typedElement.duration || 0.25;
              voiceTimeSeconds += restDurationUnits * secondsPerWholeNote;
              clearVoiceTies(tieStateByVoice, voiceKey);
              return;
            }
          });

          voiceTimes.set(voiceKey, voiceTimeSeconds);
          maxTimeSeconds = Math.max(maxTimeSeconds, voiceTimeSeconds);
        });
      });
    });

    return {
      notes: extractedNotes,
      totalDuration: maxTimeSeconds,
      secondsPerBeat,
    };
  } catch (error) {
    console.error('Error extracting notes from abcjs parse', error);
    return createEmptyTimeline();
  }
};

export const normalizeTimelineToBaseline = (
  timeline: NoteTimeline,
  baselineSecondsPerBeat: number
): NoteTimeline => {
  return {
    notes: timeline.notes.map((note) => ({ ...note })),
    totalDuration: timeline.totalDuration,
    secondsPerBeat: baselineSecondsPerBeat,
  };
};

export const createOtamatoneRollNotesResult = (
  baselineTimeline: NoteTimeline,
  overrideTimeline?: NoteTimeline | null
): OtamatoneRollNotesResult => {
  const baselineSecondsPerBeat = isPositiveNumber(
    baselineTimeline.secondsPerBeat
  )
    ? (baselineTimeline.secondsPerBeat as number)
    : DEFAULT_SECONDS_PER_BEAT;

  const sourceTimeline = overrideTimeline ?? baselineTimeline;
  const playbackSecondsPerBeat = isPositiveNumber(sourceTimeline.secondsPerBeat)
    ? (sourceTimeline.secondsPerBeat as number)
    : baselineSecondsPerBeat;

  const normalizedTimeline = normalizeTimelineToBaseline(
    sourceTimeline,
    baselineSecondsPerBeat
  );

  return {
    ...normalizedTimeline,
    baselineSecondsPerBeat,
    playbackSecondsPerBeat,
  };
};

export const useOtamatoneRollNotes = (
  notation: string,
  override?: NoteTimeline | null
): OtamatoneRollNotesResult => {
  const baselineTimeline = useMemo<NoteTimeline>(() => {
    return buildBaselineTimelineFromNotation(notation);
  }, [notation]);

  return useMemo(() => {
    return createOtamatoneRollNotesResult(baselineTimeline, override);
  }, [baselineTimeline, override]);
};

const BASE_MIDI_FOR_C = 60;
const DIATONIC_TO_SEMITONE = [0, 2, 4, 5, 7, 9, 11];
const LETTER_TO_DIATONIC_INDEX: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};
const ACCIDENTAL_TO_OFFSET: Record<string, number> = {
  sharp: 1,
  flat: -1,
  natural: 0,
  dblsharp: 2,
  double_sharp: 2,
  'double-sharp': 2,
  dblflat: -2,
  double_flat: -2,
  'double-flat': -2,
  quartersharp: 0.5,
  quarterflat: -0.5,
  'sharp-and-a-half': 1.5,
  'flat-and-a-half': -1.5,
};

function pitchToMidi(pitch: AbcPitch, keyOffsets: number[]): number {
  if (typeof pitch.pitch !== 'number' || Number.isNaN(pitch.pitch)) {
    return BASE_MIDI_FOR_C;
  }

  const octave = Math.floor(pitch.pitch / 7);
  const diatonicIndex = ((pitch.pitch % 7) + 7) % 7;
  const defaultKeyOffset = keyOffsets[diatonicIndex] ?? 0;
  const accidentalOffset =
    pitch.accidental !== undefined && pitch.accidental !== null
      ? accidentalNameToOffset(pitch.accidental)
      : defaultKeyOffset;

  const diatonicSemitone = DIATONIC_TO_SEMITONE[diatonicIndex] ?? 0;
  const semitone =
    BASE_MIDI_FOR_C + octave * 12 + diatonicSemitone + accidentalOffset;
  return Math.round(semitone * 2) / 2;
}

const toTieArray = (value?: string | string[]) => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const analyzeTieFlags = (
  element?: AbcNoteElement,
  pitchIndex?: number
): TieFlags => {
  if (!element) {
    return { continuesFromPrevious: false, continuesToNext: false };
  }

  const pitch =
    typeof pitchIndex === 'number' ? element.pitches?.[pitchIndex] : undefined;
  const pitchTies = toTieArray(pitch?.tie);
  const elementTies = toTieArray(element.tie);
  const combined = [...pitchTies, ...elementTies];

  const continuesFromPrevious = Boolean(
    element.endTie ||
      combined.some((flag) => flag === 'end' || flag === 'continue')
  );
  const continuesToNext = Boolean(
    element.startTie ||
      combined.some((flag) => flag === 'start' || flag === 'continue')
  );

  return { continuesFromPrevious, continuesToNext };
};

function accidentalNameToOffset(name?: string): number {
  if (!name) return 0;
  return ACCIDENTAL_TO_OFFSET[name] ?? 0;
}

function extractKeyAccidentals(key?: AbcKeySignatureLike): number[] {
  const offsets = new Array(7).fill(0);
  if (!key || !Array.isArray(key.accidentals)) {
    return offsets;
  }

  key.accidentals.forEach((accidental) => {
    if (!accidental?.note) {
      return;
    }
    const letter = accidental.note.toUpperCase();
    const index = LETTER_TO_DIATONIC_INDEX[letter];
    if (index === undefined) {
      return;
    }
    offsets[index] = accidentalNameToOffset(accidental.acc ?? undefined);
  });

  return offsets;
}

const isAbcKeyElement = (value: unknown): value is AbcKeyElement => {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    'el_type' in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>).el_type === 'key'
  );
};

const isAbcNoteElement = (value: unknown): value is AbcNoteElement => {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).el_type === 'note'
  );
};

const isAbcRestElement = (value: unknown): value is AbcRestElement => {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).el_type === 'rest'
  );
};
