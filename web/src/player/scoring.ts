// Optional single-note practice scoring. No persistence and no changes to the
// existing trainer: callers supply the current alphaTab beats and an audio frame.
import { detectPitch } from '../tools/pitch.ts'
import type { AT } from './alphatab'

export type ScoreStatus = 'hit' | 'close' | 'miss' | 'unscored'
export type UnscoredReason = 'not-playing' | 'not-single-note' | 'no-reliable-pitch'
export interface FrameScore {
  status: ScoreStatus
  targetMidi: number | null
  detectedHz?: number
  cents?: number
  clarity?: number
  reason?: UnscoredReason
}

const MIN_CLARITY = 0.82
const HIT_CENTS = 25
const CLOSE_CENTS = 50

/** Only score exactly one ordinary note on the selected track. Chords, dead/tied
 * notes and rests are deliberately unsupported, not counted as misses. */
export function activeSingleNoteMidi(beats: readonly AT.model.Beat[], trackIndex: number): number | null {
  if (!Number.isInteger(trackIndex) || trackIndex < 0) return null
  let target: number | null = null
  for (const beat of beats) {
    if (beat.voice.bar.staff.track.index !== trackIndex) continue
    for (const note of beat.notes) {
      if (note.isDead || note.isTieDestination || !Number.isInteger(note.realValue) || note.realValue < 0 || note.realValue > 127 || target !== null) return null
      target = note.realValue
    }
  }
  return target
}

/** Classify pitch only, not timing, articulation or note onset. */
export function classifyPitch(targetMidi: number, frequencyHz: number, clarity: number): FrameScore {
  if (!Number.isInteger(targetMidi) || targetMidi < 0 || targetMidi > 127) return { status: 'unscored', targetMidi: null, reason: 'not-single-note' }
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0 || !Number.isFinite(clarity) || clarity < MIN_CLARITY) {
    return { status: 'unscored', targetMidi, reason: 'no-reliable-pitch' }
  }
  const targetHz = 440 * 2 ** ((targetMidi - 69) / 12)
  const cents = 1200 * Math.log2(frequencyHz / targetHz)
  const delta = Math.abs(cents)
  return {
    status: delta <= HIT_CENTS ? 'hit' : delta <= CLOSE_CENTS ? 'close' : 'miss',
    targetMidi, detectedHz: frequencyHz, cents, clarity,
  }
}

/** Reuses the tuner's YIN implementation; microphone acquisition stays outside
 * this module so it is inert until the user explicitly enables listening. */
export function scoreAudioFrame(
  frame: Float32Array, sampleRate: number, beats: readonly AT.model.Beat[], trackIndex: number, isPlaying: boolean,
): FrameScore {
  if (!isPlaying) return { status: 'unscored', targetMidi: null, reason: 'not-playing' }
  const targetMidi = activeSingleNoteMidi(beats, trackIndex)
  if (targetMidi === null) return { status: 'unscored', targetMidi: null, reason: 'not-single-note' }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || frame.length < 256) return { status: 'unscored', targetMidi, reason: 'no-reliable-pitch' }
  const pitch = detectPitch(frame, sampleRate, 50, 1500)
  return pitch ? classifyPitch(targetMidi, pitch.freq, pitch.clarity) : { status: 'unscored', targetMidi, reason: 'no-reliable-pitch' }
}
