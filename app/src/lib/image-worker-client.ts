import { ImageInputError } from './image-errors'
import type {
  ImageEntry,
  PreparedImageData,
  ImagePdfOptions,
} from './images-to-pdf'
type Reply = {
  id: number
  error?: ImageInputError['code']
  result?: PreparedImageData | Uint8Array
  progress?: [number, number]
}
let worker: Worker | undefined,
  next = 0
const pending = new Map<
  number,
  {
    resolve: (value: PreparedImageData | Uint8Array) => void
    reject: (error: ImageInputError) => void
    progress?: (done: number, total: number) => void
  }
>()
export function imageWorkerAvailable() {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined'
}
export function imageWorkerRequest(
  action: 'prepare',
  payload: { file: File; key: string },
): Promise<PreparedImageData>
export function imageWorkerRequest(
  action: 'convert',
  payload: { entries: ImageEntry[]; options: ImagePdfOptions },
  progress: (done: number, total: number) => void,
): Promise<Uint8Array>
export function imageWorkerRequest(
  action: 'prepare' | 'convert',
  payload: unknown,
  progress?: (done: number, total: number) => void,
): Promise<PreparedImageData | Uint8Array> {
  if (!worker) {
    worker = new Worker(new URL('./images.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = ({ data }: { data: Reply }) => {
      const request = pending.get(data.id)
      if (!request) return
      if (data.progress) {
        request.progress?.(...data.progress)
        return
      }
      pending.delete(data.id)
      if (data.error) request.reject(new ImageInputError(data.error))
      else request.resolve(data.result!)
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = undefined
      for (const request of pending.values())
        request.reject(new ImageInputError('resource'))
      pending.clear()
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++next
    pending.set(id, { resolve, reject, progress })
    try {
      worker!.postMessage({ id, action, payload })
    } catch {
      pending.delete(id)
      reject(new ImageInputError('resource'))
    }
  })
}
export function releaseImageResource(
  entry: Pick<ImageEntry, 'id' | 'thumbnail' | 'file'>,
) {
  if (entry.thumbnail) URL.revokeObjectURL(entry.thumbnail)
  worker?.postMessage({ action: 'release', payload: { key: entry.id } })
  // Main-thread fallback cache is weakly keyed by File and dies with the queue.
}
