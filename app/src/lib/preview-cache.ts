export interface ResourceLease<T> {
  value: T
  release: () => void
}
interface Entry<T> {
  value: T
  bytes: number
  refs: number
  dispose: (value: T) => void
  removed: boolean
}
/** Only unleased entries are evicted. Oversized or fully pinned additions are transient. */
export class ResourceCache<T> {
  private entries = new Map<string, Entry<T>>()
  private used = 0
  constructor(
    public readonly maxItems = 64,
    public readonly maxBytes = 24 * 1024 ** 2,
  ) {}
  private lease(entry: Entry<T>): ResourceLease<T> {
    entry.refs++
    let released = false
    return {
      value: entry.value,
      release: () => {
        if (released) return
        released = true
        entry.refs--
        if (!entry.refs && entry.removed) entry.dispose(entry.value)
      },
    }
  }
  acquire(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.entries.set(key, entry)
    return this.lease(entry)
  }
  put(key: string, value: T, bytes: number, dispose: (value: T) => void) {
    this.invalidate((k) => k === key)
    const entry: Entry<T> = { value, bytes, dispose, refs: 0, removed: false }
    while (
      this.entries.size >= this.maxItems ||
      this.used + bytes > this.maxBytes
    ) {
      const victim = Array.from(this.entries).find(([, e]) => !e.refs)
      if (!victim) break
      this.remove(victim[0], victim[1])
    }
    if (
      bytes > this.maxBytes ||
      this.entries.size >= this.maxItems ||
      this.used + bytes > this.maxBytes
    )
      entry.removed = true
    else {
      this.entries.set(key, entry)
      this.used += bytes
    }
    return this.lease(entry)
  }
  private remove(key: string, entry: Entry<T>) {
    this.entries.delete(key)
    this.used -= entry.bytes
    entry.removed = true
    if (!entry.refs) entry.dispose(entry.value)
  }
  invalidate(predicate: (key: string) => boolean = () => true) {
    for (const [key, entry] of this.entries)
      if (predicate(key)) this.remove(key, entry)
  }
  get stats() {
    return { items: this.entries.size, bytes: this.used }
  }
}
export class RenderQueue {
  private active = 0
  private waiting: {
    run: () => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
    signal: AbortSignal
    abort: () => void
  }[] = []
  constructor(public readonly concurrency = 2) {}
  enqueue<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Cancelled', 'AbortError'))
        return
      }
      const task = {
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
        abort: () => {
          this.waiting = this.waiting.filter((t) => t !== task)
          reject(new DOMException('Cancelled', 'AbortError'))
        },
      }
      signal.addEventListener('abort', task.abort, { once: true })
      this.waiting.push(task)
      this.drain()
    })
  }
  private drain() {
    while (this.active < this.concurrency && this.waiting.length) {
      const task = this.waiting.shift()!
      task.signal.removeEventListener('abort', task.abort)
      if (task.signal.aborted) {
        task.reject(new DOMException('Cancelled', 'AbortError'))
        continue
      }
      this.active++
      Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active--
          this.drain()
        })
    }
  }
  get stats() {
    return { active: this.active, waiting: this.waiting.length }
  }
}
