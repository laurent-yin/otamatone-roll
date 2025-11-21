import { useMemo } from 'react';
import abcjs from 'abcjs';
import { Note } from '../types/music';

interface AbcPitch {
  pitch: number;
  octave?: number;
  accidental?: string;
}

interface AbcKeySignatureLike {
  // Matches abcjs KeySignature shape partially.
  accidentals?: Array<{
    note?: string;
    acc?: string;
  }>;
}
interface AbcjsTuneLike {
  metaText?: {
    tempo?: {
      bpm?: number;
      duration?: number[];
    };
  };
  getBpm?: (tempo?: { bpm?: number; duration?: number[] }) => number;
  getBeatLength?: () => number;
}

const DEFAULT_BPM = 120;
const DEFAULT_BEAT_LENGTH = 0.25; // quarter note

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

  return { secondsPerWholeNote };
};

export const usePianoRollNotes = (notation: string) => {
  const result = useMemo(() => {
    if (!notation || notation.trim() === '') {
      return { notes: [], totalDuration: 0 };
    }

    try {
      // Parse ABC notation to get the tune object
      const tunes = abcjs.parseOnly(notation);

      if (!tunes || tunes[0] === undefined) {
        return { notes: [], totalDuration: 0 };
      }

      const tune = tunes[0];
      const { secondsPerWholeNote } = getTempoDetails(tune as AbcjsTuneLike);
      const extractedNotes: Note[] = [];
      const voiceTimes = new Map<string, number>();
      let maxTimeSeconds = 0;

      // The tune structure has lines -> staff -> voices -> notes
      const TARGET_STAFF_INDEX = 0;
      const TARGET_VOICE_INDEX = 0;

      if (tune.lines) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tune.lines.forEach((line: any) => {
          // Skip non-music lines (like title, composer, etc.)
          if (line.staff) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            line.staff.forEach((staff: any, staffIndex: number) => {
              if (staffIndex !== TARGET_STAFF_INDEX) {
                return;
              }

              const staffKeyOffsets = extractKeyAccidentals(
                (staff.key as AbcKeySignatureLike) ?? undefined
              );

              if (staff.voices) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                staff.voices.forEach((voice: any, voiceIndex: number) => {
                  if (voiceIndex !== TARGET_VOICE_INDEX) {
                    return;
                  }

                  const voiceKey = `${staffIndex}-${voiceIndex}`;
                  let voiceTimeSeconds = voiceTimes.get(voiceKey) ?? 0;
                  let currentKeyOffsets = staffKeyOffsets.slice();
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  voice.forEach((element: any) => {
                    if (element.el_type === 'key') {
                      currentKeyOffsets = extractKeyAccidentals(
                        (element as AbcKeySignatureLike) ?? undefined
                      );
                      return;
                    }

                    // Handle notes
                    if (element.el_type === 'note' && element.pitches) {
                      const durationUnits = element.duration || 0.25;
                      const durationSeconds =
                        durationUnits * secondsPerWholeNote;

                      const primaryPitch = element.pitches[0];
                      if (primaryPitch) {
                        const midiNote = pitchToMidi(
                          primaryPitch,
                          currentKeyOffsets
                        );
                        const startChar =
                          typeof element.startChar === 'number'
                            ? element.startChar
                            : undefined;
                        const endChar =
                          typeof element.endChar === 'number'
                            ? element.endChar
                            : undefined;

                        extractedNotes.push({
                          pitch: midiNote,
                          startTime: voiceTimeSeconds,
                          duration: durationSeconds,
                          velocity: 80,
                          source: {
                            startChar,
                            endChar,
                            staffIndex,
                            voiceIndex,
                          },
                        });
                      }

                      voiceTimeSeconds += durationSeconds;
                    }
                    // Handle rests
                    else if (element.el_type === 'rest') {
                      const restDurationUnits = element.duration || 0.25;
                      voiceTimeSeconds +=
                        restDurationUnits * secondsPerWholeNote;
                    }
                  });

                  voiceTimes.set(voiceKey, voiceTimeSeconds);
                  maxTimeSeconds = Math.max(maxTimeSeconds, voiceTimeSeconds);
                });
              }
            });
          }
        });
      }

      return { notes: extractedNotes, totalDuration: maxTimeSeconds };
    } catch (error) {
      console.error('Error extracting notes:', error);
      return { notes: [], totalDuration: 0 };
    }
  }, [notation]);

  return result;
};

const BASE_MIDI_FOR_C = 60; // Treat pitch 0 ("C") as middle C.
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

// Helper function to convert ABC pitch (diatonic index + accidental) to a MIDI number.
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

  // abcjs can represent quarter-tone values; keep half-step precision if necessary.
  return Math.round(semitone * 2) / 2;
}

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
    if (!accidental || !accidental.note) return;
    const letter = accidental.note.toUpperCase();
    const index = LETTER_TO_DIATONIC_INDEX[letter];
    if (index === undefined) return;
    offsets[index] = accidentalNameToOffset(accidental.acc ?? undefined);
  });

  return offsets;
}
