import { loadPdf } from './pdf-document'
export interface OperationToken {
  readonly id: number
  readonly revision: number
  readonly kind: string
}
export interface DocumentSnapshot {
  readonly id: number
  readonly bytes: Uint8Array
  readonly name: string
  readonly pageIds: string[]
  readonly selectedIds: string[]
  readonly kind: string
  readonly dirty: boolean
}
export interface WorkingDocument {
  readonly id: number
  readonly revision: number
  readonly bytes: Uint8Array
  readonly file: File
  readonly name: string
  readonly pageIds: string[]
  readonly pageCount: number
  readonly dirty: boolean
}
export interface DocumentState {
  snapshot: DocumentSnapshot | null
  session: WorkingDocument | null
  past: (DocumentSnapshot | null)[]
  future: (DocumentSnapshot | null)[]
  revision: number
  busy: OperationToken | null
  discarded: number
}
export interface CommitOptions {
  pageIds?: string[]
  selectAll?: boolean
  saved?: boolean
  sourceFile?: File
  replace?: boolean
}
export class DocumentOperationError extends Error {
  constructor(public code: 'stale' | 'selection' | 'empty' | 'busy') {
    super(code)
  }
}
/** Committed byte arrays are immutable by ownership, shared with checkpoints.
 * History never stores File copies and never replays lossy inverse operations. */
export class DocumentStore {
  readonly maxSteps: number
  readonly maxBytes: number
  private serial = 0
  private pageSerial = 0
  private state: DocumentState = {
    snapshot: null,
    session: null,
    past: [],
    future: [],
    revision: 0,
    busy: null,
    discarded: 0,
  }
  private listeners = new Set<() => void>()
  constructor({
    maxSteps = 20,
    maxBytes = 128 * 1024 ** 2,
  }: { maxSteps?: number; maxBytes?: number } = {}) {
    this.maxSteps = maxSteps
    this.maxBytes = maxBytes
  }
  getState = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(update: Partial<DocumentState>) {
    this.state = { ...this.state, ...update }
    this.listeners.forEach((listener) => listener())
  }
  begin = (kind: string): OperationToken | null => {
    if (this.state.busy) return null
    const token = { id: ++this.serial, revision: this.state.revision, kind }
    this.publish({ busy: token })
    return token
  }
  end = (token: OperationToken) => {
    if (this.state.busy === token) this.publish({ busy: null })
  }
  private assert(token: OperationToken) {
    if (this.state.busy !== token || token.revision !== this.state.revision)
      throw new DocumentOperationError('stale')
  }
  private live(
    snapshot: DocumentSnapshot | null,
    revision: number,
    sourceFile?: File,
  ): WorkingDocument | null {
    if (!snapshot) return null
    return {
      id: snapshot.id,
      revision,
      bytes: snapshot.bytes,
      name: snapshot.name,
      pageIds: snapshot.pageIds,
      pageCount: snapshot.pageIds.length,
      dirty: snapshot.dirty,
      file:
        sourceFile ??
        new File([snapshot.bytes as Uint8Array<ArrayBuffer>], snapshot.name, {
          type: 'application/pdf',
        }),
    }
  }
  historyBytes(
    past = this.state.past,
    future = this.state.future,
    current = this.state.snapshot,
  ) {
    const seen = new Set<ArrayBufferLike>(current ? [current.bytes.buffer] : [])
    let bytes = 0
    for (const snapshot of [...past, ...future])
      if (snapshot && !seen.has(snapshot.bytes.buffer)) {
        seen.add(snapshot.bytes.buffer)
        bytes += snapshot.bytes.buffer.byteLength
      }
    return bytes
  }
  private trim(
    past: (DocumentSnapshot | null)[],
    future: (DocumentSnapshot | null)[],
    current: DocumentSnapshot | null,
  ) {
    let discarded = this.state.discarded
    while (
      past.length + future.length > this.maxSteps ||
      this.historyBytes(past, future, current) > this.maxBytes
    ) {
      if (past.length) past.shift()
      else if (future.length) future.shift()
      else break
      discarded++
    }
    return { past, future, discarded }
  }
  commit = async (
    token: OperationToken,
    bytes: Uint8Array,
    name: string,
    options: CommitOptions = {},
  ): Promise<WorkingDocument> => {
    this.assert(token)
    const doc = await loadPdf(bytes)
    this.assert(token)
    const before = this.state.snapshot,
      count = doc.getPageCount()
    const preserve =
      before &&
      !options.replace &&
      !['open', 'images', 'merge', 'extract'].includes(token.kind) &&
      before.pageIds.length === count
    const pageIds =
      options.pageIds?.slice() ??
      (preserve
        ? before!.pageIds.slice()
        : Array.from({ length: count }, () => `page-${++this.pageSerial}`))
    if (
      pageIds.length !== count ||
      new Set(pageIds).size !== count ||
      pageIds.some((id) => !id)
    )
      throw new DocumentOperationError('selection')
    const selectedIds = options.selectAll
      ? pageIds.slice()
      : (before?.selectedIds ?? []).filter((id) => pageIds.includes(id))
    const snapshot: DocumentSnapshot = {
      id: ++this.serial,
      bytes,
      name,
      pageIds,
      selectedIds,
      kind: token.kind,
      dirty: !options.saved,
    }
    const revision = this.state.revision + 1,
      session = this.live(snapshot, revision, options.sourceFile)!
    const history = this.trim([...this.state.past, before], [], snapshot)
    this.publish({ ...history, snapshot, session, revision })
    return session
  }
  select = (ids: string[]) => {
    const snapshot = this.state.snapshot
    if (!snapshot || this.state.busy) return
    const valid = Array.from(new Set(ids)).filter((id) =>
      snapshot.pageIds.includes(id),
    )
    this.publish({ snapshot: { ...snapshot, selectedIds: valid } })
  }
  save = () => {
    if (!this.state.snapshot || this.state.busy) return
    const snapshot = { ...this.state.snapshot, dirty: false }
    this.publish({
      snapshot,
      session: { ...this.state.session!, dirty: false },
    })
  }
  clear = () => {
    this.publish({
      snapshot: null,
      session: null,
      past: [],
      future: [],
      revision: this.state.revision + 1,
      discarded: 0,
    })
  }
  undo = () => this.move('undo')
  redo = () => this.move('redo')
  private move(direction: 'undo' | 'redo') {
    if (this.state.busy) return false
    const undo = direction === 'undo',
      source = (undo ? this.state.past : this.state.future).slice()
    if (!source.length) return false
    const snapshot = source.pop()!,
      past = undo ? source : [...this.state.past, this.state.snapshot],
      future = undo ? [...this.state.future, this.state.snapshot] : source,
      revision = this.state.revision + 1
    const session = this.live(snapshot, revision),
      history = this.trim(past, future, snapshot)
    this.publish({ ...history, snapshot, session, revision })
    return true
  }
  dispose() {
    this.listeners.clear()
  }
}
