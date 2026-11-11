import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { EdgeTTS } from 'node-edge-tts'
import { config } from '../../config/env'

export type TSeg = { text: string; voice?: string }
export type TSay = (segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) => Promise<string>

function sanitizePath(p: string, paramName: string): string {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error(`Invalid ${paramName}: path must be a non-empty string`)
  }
  const resolved = path.resolve(p)
  const baseName = path.basename(resolved)
  if (baseName.startsWith('-')) {
    throw new Error(`Invalid ${paramName}: filename must not start with a hyphen '-'`)
  }
  if (/[\r\n\0]/.test(p)) {
    throw new Error(`Invalid ${paramName}: path contains illegal control characters`)
  }
  return resolved
}

export function validateFfmpegBinary(bin: string): string {
  if (typeof bin !== 'string' || !bin.trim()) {
    throw new Error('Invalid ffmpeg binary path: must be a non-empty string')
  }
  if (/[\r\n\0]/.test(bin)) {
    throw new Error('Invalid ffmpeg binary path: contains illegal characters')
  }
  const trimmed = bin.trim()
  if (trimmed.startsWith('-')) {
    throw new Error('Invalid ffmpeg binary path: binary must not start with a hyphen')
  }
  return trimmed
}

export function buildConcatListContent(parts: string[], dir: string): string {
  const resolvedDir = path.resolve(dir)
  return parts.map((p, idx) => {
    const resolvedPart = sanitizePath(p, `part[${idx}]`)
    const rel = path.relative(resolvedDir, resolvedPart)
    
    // If inside directory and doesn't traverse upwards, use relative path with forward slashes
    const isInsideDir = !rel.startsWith('..') && !path.isAbsolute(rel)
    const targetPath = isInsideDir ? rel.split(path.sep).join('/') : resolvedPart.split(path.sep).join('/')
    
    if (/[\r\n\0]/.test(targetPath)) {
      throw new Error(`Invalid part path: contains newline or null byte`)
    }
    
    return `file '${targetPath.replace(/'/g, "'\\''")}'`
  }).join('\n')
}

export function ff(dir: string, parts: string[], out: string, emit?: (m: any) => void) {
  return new Promise<string>((res, rej) => {
    try {
      if (!Array.isArray(parts) || parts.length === 0) {
        throw new Error('No audio parts provided for concatenation')
      }
      const safeDir = sanitizePath(dir, 'dir')
      const safeOut = sanitizePath(out, 'out')
      const bin = validateFfmpegBinary(config.ffmpeg || 'ffmpeg')

      const list = path.join(safeDir, 'list.txt')
      const listContent = buildConcatListContent(parts, safeDir)
      fs.writeFileSync(list, listContent)

      const args = ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '192k', safeOut]
      const p = spawn(bin, args, { stdio: 'pipe', shell: false })

      p.stderr.on('data', d => {
        const msg = String(d)
        emit && emit({ type: 'ffmpeg', data: msg })
      })

      p.on('close', c => {
        if (c === 0) {
          res(safeOut)
        } else {
          rej(new Error('ffmpeg_failed'))
        }
      })

      p.on('error', err => {
        rej(err)
      })
    } catch (err) {
      rej(err)
    }
  })
}

async function synth_edge(segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) {
  const v0 = config.tts_voice_edge || 'en-US-AvaNeural'
  const v1 = config.tts_voice_alt_edge || 'en-US-AndrewNeural'
  
  const files: string[] = []

  async function convertSegmentWithRetry(seg: TSeg, voice: string, outputFile: string, segmentIndex: number, maxRetries = 3) {
    let lastError: any = null
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const tts = new EdgeTTS({
          voice: voice,
          lang: voice.split('-').slice(0, 2).join('-'),
          outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
          timeout: 15000
        })
        
        await tts.ttsPromise(seg.text, outputFile)
        
        const stats = fs.statSync(outputFile)
        if (stats.size === 0) {
          throw new Error('Generated file is empty')
        }
        
        return
        
      } catch (err: any) {
        lastError = err
        
        if (attempt < maxRetries) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // Exponential backoff: 1s, 2s, 4s (max 5s)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
    }
    
    throw new Error(`Failed to convert segment ${segmentIndex + 1} after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`)
  }

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const v = s.voice || (i % 2 ? v1 : v0)
    const f = path.join(dir, `${base}.${i}.mp3`)
    
    await convertSegmentWithRetry(s, v, f, i)
    
    files.push(f)
    emit && emit({ type: 'audio_progress', i, len: segs.length })
  }

  const out = path.join(dir, `${base}.mp3`)
  const result = await ff(dir, files, out, emit)
  return result
}

async function synth_eleven(segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) {
  const k = config.eleven_api_key || ''
  const v0 = config.eleven_voice_a || ''
  const v1 = config.eleven_voice_b || v0
  const files: string[] = []

  if (!k) throw new Error('eleven_api_key_missing')

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const v = s.voice || (i % 2 ? v1 : v0)
    if (!v) throw new Error('eleven_voice_missing')
    const f = path.join(dir, `${base}.${i}.mp3`)

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v}`, {
      method: 'POST',
      headers: { 'xi-api-key': k, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: s.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.4, similarity_boost: 0.8 }
      })
    })
    if (!r.ok) throw new Error(`elevenlabs_http_${r.status}`)
    const b = new Uint8Array(await r.arrayBuffer())
    await fs.promises.writeFile(f, b)
    files.push(f)
    emit && emit({ type: 'audio_progress', i, len: segs.length })
  }

  const out = path.join(dir, `${base}.mp3`)
  return await ff(dir, files, out, emit)
}

async function synth_google(segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) {
  const creds = config.google_creds || process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!creds) throw new Error('google_creds_missing')

  const mod = await import('@google-cloud/text-to-speech')
  const TTS: any = (mod as any).default || mod
  const c = new TTS.TextToSpeechClient()
  const v0 = config.tts_voice_google || 'en-US-Neural2-F'
  const v1 = config.tts_voice_alt_google || 'en-US-Neural2-D'
  const files: string[] = []

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const v = s.voice || (i % 2 ? v1 : v0)
    const [r] = await c.synthesizeSpeech({
      input: { text: s.text },
      voice: { languageCode: v.split('-').slice(0, 2).join('-'), name: v },
      audioConfig: { audioEncoding: 'MP3' }
    })
    const f = path.join(dir, `${base}.${i}.mp3`)
    await fs.promises.writeFile(f, r.audioContent as Buffer)
    files.push(f)
    emit && emit({ type: 'audio_progress', i, len: segs.length })
  }

  const out = path.join(dir, `${base}.mp3`)
  return await ff(dir, files, out, emit)
}

export const tts: TSay = async (segs, dir, base, emit) => {
  const p = config.tts_provider || 'edge'
  
  if (p === 'edge') {
    return synth_edge(segs, dir, base, emit)
  } else if (p === 'eleven') {
    return synth_eleven(segs, dir, base, emit)
  } else if (p === 'google') {
    return synth_google(segs, dir, base, emit)
  } else {
    return synth_edge(segs, dir, base, emit)
  }
}