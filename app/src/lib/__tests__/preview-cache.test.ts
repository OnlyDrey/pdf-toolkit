import { describe, it, expect } from 'vitest'
import { ResourceCache, RenderQueue } from '../preview-cache'
describe('bounded preview resources', () => {
  it('evicts least-recently-used unleased resources and defers disposal of pinned entries', () => {
    const disposed: string[] = [],
      cache = new ResourceCache<string>(2, 10),
      dispose = (v: string) => disposed.push(v)
    const a = cache.put('a', 'A', 4, dispose)
    a.release()
    cache.put('b', 'B', 4, dispose).release()
    const touch = cache.acquire('a')!
    touch.release()
    cache.put('c', 'C', 4, dispose).release()
    expect(disposed).toEqual(['B'])
    expect(cache.stats).toEqual({ items: 2, bytes: 8 })
    const held = cache.acquire('a')!
    cache.invalidate((k) => k === 'a')
    expect(disposed).not.toContain('A')
    held.release()
    held.release()
    expect(disposed.filter((v) => v === 'A')).toHaveLength(1)
    cache.invalidate()
    expect(disposed).toContain('C')
    expect(cache.stats.bytes).toBe(0)
  })
  it('keeps cache budgets strict when every entry is pinned or a resource is oversized', () => {
    const disposed: string[] = [],
      cache = new ResourceCache<string>(1, 4),
      first = cache.put('a', 'a', 4, (v) => disposed.push(v)),
      second = cache.put('b', 'b', 8, (v) => disposed.push(v))
    expect(cache.stats).toEqual({ items: 1, bytes: 4 })
    expect(disposed).toEqual([])
    second.release()
    expect(disposed).toEqual(['b'])
    first.release()
    cache.invalidate()
    expect(disposed).toEqual(['b', 'a'])
  })
  it('bounds concurrent work and cancels queued tasks before execution', async () => {
    const queue = new RenderQueue(1),
      a = new AbortController(),
      b = new AbortController()
    let finish!: () => void,
      ran = false
    const first = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
      a.signal,
    )
    await Promise.resolve()
    const second = queue.enqueue(async () => {
      ran = true
    }, b.signal)
    b.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(queue.stats.active).toBe(1)
    finish()
    await first
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ran).toBe(false)
    expect(queue.stats).toEqual({ active: 0, waiting: 0 })
  })
})
