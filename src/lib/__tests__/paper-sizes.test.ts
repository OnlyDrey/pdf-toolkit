import { describe, it, expect } from 'vitest'
import { paperSizes, paperSizesByCategory, getPaperSize } from '../paper-sizes'

describe('paperSizes', () => {
  it('has at least 27 entries', () => { expect(paperSizes.length).toBeGreaterThanOrEqual(27) })
  it('all widthPt > 0', () => { paperSizes.forEach((s) => expect(s.widthPt).toBeGreaterThan(0)) })
  it('all ids unique', () => { expect(new Set(paperSizes.map((s)=>s.id)).size).toBe(paperSizes.length) })
})
describe('A series', () => {
  it('A4 ~595x842 pt', () => { const a4=getPaperSize('a4')!; expect(a4.widthPt).toBeCloseTo(595,0); expect(a4.heightPt).toBeCloseTo(842,0) })
  it('A4 is 210x297 mm', () => { const a4=getPaperSize('a4')!; expect(a4.widthMm).toBe(210); expect(a4.heightMm).toBe(297) })
  it('A0 > A4', () => { const a0=getPaperSize('a0')!, a4=getPaperSize('a4')!; expect(a0.widthPt*a0.heightPt).toBeGreaterThan(a4.widthPt*a4.heightPt) })
  it('A0-A6 all exist', () => { ['a0','a1','a2','a3','a4','a5','a6'].forEach((id)=>expect(getPaperSize(id)).toBeDefined()) })
})
describe('US sizes', () => {
  it('Letter is 612x792 pt', () => { const l=getPaperSize('letter')!; expect(l.widthPt).toBe(612); expect(l.heightPt).toBe(792) })
})
describe('paperSizesByCategory', () => {
  it('ISO-A has 7 entries', () => { expect(paperSizesByCategory['ISO-A'].length).toBe(7) })
  it('totals match', () => { expect(Object.values(paperSizesByCategory).reduce((s,a)=>s+a.length,0)).toBe(paperSizes.length) })
})