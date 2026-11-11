import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'

// Mock child_process.spawn
const mockSpawn = vi.fn()
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args)
}))

// Mock node-edge-tts
vi.mock('node-edge-tts', () => ({
  EdgeTTS: vi.fn(function (this: any) {
    this.ttsPromise = vi.fn().mockResolvedValue(undefined)
  })
}))

// Mock fs.writeFileSync to avoid writing disk files during unit tests if needed
vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

import { ff, validateFfmpegBinary, buildConcatListContent } from '../index'

describe('TTS Security & FFMPEG Argument/Command Injection Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validateFfmpegBinary', () => {
    it('accepts valid binary name or path', () => {
      expect(validateFfmpegBinary('ffmpeg')).toBe('ffmpeg')
      expect(validateFfmpegBinary('/usr/bin/ffmpeg')).toBe('/usr/bin/ffmpeg')
      expect(validateFfmpegBinary('C:\\ffmpeg\\bin\\ffmpeg.exe')).toBe('C:\\ffmpeg\\bin\\ffmpeg.exe')
    })

    it('rejects binary string that starts with hyphen (argument injection)', () => {
      expect(() => validateFfmpegBinary('-version')).toThrow(/must not start with a hyphen/)
      expect(() => validateFfmpegBinary('--help')).toThrow(/must not start with a hyphen/)
    })

    it('rejects binary containing newline, carriage return, or null bytes', () => {
      expect(() => validateFfmpegBinary('ffmpeg\nmalicious')).toThrow(/contains illegal characters/)
      expect(() => validateFfmpegBinary('ffmpeg\0')).toThrow(/contains illegal characters/)
      expect(() => validateFfmpegBinary('ffmpeg\r')).toThrow(/contains illegal characters/)
    })

    it('rejects non-string or empty binary', () => {
      expect(() => validateFfmpegBinary('')).toThrow(/non-empty string/)
      expect(() => validateFfmpegBinary('   ')).toThrow(/non-empty string/)
      expect(() => validateFfmpegBinary(null as any)).toThrow(/non-empty string/)
    })
  })

  describe('buildConcatListContent', () => {
    it('generates properly formatted concat file entries for relative files', () => {
      const dir = '/tmp/test_dir'
      const parts = ['/tmp/test_dir/podcast.0.mp3', '/tmp/test_dir/podcast.1.mp3']
      const content = buildConcatListContent(parts, dir)
      expect(content).toBe("file 'podcast.0.mp3'\nfile 'podcast.1.mp3'")
    })

    it('escapes single quotes correctly', () => {
      const dir = '/tmp/test_dir'
      const parts = ["/tmp/test_dir/podcast'quote.0.mp3"]
      const content = buildConcatListContent(parts, dir)
      expect(content).toBe("file 'podcast'\\''quote.0.mp3'")
    })

    it('rejects parts containing newline injection', () => {
      const dir = '/tmp/test_dir'
      const parts = ['/tmp/test_dir/test.mp3\nfile /etc/passwd']
      expect(() => buildConcatListContent(parts, dir)).toThrow(/illegal control characters/)
    })

    it('rejects parts containing null bytes', () => {
      const dir = '/tmp/test_dir'
      const parts = ['/tmp/test_dir/test.mp3\0.mp3']
      expect(() => buildConcatListContent(parts, dir)).toThrow(/illegal control characters/)
    })

    it('rejects parts whose filename starts with hyphen to prevent flag injection', () => {
      const dir = '/tmp/test_dir'
      const parts = ['/tmp/test_dir/-rf']
      expect(() => buildConcatListContent(parts, dir)).toThrow(/must not start with a hyphen/)
    })
  })

  describe('ff execution safety', () => {
    it('spawns ffmpeg with shell: false and separate argument array', async () => {
      const fakeProcess: any = new EventEmitter()
      fakeProcess.stderr = new EventEmitter()
      mockSpawn.mockReturnValue(fakeProcess)

      const dir = '/tmp/podcast_job_123'
      const parts = ['/tmp/podcast_job_123/podcast.0.mp3']
      const out = '/tmp/podcast_job_123/podcast.mp3'

      const promise = ff(dir, parts, out)

      // Simulate process success
      fakeProcess.emit('close', 0)

      const result = await promise
      expect(result).toBe(path.resolve(out))
      expect(mockSpawn).toHaveBeenCalledTimes(1)

      const [bin, args, options] = mockSpawn.mock.calls[0]
      expect(bin).toBe('ffmpeg')
      expect(options).toEqual({ stdio: 'pipe', shell: false })
      expect(args).toEqual([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        path.join(path.resolve(dir), 'list.txt'),
        '-c:a',
        'libmp3lame',
        '-b:a',
        '192k',
        path.resolve(out)
      ])
    })

    it('rejects out path starting with hyphen', async () => {
      const dir = '/tmp/podcast_job_123'
      const parts = ['/tmp/podcast_job_123/podcast.0.mp3']
      const out = '-dangerous_flag'

      await expect(ff(dir, parts, out)).rejects.toThrow(/must not start with a hyphen/)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('rejects dir path starting with hyphen', async () => {
      const dir = '-bad_dir'
      const parts = ['/tmp/podcast.0.mp3']
      const out = '/tmp/podcast.mp3'

      await expect(ff(dir, parts, out)).rejects.toThrow(/must not start with a hyphen/)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('rejects empty parts array', async () => {
      const dir = '/tmp/podcast_job_123'
      const parts: string[] = []
      const out = '/tmp/podcast_job_123/podcast.mp3'

      await expect(ff(dir, parts, out)).rejects.toThrow(/No audio parts provided/)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('handles ffmpeg non-zero exit code by rejecting with error', async () => {
      const fakeProcess: any = new EventEmitter()
      fakeProcess.stderr = new EventEmitter()
      mockSpawn.mockReturnValue(fakeProcess)

      const dir = '/tmp/podcast_job_123'
      const parts = ['/tmp/podcast_job_123/podcast.0.mp3']
      const out = '/tmp/podcast_job_123/podcast.mp3'

      const promise = ff(dir, parts, out)
      fakeProcess.emit('close', 1)

      await expect(promise).rejects.toThrow('ffmpeg_failed')
    })
  })
})
