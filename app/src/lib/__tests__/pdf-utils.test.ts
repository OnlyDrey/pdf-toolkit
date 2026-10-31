import { describe, it, expect } from 'vitest'
import { formatFileSize, parsePageRange } from '../pdf-utils'

describe('formatFileSize', () => {
  it('formats 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 KB')
  })
  it('formats KB', () => {
    expect(formatFileSize(102400)).toBe('100 KB')
  })
  it('formats at 1MB boundary', () => {
    expect(formatFileSize(1_048_576)).toBe('1.0 MB')
  })
  it('formats MB', () => {
    expect(formatFileSize(5_242_880)).toBe('5.0 MB')
  })
})

describe('parsePageRange', () => {
  const T = 10
  it('single page', () => {
    expect(parsePageRange('1', T)).toEqual([0])
  })
  it('comma list', () => {
    expect(parsePageRange('1,3,5', T)).toEqual([0, 2, 4])
  })
  it('range', () => {
    expect(parsePageRange('2-5', T)).toEqual([1, 2, 3, 4])
  })
  it('mixed', () => {
    expect(parsePageRange('1,3,5-8', T)).toEqual([0, 2, 4, 5, 6, 7])
  })
  it('deduplicates', () => {
    expect(parsePageRange('1,1,2', T)).toEqual([0, 1])
  })
  it('throws on empty', () => {
    expect(() => parsePageRange('', T)).toThrow()
  })
  it('throws on page 0', () => {
    expect(() => parsePageRange('0', T)).toThrow(/out of range/)
  })
  it('throws on out-of-range', () => {
    expect(() => parsePageRange('11', T)).toThrow(/out of range/)
  })
  it('throws on reversed range', () => {
    expect(() => parsePageRange('5-3', T)).toThrow(/start must be less/)
  })
  it('throws on invalid segment', () => {
    expect(() => parsePageRange('a', T)).toThrow(/Invalid page range/)
  })
})
