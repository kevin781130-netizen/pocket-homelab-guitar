import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeSingleNoteMidi, classifyPitch, scoreAudioFrame } from '../src/player/scoring.ts'

const beat = (values, track = 0, extra = {}) => ({
  voice: { bar: { staff: { track: { index: track } } } },
  notes: values.map(realValue => ({ realValue, isDead: false, isTieDestination: false, ...extra })),
})
const sine = (hz, sampleRate = 44100, size = 8192) => Float32Array.from(
  { length: size }, (_, i) => Math.sin(2 * Math.PI * hz * i / sampleRate) * 0.7,
)

test('selects exactly one playable note from the chosen track', () => {
  assert.equal(activeSingleNoteMidi([beat([69]), beat([64], 1)], 0), 69)
  assert.equal(activeSingleNoteMidi([beat([64], 1)], 0), null)
  assert.equal(activeSingleNoteMidi([beat([])], 0), null)
  assert.equal(activeSingleNoteMidi([beat([60, 64])], 0), null)
  assert.equal(activeSingleNoteMidi([beat([69], 0, { isDead: true })], 0), null)
  assert.equal(activeSingleNoteMidi([beat([69], 0, { isTieDestination: true })], 0), null)
  assert.equal(activeSingleNoteMidi([beat([69])], -1), null)
})

test('pitch thresholds distinguish hit, close, miss without treating an octave as correct', () => {
  assert.equal(classifyPitch(69, 440, 1).status, 'hit')
  assert.equal(classifyPitch(69, 440 * 2 ** (35 / 1200), 1).status, 'close')
  assert.equal(classifyPitch(69, 440 * 2 ** (80 / 1200), 1).status, 'miss')
  assert.equal(classifyPitch(69, 880, 1).status, 'miss')
  assert.equal(classifyPitch(69, 440, 0.5).status, 'unscored')
  assert.equal(classifyPitch(69, Number.NaN, 1).status, 'unscored')
  assert.equal(classifyPitch(200, 440, 1).status, 'unscored')
})

test('real tuner YIN classifies a synthetic single note as hit', () => {
  const result = scoreAudioFrame(sine(440), 44100, [beat([69])], 0, true)
  assert.equal(result.status, 'hit', JSON.stringify(result))
  assert.ok(Math.abs(result.cents) < 25)
})

test('YIN cannot treat a different note as hit', () => {
  const result = scoreAudioFrame(sine(493.8833), 44100, [beat([69])], 0, true)
  assert.equal(result.status, 'miss', JSON.stringify(result))
})

test('silence, paused playback, and chords remain unscored', () => {
  assert.equal(scoreAudioFrame(new Float32Array(8192), 44100, [beat([69])], 0, true).status, 'unscored')
  assert.equal(scoreAudioFrame(sine(440), 44100, [beat([69])], 0, false).reason, 'not-playing')
  assert.equal(scoreAudioFrame(sine(440), 44100, [beat([69, 72])], 0, true).reason, 'not-single-note')
  assert.equal(scoreAudioFrame(sine(440), 0, [beat([69])], 0, true).reason, 'no-reliable-pitch')
})
