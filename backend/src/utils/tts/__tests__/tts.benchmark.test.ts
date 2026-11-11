import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Mock config/env before importing anything that depends on it
vi.mock('../../../config/env', () => ({
  config: {
    tts_provider: 'eleven',
    eleven_api_key: 'test-key',
    eleven_voice_a: 'voice-a',
    eleven_voice_b: 'voice-b',
    ffmpeg: 'ffmpeg'
  }
}))

// Mock child_process so ff() doesn't fail due to missing ffmpeg in test environment
vi.mock('child_process', () => {
  const EventEmitter = require('events')
  return {
    spawn: vi.fn(() => {
      const emitter = new EventEmitter()
      emitter.stderr = new EventEmitter()
      setTimeout(() => {
        emitter.emit('close', 0)
      }, 5)
      return emitter
    })
  }
})

describe('synth_eleven benchmark and verification', () => {
  let tmpDir: string
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-benchmark-'))
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('measures execution time with simulated API latency', async () => {
    const { tts } = await import('../index')

    const segmentCount = 6
    const simulatedDelayMs = 50

    globalThis.fetch = vi.fn(async (_url: any, _opts: any) => {
      await new Promise(res => setTimeout(res, simulatedDelayMs))
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
      } as any
    })

    const segs = Array.from({ length: segmentCount }, (_, i) => ({
      text: `Segment sentence number ${i}`,
      voice: i % 2 === 0 ? 'voice-a' : 'voice-b'
    }))

    const progressCalls: any[] = []
    const start = Date.now()
    const out = await tts(segs, tmpDir, 'test_output', (msg) => {
      progressCalls.push(msg)
    })
    const duration = Date.now() - start

    console.log(`[TTS Benchmark] Segments: ${segmentCount}, Delay: ${simulatedDelayMs}ms, Total duration: ${duration}ms`)

    expect(out).toBe(path.join(tmpDir, 'test_output.mp3'))
    expect(progressCalls.filter(p => p.type === 'audio_progress').length).toBe(segmentCount)

    // Verify all segment files were created
    for (let i = 0; i < segmentCount; i++) {
      const segFile = path.join(tmpDir, `test_output.${i}.mp3`)
      expect(fs.existsSync(segFile)).toBe(true)
    }

    // Verify list.txt contains files in correct order
    const listFile = path.join(tmpDir, 'list.txt')
    expect(fs.existsSync(listFile)).toBe(true)
    const listContent = fs.readFileSync(listFile, 'utf8')
    const lines = listContent.trim().split('\n')
    expect(lines.length).toBe(segmentCount)
    for (let i = 0; i < segmentCount; i++) {
      expect(lines[i]).toContain(`test_output.${i}.mp3`)
    }
  })

  it('handles error when elevenlabs returns non-ok status', async () => {
    const { tts } = await import('../index')

    globalThis.fetch = vi.fn(async (_url: any, _opts: any) => {
      return {
        ok: false,
        status: 401
      } as any
    })

    const segs = [{ text: 'Hello', voice: 'voice-a' }]
    await expect(tts(segs, tmpDir, 'test_error')).rejects.toThrow('elevenlabs_http_401')
  })

  it('handles missing voice id', async () => {
    const { config } = await import('../../../config/env')
    const origVoiceA = config.eleven_voice_a
    const origVoiceB = config.eleven_voice_b
    config.eleven_voice_a = ''
    config.eleven_voice_b = ''

    const { tts } = await import('../index')
    const segs = [{ text: 'Hello' }]
    await expect(tts(segs, tmpDir, 'test_missing_voice')).rejects.toThrow('eleven_voice_missing')

    config.eleven_voice_a = origVoiceA
    config.eleven_voice_b = origVoiceB
  })
})
