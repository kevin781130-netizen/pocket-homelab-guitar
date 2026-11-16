// Opt-in microphone monitoring for single-note pitch feedback only.
// No persistence, tempo grading, or changes to the existing speed trainer.
import { useEffect, useRef, useState } from 'react'
import { audioContext } from '../tools/audio'
import type { TabEngine } from './engine'
import { scoreAudioFrame, type FrameScore } from './scoring'

type Phase = 'off' | 'asking' | 'on' | 'error'

export function PracticeListening({ engine, trackIndex, ready, playing }: {
  engine: TabEngine; trackIndex: number; ready: boolean; playing: boolean
}) {
  const [phase, setPhase] = useState<Phase>('off')
  const [feedback, setFeedback] = useState<FrameScore | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const cleanup = useRef<() => void>(() => {})
  const activeTrack = useRef(trackIndex)
  activeTrack.current = trackIndex

  const stop = () => {
    generation.current++
    cleanup.current()
    cleanup.current = () => {}
    setFeedback(null)
    setPhase('off')
  }

  // Revoke pending permission requests and release the device on navigation.
  useEffect(() => () => {
    generation.current++
    cleanup.current()
    cleanup.current = () => {}
  }, [])

  useEffect(() => { if (!ready) stop() }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFeedback(null) }, [trackIndex])
  useEffect(() => {
    const offs = [engine.on('seek', () => setFeedback(null)), engine.on('pause', () => setFeedback(null))]
    return () => offs.forEach(off => off())
  }, [engine])

  const start = async () => {
    if (!ready || phase === 'asking' || phase === 'on') return
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone needs HTTPS or localhost in a supported browser.')
      setPhase('error')
      return
    }
    const request = ++generation.current
    setFeedback(null)
    setError('')
    setPhase('asking')
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      if (request !== generation.current) {
        stream.getTracks().forEach(t => t.stop())
        return
      }
      const ac = audioContext()
      const src = ac.createMediaStreamSource(stream)
      const hp = ac.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 25
      const analyser = ac.createAnalyser()
      analyser.fftSize = 8192
      src.connect(hp).connect(analyser) // no connection to speakers: no monitoring feedback
      const frame = new Float32Array(analyser.fftSize)
      let raf = 0
      let last = 0
      const track = stream.getAudioTracks()[0]
      const onEnded = () => { if (request === generation.current) stop() }
      track?.addEventListener('ended', onEnded)
      cleanup.current = () => {
        cancelAnimationFrame(raf)
        track?.removeEventListener('ended', onEnded)
        stream?.getTracks().forEach(t => t.stop())
        src.disconnect()
        hp.disconnect()
        analyser.disconnect()
      }
      const sample = (now: number) => {
        if (request !== generation.current) return
        raf = requestAnimationFrame(sample)
        if (now - last < 70) return
        last = now
        if (!engine.state.get().playing) {
          setFeedback(previous => previous === null ? previous : null)
          return
        }
        analyser.getFloatTimeDomainData(frame)
        const result = scoreAudioFrame(frame, ac.sampleRate, engine.beats.get(), activeTrack.current, true)
        setFeedback(previous =>
          previous?.status === result.status && previous?.reason === result.reason &&
          previous?.targetMidi === result.targetMidi &&
          Math.round(previous?.cents ?? 0) === Math.round(result.cents ?? 0) ? previous : result)
      }
      raf = requestAnimationFrame(sample)
      setPhase('on')
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop())
      if (request !== generation.current) return
      const name = (e as DOMException)?.name
      setError(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone access denied. Check browser permissions.'
        : 'Microphone unavailable. Check the input device and permissions.')
      setPhase('error')
    }
  }

  const label = phase === 'asking' ? 'Awaiting microphone permission…'
    : phase === 'error' ? error
    : phase !== 'on' ? 'Opt-in pitch feedback; no scores saved'
    : !playing ? 'Play the tab to check a single note'
    : feedback?.status === 'hit' ? 'Hit · pitch within 25 cents'
    : feedback?.status === 'close' ? 'Close · pitch within 50 cents'
    : feedback?.status === 'miss' ? 'Miss · pitch over 50 cents away'
    : feedback?.reason === 'not-single-note' ? 'Chords, rests and ties are not scored'
    : 'Listening for a clear note…'

  return (
    <div className="practice-listen" role="group" aria-label="Experimental single-note feedback">
      <button type="button" className={`btn sm ${phase === 'on' ? 'active-soft' : ''}`}
        disabled={!ready && phase !== 'on'}
        aria-pressed={phase === 'on'}
        onClick={() => phase === 'on' || phase === 'asking' ? stop() : void start()}>
        {phase === 'on' ? 'Stop listening' : phase === 'asking' ? 'Cancel microphone' : 'Start listening'}
      </button>
      <span className={`practice-listen-result ${phase === 'on' && playing ? feedback?.status ?? '' : ''}`}>{label}</span>
      <span className="practice-listen-note">Single-note pitch only · headphones recommended</span>
    </div>
  )
}
