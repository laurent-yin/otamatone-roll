import { useMemo } from 'react';
import abcjs from 'abcjs';
import { Note } from '../types/music';

interface AbcPitch {
  pitch: number;
  octave?: number;
  accidental?: string;
}

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
      const extractedNotes: Note[] = [];
      let currentTime = 0;
      let maxTime = 0;

      // The tune structure has lines -> staff -> voices -> notes
      if (tune.lines) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tune.lines.forEach((line: any) => {
          // Skip non-music lines (like title, composer, etc.)
          if (line.staff) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            line.staff.forEach((staff: any) => {
              if (staff.voices) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                staff.voices.forEach((voice: any) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  voice.forEach((element: any) => {
                    // Handle notes
                    if (element.el_type === 'note' && element.pitches) {
                      const duration = element.duration || 0.25;

                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      element.pitches.forEach((pitch: any) => {
                        const midiNote = pitchToMidi(pitch);

                        extractedNotes.push({
                          pitch: midiNote,
                          startTime: currentTime,
                          duration: duration,
                          velocity: 80,
                        });
                      });

                      currentTime += duration;
                      maxTime = Math.max(maxTime, currentTime);
                    }
                    // Handle rests
                    else if (element.el_type === 'rest') {
                      currentTime += element.duration || 0.25;
                    }
                  });
                });
              }
            });
          }
        });
      }

      return { notes: extractedNotes, totalDuration: maxTime };
    } catch (error) {
      console.error('Error extracting notes:', error);
      return { notes: [], totalDuration: 0 };
    }
  }, [notation]);

  return result;
};

// Helper function to convert ABC pitch to MIDI note number
function pitchToMidi(pitch: AbcPitch): number {
  // In abcjs parseOnly, pitch.pitch is relative to C4 (middle C)
  // But the reference point appears to be different from what we expect
  // Looking at the console: 'C,' has pitch -7, 'C' has pitch 0, 'c' has pitch 7
  // This means the reference (pitch 0) is uppercase C, which is C3 (MIDI 48)
  // So: pitch 0 = C3 = MIDI 48, not middle C

  const cThree = 48; // C3 in MIDI

  if (typeof pitch.pitch === 'number') {
    return cThree + pitch.pitch;
  }

  // Fallback
  return cThree;
}
