export type PaperSizeCategory = 'ISO-A' | 'ISO-B' | 'ISO-C' | 'US'
export interface PaperSize {
  id: string
  name: string
  category: PaperSizeCategory
  widthPt: number
  heightPt: number
  widthMm: number
  heightMm: number
}
const MM_TO_PT = 2.8346
function mm(
  w: number,
  h: number,
  id: string,
  name: string,
  cat: PaperSizeCategory,
): PaperSize {
  return {
    id,
    name,
    category: cat,
    widthPt: Math.round(w * MM_TO_PT * 100) / 100,
    heightPt: Math.round(h * MM_TO_PT * 100) / 100,
    widthMm: w,
    heightMm: h,
  }
}
function pt(
  w: number,
  h: number,
  id: string,
  name: string,
  cat: PaperSizeCategory,
): PaperSize {
  return {
    id,
    name,
    category: cat,
    widthPt: w,
    heightPt: h,
    widthMm: Math.round((w / MM_TO_PT) * 10) / 10,
    heightMm: Math.round((h / MM_TO_PT) * 10) / 10,
  }
}
export const paperSizes: PaperSize[] = [
  mm(841, 1189, 'a0', 'A0', 'ISO-A'),
  mm(594, 841, 'a1', 'A1', 'ISO-A'),
  mm(420, 594, 'a2', 'A2', 'ISO-A'),
  mm(297, 420, 'a3', 'A3', 'ISO-A'),
  mm(210, 297, 'a4', 'A4', 'ISO-A'),
  mm(148, 210, 'a5', 'A5', 'ISO-A'),
  mm(105, 148, 'a6', 'A6', 'ISO-A'),
  mm(1000, 1414, 'b0', 'B0', 'ISO-B'),
  mm(707, 1000, 'b1', 'B1', 'ISO-B'),
  mm(500, 707, 'b2', 'B2', 'ISO-B'),
  mm(353, 500, 'b3', 'B3', 'ISO-B'),
  mm(250, 353, 'b4', 'B4', 'ISO-B'),
  mm(176, 250, 'b5', 'B5', 'ISO-B'),
  mm(125, 176, 'b6', 'B6', 'ISO-B'),
  mm(917, 1297, 'c0', 'C0', 'ISO-C'),
  mm(648, 917, 'c1', 'C1', 'ISO-C'),
  mm(458, 648, 'c2', 'C2', 'ISO-C'),
  mm(324, 458, 'c3', 'C3', 'ISO-C'),
  mm(229, 324, 'c4', 'C4', 'ISO-C'),
  mm(162, 229, 'c5', 'C5', 'ISO-C'),
  mm(114, 162, 'c6', 'C6', 'ISO-C'),
  pt(612, 792, 'letter', 'Letter', 'US'),
  pt(612, 1008, 'legal', 'Legal', 'US'),
  pt(792, 1224, 'tabloid', 'Tabloid', 'US'),
  pt(522, 756, 'executive', 'Executive', 'US'),
  pt(396, 612, 'statement', 'Statement', 'US'),
  pt(612, 936, 'folio', 'Folio', 'US'),
]
export const paperSizesByCategory: Record<PaperSizeCategory, PaperSize[]> = {
  'ISO-A': paperSizes.filter((s) => s.category === 'ISO-A'),
  'ISO-B': paperSizes.filter((s) => s.category === 'ISO-B'),
  'ISO-C': paperSizes.filter((s) => s.category === 'ISO-C'),
  US: paperSizes.filter((s) => s.category === 'US'),
}
export function getPaperSize(id: string): PaperSize | undefined {
  return paperSizes.find((s) => s.id === id)
}
