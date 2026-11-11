import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'

const mocks = vi.hoisted(() => {
  // Use simple event-emitter like structure or require('stream').EventEmitter inside vi.hoisted
  const { EventEmitter } = require('events')
  const busboyEmitter = new EventEmitter()
  return {
    busboyEmitter,
    busboyFactory: vi.fn(() => busboyEmitter),
  }
})

// Mock external dependencies before importing upload module
vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}))

vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}))

vi.mock('marked', () => ({
  marked: {
    parse: vi.fn(),
  },
}))

vi.mock('../../ai/embed', () => ({
  embedTextFromFile: vi.fn().mockResolvedValue('Uploaded successfully.'),
}))

vi.mock('@langchain/ollama', () => {
  const MockOllamaEmbeddings = vi.fn(function (this: any, opts: any) {
    this._opts = opts
  })
  return { OllamaEmbeddings: MockOllamaEmbeddings }
})

vi.mock('@langchain/openai', () => {
  const MockOpenAIEmbeddings = vi.fn(function (this: any, opts: any) {
    this._opts = opts
  })
  return { OpenAIEmbeddings: MockOpenAIEmbeddings }
})

vi.mock('busboy', () => ({
  default: mocks.busboyFactory,
}))

import { EventEmitter } from 'events'
import mammoth from 'mammoth'
import pdf from 'pdf-parse'
import { marked } from 'marked'
import { embedTextFromFile } from '../../ai/embed'
import { OllamaEmbeddings } from '@langchain/ollama'
import { OpenAIEmbeddings } from '@langchain/openai'
import { handleUpload, parseMultipart } from '../upload'

