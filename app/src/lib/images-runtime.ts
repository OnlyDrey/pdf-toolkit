export * from './images-to-pdf'
import { ImageInputError } from './image-errors'
import {
  prepareImage as prepareLocal,
  imagesToPdf as convertLocal,
  releasePreparedImage,
  type ImageEntry,
  type ImagePdfOptions,
} from './images-to-pdf'
import {
  imageWorkerAvailable,
  imageWorkerRequest,
  releaseImageResource,
} from './image-worker-client'
let next = 0
export async function prepareImage(file: File): Promise<ImageEntry> {
  if (!imageWorkerAvailable()) return prepareLocal(file)
  const id = `image-worker-${++next}`,
    result = await imageWorkerRequest('prepare', { file, key: id })
  try {
    return {
      ...result.info,
      id,
      file,
      thumbnail: result.thumbnail
        ? URL.createObjectURL(result.thumbnail)
        : undefined,
    }
  } catch {
    releaseImageResource({ id, file })
    throw new ImageInputError('resource')
  }
}
export async function imagesToPdf(
  entries: ImageEntry[],
  options: ImagePdfOptions,
  progress: (done: number, total: number) => void,
) {
  return imageWorkerAvailable()
    ? imageWorkerRequest('convert', { entries, options }, progress)
    : convertLocal(entries, options, progress)
}
export function releaseImage(entry: ImageEntry) {
  releaseImageResource(entry)
  releasePreparedImage(entry.id)
}
