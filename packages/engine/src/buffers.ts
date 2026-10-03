/**
 * Buffer-number allocator.
 *
 * SuperSonic validates `bufnum` against `numBuffers` but never allocates one —
 * the caller picks. With a default ceiling of 1024 and samples loaded from
 * several places in a page, picking by hand collides sooner than you would
 * think, and a collision overwrites a loaded sample rather than erroring.
 */
export class BufAllocator {
  readonly #used = new Set<number>()
  readonly capacity: number

  constructor(capacity = 1024) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`Buffer capacity must be a positive integer, got ${capacity}`)
    }
    this.capacity = capacity
  }

  get usedCount(): number {
    return this.#used.size
  }

  get freeCount(): number {
    return this.capacity - this.#used.size
  }

  used(): number[] {
    return [...this.#used].sort((a, b) => a - b)
  }

  isUsed(bufnum: number): boolean {
    return this.#used.has(bufnum)
  }

  /** Claim the lowest free number. */
  alloc(): number {
    for (let bufnum = 0; bufnum < this.capacity; bufnum++) {
      if (!this.#used.has(bufnum)) {
        this.#used.add(bufnum)
        return bufnum
      }
    }
    throw new RangeError(`No free buffer: all ${this.capacity} are in use`)
  }

  /**
   * Claim `count` consecutive numbers, for a multichannel load that needs its
   * buffers adjacent.
   */
  allocContiguous(count: number): number[] {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError(`Contiguous count must be a positive integer, got ${count}`)
    }

    for (let start = 0; start + count <= this.capacity; start++) {
      let free = true
      for (let offset = 0; offset < count; offset++) {
        if (this.#used.has(start + offset)) {
          // Skip the whole blocked span rather than retrying each offset.
          start += offset
          free = false
          break
        }
      }
      if (!free) continue

      const claimed: number[] = []
      for (let offset = 0; offset < count; offset++) {
        this.#used.add(start + offset)
        claimed.push(start + offset)
      }
      return claimed
    }

    throw new RangeError(
      `No run of ${count} consecutive free buffers in ${this.capacity} ` +
        `(${this.freeCount} free, but fragmented)`,
    )
  }

  /** Claim a specific number, for a page that hardcodes one. */
  reserve(bufnum: number): number {
    this.#assertInRange(bufnum)
    if (this.#used.has(bufnum)) throw new Error(`Buffer ${bufnum} is already allocated`)
    this.#used.add(bufnum)
    return bufnum
  }

  free(bufnum: number): void {
    this.#assertInRange(bufnum)
    if (!this.#used.has(bufnum)) {
      // Loud, because a double free usually means two owners think they hold
      // the same buffer, and the next alloc would hand it to a third.
      throw new Error(`Buffer ${bufnum} is not allocated`)
    }
    this.#used.delete(bufnum)
  }

  freeAll(): void {
    this.#used.clear()
  }

  #assertInRange(bufnum: number) {
    if (!Number.isInteger(bufnum) || bufnum < 0 || bufnum >= this.capacity) {
      throw new RangeError(`Buffer number ${bufnum} is outside 0..${this.capacity - 1}`)
    }
  }
}