describe('Upload Parser', () => {
  const origEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.busboyEmitter.removeAllListeners()
    process.env = { ...origEnv }
  })

  afterEach(() => {
    process.env = origEnv
  })

  describe('handleUpload', () => {
    it('should process plain text files, write output file, and embed with default namespace', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('Hello plain world'))
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = await handleUpload({ filePath: '/tmp/test.txt', contentType: 'text/plain' })

      expect(fs.readFileSync).toHaveBeenCalledWith('/tmp/test.txt')
      expect(writeSpy).toHaveBeenCalledWith('/tmp/test.txt.txt', 'Hello plain world')
      expect(embedTextFromFile).toHaveBeenCalledWith('/tmp/test.txt.txt', 'pagelm')
      expect(OpenAIEmbeddings).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'text-embedding-3-small',
        }),
      )
      expect(result).toEqual({ stored: '/tmp/test.txt.txt' })
    })

    it('should use custom namespace when provided', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('Custom content'))
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = await handleUpload({
        filePath: '/tmp/test.txt',
        contentType: 'text/plain',
        namespace: 'custom-ns',
      })

      expect(embedTextFromFile).toHaveBeenCalledWith('/tmp/test.txt.txt', 'custom-ns')
      expect(result).toEqual({ stored: '/tmp/test.txt.txt' })
    })

    it('should process markdown files using marked.parse', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('# Header\nSome markdown text'))
      vi.spyOn(marked, 'parse').mockReturnValue('<p>Some markdown text</p>')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = await handleUpload({ filePath: '/tmp/test.md', contentType: 'text/markdown' })

      expect(marked.parse).toHaveBeenCalledWith('# Header\nSome markdown text')
      expect(writeSpy).toHaveBeenCalledWith('/tmp/test.md.txt', '<p>Some markdown text</p>')
      expect(result).toEqual({ stored: '/tmp/test.md.txt' })
    })

    it('should process PDF files using pdf-parse', async () => {
      const pdfBuffer = Buffer.from('fake-pdf-content')
      vi.spyOn(fs, 'readFileSync').mockReturnValue(pdfBuffer)
      vi.mocked(pdf).mockResolvedValue({ text: 'Extracted PDF text' } as any)
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = await handleUpload({
        filePath: '/tmp/sample.pdf',
        contentType: 'application/pdf',
      })

      expect(pdf).toHaveBeenCalledWith(pdfBuffer)
      expect(writeSpy).toHaveBeenCalledWith('/tmp/sample.pdf.txt', 'Extracted PDF text')
      expect(result).toEqual({ stored: '/tmp/sample.pdf.txt' })
    })

    it.each([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.oasis.opendocument.text',
    ])('should process Word/ODT files (%s) using mammoth.extractRawText', async (contentType) => {
      const docBuffer = Buffer.from('fake-doc-buffer')
      vi.spyOn(fs, 'readFileSync').mockReturnValue(docBuffer)
      vi.mocked(mammoth.extractRawText).mockResolvedValue({ value: 'Extracted Word text' } as any)
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      const result = await handleUpload({
        filePath: '/tmp/sample.docx',
        contentType,
      })

      expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer: docBuffer })
      expect(writeSpy).toHaveBeenCalledWith('/tmp/sample.docx.txt', 'Extracted Word text')
      expect(result).toEqual({ stored: '/tmp/sample.docx.txt' })
    })

    it('should throw error for unsupported content type', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('fake image data'))

      await expect(
        handleUpload({ filePath: '/tmp/sample.png', contentType: 'image/png' }),
      ).rejects.toThrow('unsupported file type')
    })

    it('should throw error when contentType is empty and unhandled', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('binary data'))

      await expect(
        handleUpload({ filePath: '/tmp/sample.bin' }),
      ).rejects.toThrow('unsupported file type')
    })

    it('should throw error when extracted text is empty or whitespace only', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('   \n\t  '))

      await expect(
        handleUpload({ filePath: '/tmp/blank.txt', contentType: 'text/plain' }),
      ).rejects.toThrow('No valid content extracted from file.')
    })

    it('should instantiate OllamaEmbeddings when LLM_PROVIDER is ollama', async () => {
      process.env.LLM_PROVIDER = 'ollama'
      process.env.OLLAMA_MODEL = 'llama3.1'

      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('Ollama test'))
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      await handleUpload({ filePath: '/tmp/ollama.txt', contentType: 'text/plain' })

      expect(OllamaEmbeddings).toHaveBeenCalledWith({ model: 'llama3.1' })
      expect(OpenAIEmbeddings).not.toHaveBeenCalled()
    })

    it('should default Ollama model to llama3 if OLLAMA_MODEL is not set', async () => {
      process.env.LLM_PROVIDER = 'ollama'
      delete process.env.OLLAMA_MODEL

      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('Ollama default test'))
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      await handleUpload({ filePath: '/tmp/ollama.txt', contentType: 'text/plain' })

      expect(OllamaEmbeddings).toHaveBeenCalledWith({ model: 'llama3' })
    })
  })

  describe('parseMultipart', () => {
    it('should parse form fields and files correctly', async () => {
      const mockWs = new EventEmitter() as any
      mockWs.path = '/tmp/storage/uploads/test.txt'
      vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWs)

      const fileStream = new EventEmitter() as any
      fileStream.pipe = vi.fn().mockImplementation((dest) => {
        setTimeout(() => {
          mockWs.emit('finish')
        }, 5)
        return dest
      })

      const req = {
        headers: { 'content-type': 'multipart/form-data; boundary=----boundary' },
        pipe: vi.fn().mockImplementation(() => {
          setTimeout(() => {
            mocks.busboyEmitter.emit('field', 'q', 'search query')
            mocks.busboyEmitter.emit('field', 'chatId', 'chat-123')
            mocks.busboyEmitter.emit('file', 'uploadedFile', fileStream, {
              filename: 'notes.txt',
              mimeType: 'text/plain',
            })
            mocks.busboyEmitter.emit('finish')
          }, 5)
        }),
      }

      const res = await parseMultipart(req)

      expect(res.q).toBe('search query')
      expect(res.chatId).toBe('chat-123')
      expect(res.files).toHaveLength(1)
      expect(res.files[0].filename).toBe('notes.txt')
      expect(res.files[0].mimeType).toBe('text/plain')
      expect(res.files[0].path).toMatch(/notes\.txt$/)
    })

    it('should reject when busboy encounters an error', async () => {
      const req = {
        headers: { 'content-type': 'multipart/form-data' },
        pipe: vi.fn().mockImplementation(() => {
          setTimeout(() => {
            mocks.busboyEmitter.emit('error', new Error('Busboy failed'))
          }, 5)
        }),
      }

      await expect(parseMultipart(req)).rejects.toThrow('Busboy failed')
    })

    it('should reject when file stream encounters an error', async () => {
      const mockWs = new EventEmitter() as any
      vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWs)

      const fileStream = new EventEmitter() as any
      fileStream.pipe = vi.fn()

      const req = {
        headers: { 'content-type': 'multipart/form-data' },
        pipe: vi.fn().mockImplementation(() => {
          setTimeout(() => {
            mocks.busboyEmitter.emit('file', 'file', fileStream, {
              filename: 'test.txt',
              mimeType: 'text/plain',
            })
            fileStream.emit('error', new Error('Stream read failed'))
          }, 5)
        }),
      }

      await expect(parseMultipart(req)).rejects.toThrow('Stream read failed')
    })

    it('should reject when write stream encounters an error', async () => {
      const mockWs = new EventEmitter() as any
      vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWs)

      const fileStream = new EventEmitter() as any
      fileStream.pipe = vi.fn()

      const req = {
        headers: { 'content-type': 'multipart/form-data' },
        pipe: vi.fn().mockImplementation(() => {
          setTimeout(() => {
            mocks.busboyEmitter.emit('file', 'file', fileStream, {
              filename: 'test.txt',
              mimeType: 'text/plain',
            })
            mockWs.emit('error', new Error('Write stream failed'))
          }, 5)
        }),
      }

      await expect(parseMultipart(req)).rejects.toThrow('Write stream failed')
    })
  })
})
