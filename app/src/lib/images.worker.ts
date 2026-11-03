import {
  prepareImageData,
  createImagePreview,
  convertImages,
  releasePreparedImage,
} from './images-to-pdf'
import { ImageInputError } from './image-errors'
let chain = Promise.resolve()
self.onmessage = ({ data }) => {
  if (data.action === 'release') {
    releasePreparedImage(data.payload.key)
    return
  }
  chain = chain.then(async () => {
    try {
      const result =
        data.action === 'prepare'
          ? await prepareImageData(data.payload.file, data.payload.key)
          : data.action === 'preview'
            ? await createImagePreview(data.payload.file, data.payload.edge)
            : await convertImages(
                data.payload.entries,
                data.payload.options,
                (done, total) =>
                  self.postMessage({ id: data.id, progress: [done, total] }),
              )
      if (result instanceof Uint8Array)
        self.postMessage({ id: data.id, result }, { transfer: [result.buffer] })
      else self.postMessage({ id: data.id, result })
    } catch (error) {
      self.postMessage({
        id: data.id,
        error:
          error instanceof ImageInputError
            ? error.code
            : error instanceof RangeError
              ? 'resource'
              : 'processing',
      })
    }
  })
}
