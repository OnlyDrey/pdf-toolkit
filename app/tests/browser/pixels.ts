import type { Locator } from '@playwright/test'
export async function samplePreview(
  locator: Locator,
  points: [number, number][],
): Promise<number[][]> {
  return locator.evaluate((image: HTMLImageElement, positions) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const values = positions.map(([x, y]) =>
      Array.from(
        context.getImageData(
          Math.floor(canvas.width * x),
          Math.floor(canvas.height * y),
          1,
          1,
        ).data,
      ),
    )
    canvas.width = canvas.height = 0
    return values
  }, points)
}
