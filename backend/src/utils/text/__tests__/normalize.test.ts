import { describe, it, expect } from 'vitest'
import { normalizeTopic } from '../normalize'

describe('normalizeTopic', () => {
  describe('nullish inputs', () => {
    it('should return empty string for null', () => {
      expect(normalizeTopic(null)).toBe('')
    })

    it('should return empty string for undefined', () => {
      expect(normalizeTopic(undefined)).toBe('')
    })
  })

  describe('string inputs', () => {
    it('should return trimmed string when given regular string', () => {
      expect(normalizeTopic('hello world')).toBe('hello world')
      expect(normalizeTopic('  hello world  ')).toBe('hello world')
      expect(normalizeTopic('\n\t  quantum physics \t\n')).toBe('quantum physics')
    })

    it('should return empty string when given empty or whitespace-only string', () => {
      expect(normalizeTopic('')).toBe('')
      expect(normalizeTopic('   ')).toBe('')
      expect(normalizeTopic('\t\n  ')).toBe('')
    })
  })

  describe('object inputs with candidate fields', () => {
    it('should extract and trim topic property', () => {
      expect(normalizeTopic({ topic: 'Machine Learning' })).toBe('Machine Learning')
      expect(normalizeTopic({ topic: '  Machine Learning  ' })).toBe('Machine Learning')
    })

    it('should extract candidate keys in order of precedence', () => {
      // Precedence: topic > title > question > query > q > text
      expect(
        normalizeTopic({
          topic: 'chosen topic',
          title: 'ignored title',
          question: 'ignored question',
        }),
      ).toBe('chosen topic')

      expect(
        normalizeTopic({
          title: 'chosen title',
          question: 'ignored question',
          query: 'ignored query',
        }),
      ).toBe('chosen title')

      expect(
        normalizeTopic({
          question: 'chosen question',
          query: 'ignored query',
          q: 'ignored q',
        }),
      ).toBe('chosen question')

      expect(
        normalizeTopic({
          query: 'chosen query',
          q: 'ignored q',
          text: 'ignored text',
        }),
      ).toBe('chosen query')

      expect(
        normalizeTopic({
          q: 'chosen q',
          text: 'ignored text',
        }),
      ).toBe('chosen q')

      expect(
        normalizeTopic({
          text: 'chosen text',
        }),
      ).toBe('chosen text')
    })

    it('should fallback to JSON stringify when candidate value is whitespace or empty', () => {
      const obj = { topic: '   ' }
      expect(normalizeTopic(obj)).toBe(JSON.stringify(obj))
    })

    it('should fallback to JSON stringify when candidate value is not a string', () => {
      const obj = { topic: 12345 }
      expect(normalizeTopic(obj)).toBe(JSON.stringify(obj))
    })

    it('should not fallback across candidates if earlier candidate is nullish or empty', () => {
      // In normalizeTopic:
      // const cand = input.topic ?? input.title ?? ... ?? null
      // if topic is null / undefined, it uses title
      expect(normalizeTopic({ topic: null, title: 'from title' })).toBe('from title')
      expect(normalizeTopic({ topic: undefined, title: 'from title' })).toBe('from title')

      // Note: If topic is an empty string "", ?? does not coalesce because "" is not nullish.
      // Thus cand is "", typeof cand === "string" && cand.trim() is false, and it falls through to JSON.stringify!
      const obj = { topic: '', title: 'from title' }
      expect(normalizeTopic(obj)).toBe(JSON.stringify(obj))
    })
  })

  describe('object inputs without candidate fields', () => {
    it('should serialize object to JSON string', () => {
      const obj = { a: 1, b: 'two' }
      expect(normalizeTopic(obj)).toBe(JSON.stringify(obj))
    })

    it('should truncate serialized JSON if it exceeds 4000 characters', () => {
      const longString = 'a'.repeat(5000)
      const obj = { long: longString }
      const result = normalizeTopic(obj)

      expect(result.length).toBe(4000)
      expect(result).toBe(JSON.stringify(obj).slice(0, 4000))
    })

    it('should not truncate serialized JSON if it is exactly 4000 characters or less', () => {
      // Create an object whose JSON.stringify length is <= 4000
      const obj = { data: 'x'.repeat(100) }
      const serialized = JSON.stringify(obj)
      expect(normalizeTopic(obj)).toBe(serialized)
      expect(normalizeTopic(obj).length).toBeLessThan(4000)
    })

    it('should fallback to String(input) if JSON.stringify throws (e.g. circular reference)', () => {
      const circular: any = {}
      circular.self = circular

      expect(normalizeTopic(circular)).toBe('[object Object]')
    })

    it('should handle circular reference with custom toString', () => {
      const circular: any = {
        toString() {
          return 'custom-string-representation'
        },
      }
      circular.self = circular

      expect(normalizeTopic(circular)).toBe('custom-string-representation')
    })
  })

  describe('primitive inputs (numbers, booleans, etc.)', () => {
    it('should convert numbers to string', () => {
      expect(normalizeTopic(123)).toBe('123')
      expect(normalizeTopic(0)).toBe('0')
      expect(normalizeTopic(-42.5)).toBe('-42.5')
      expect(normalizeTopic(NaN)).toBe('NaN')
      expect(normalizeTopic(Infinity)).toBe('Infinity')
    })

    it('should convert booleans to string', () => {
      expect(normalizeTopic(true)).toBe('true')
      expect(normalizeTopic(false)).toBe('false')
    })

    it('should convert BigInt to string', () => {
      expect(normalizeTopic(BigInt(12345))).toBe('12345')
    })
  })
})
