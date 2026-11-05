import type { RasterCodec } from './pdf-compress'

// Browser-native decoding keeps everything local. Every call allocates one image at a time
// and releases bitmap and canvas before returning.
function canvasFor(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}
function jpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Uint8Array | null>((resolve) =>
    canvas.toBlob(
      async (blob) =>
        resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null),
      'image/jpeg',
      quality,
    ),
  )
}
function drawOpaque(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  target: { width: number; height: number },
) {
  const context = canvas.getContext('2d')
  if (!context) return false
  context.fillStyle = '#fff'
  context.fillRect(0, 0, target.width, target.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, target.width, target.height)
  return true
}
function toImageData(
  pixels: Uint8Array,
  components: 1 | 3,
  size: { width: number; height: number },
) {
  const rgba = new Uint8ClampedArray(size.width * size.height * 4)
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += components) {
    rgba[i] = pixels[p]
    rgba[i + 1] = components === 3 ? pixels[p + 1] : pixels[p]
    rgba[i + 2] = components === 3 ? pixels[p + 2] : pixels[p]
    rgba[i + 3] = 255
  }
  return new ImageData(rgba, size.width, size.height)
}

export const browserCodec: RasterCodec = {
  async toJpeg(source, size, target, quality) {
    let bitmap: ImageBitmap | undefined
    const canvas = canvasFor(target.width, target.height)
    try {
      bitmap =
        source.kind === 'jpeg'
          ? await createImageBitmap(
              new Blob([source.bytes as BlobPart], { type: 'image/jpeg' }),
              { imageOrientation: 'none' },
            )
          : await createImageBitmap(
              toImageData(source.pixels, source.components, size),
            )
      if (bitmap.width !== size.width || bitmap.height !== size.height)
        return null
      return drawOpaque(canvas, bitmap, target)
        ? await jpegBlob(canvas, quality)
        : null
    } catch {
      return null
    } finally {
      bitmap?.close()
      canvas.width = canvas.height = 0
    }
  },
  async scaleRaw(pixels, components, size, target) {
    let bitmap: ImageBitmap | undefined
    const canvas = canvasFor(target.width, target.height)
    try {
      bitmap = await createImageBitmap(toImageData(pixels, components, size))
      if (!drawOpaque(canvas, bitmap, target)) return null
      const data = canvas
        .getContext('2d')!
        .getImageData(0, 0, target.width, target.height).data
      const out = new Uint8Array(target.width * target.height * components)
      for (let i = 0, p = 0; i < data.length; i += 4, p += components) {
        out[p] = data[i]
        if (components === 3) {
          out[p + 1] = data[i + 1]
          out[p + 2] = data[i + 2]
        }
      }
      return out
    } catch {
      return null
    } finally {
      bitmap?.close()
      canvas.width = canvas.height = 0
    }
  },
}
