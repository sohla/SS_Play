export type OscMessage = [string, ...unknown[]]
export type ReplyHandler = (message: OscMessage) => void
export type Unsubscribe = () => void

/** The slice of SuperSonic the dispatcher needs, so it can be tested without one. */
export interface ReplySource {
  on(event: 'in', callback: (message: OscMessage) => void): Unsubscribe
}

export interface WaitOptions {
  /** Always bounded — a reply that never arrives must not hang a page forever. */
  timeoutMs?: number
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Address-routed OSC replies over a single `on('in')` subscription.
 *
 * SuperSonic has no promise-based request/response except `sync()`: `/done`,
 * `/fail`, `/n_end`, `/tr` and SendReply all arrive as bare `in` events. Every
 * consumer attaching its own listener would mean N listeners on a stream that
 * can run at audio rate, so this attaches exactly one and routes by address.
 */
export class Dispatcher {
  readonly #handlers = new Map<string, Set<ReplyHandler>>()
  #detach: Unsubscribe | null = null
  #disposed = false

  constructor(private readonly source: ReplySource) {}

  /** Live listener count, for leak assertions in tests and dev tooling. */
  get handlerCount(): number {
    let total = 0
    for (const handlers of this.#handlers.values()) total += handlers.size
    return total
  }

  get attached(): boolean {
    return this.#detach !== null
  }

  on(address: string, handler: ReplyHandler): Unsubscribe {
    if (this.#disposed) throw new Error('Dispatcher has been disposed')

    let handlers = this.#handlers.get(address)
    if (!handlers) {
      handlers = new Set()
      this.#handlers.set(address, handlers)
    }
    handlers.add(handler)

    // Attach lazily and detach when the last handler goes, so an idle page
    // costs nothing and a leak shows up as `attached` staying true.
    this.#detach ??= this.source.on('in', (message) => this.#deliver(message))

    let released = false
    return () => {
      if (released) return
      released = true
      handlers.delete(handler)
      if (handlers.size === 0) this.#handlers.delete(address)
      if (this.handlerCount === 0) this.#detachNow()
    }
  }

  once(address: string, handler: ReplyHandler): Unsubscribe {
    const release = this.on(address, (message) => {
      release()
      handler(message)
    })
    return release
  }

  /** Resolve on the next message at `address` that satisfies `match`. */
  wait(
    address: string,
    match: (message: OscMessage) => boolean = () => true,
    options: WaitOptions = {},
  ): Promise<OscMessage> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options

    return new Promise((resolve, reject) => {
      const cleanups: Unsubscribe[] = []
      const settle = (run: () => void) => {
        for (const cleanup of cleanups) cleanup()
        run()
      }

      cleanups.push(
        this.on(address, (message) => {
          if (match(message)) settle(() => resolve(message))
        }),
      )

      const timer = setTimeout(
        () =>
          settle(() =>
            reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${address}`)),
          ),
        timeoutMs,
      )
      cleanups.push(() => clearTimeout(timer))

      if (signal) {
        const onAbort = () => settle(() => reject(signal.reason ?? new Error('Aborted')))
        if (signal.aborted) onAbort()
        else {
          signal.addEventListener('abort', onAbort, { once: true })
          cleanups.push(() => signal.removeEventListener('abort', onAbort))
        }
      }
    })
  }

  /** Resolve on `/done <command>`, reject on `/fail <command> <reason>`. */
  waitForDone(command: string, options: WaitOptions = {}): Promise<OscMessage> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS } = options

    return new Promise((resolve, reject) => {
      const cleanups: Unsubscribe[] = []
      const settle = (run: () => void) => {
        for (const cleanup of cleanups) cleanup()
        run()
      }

      cleanups.push(
        this.on('/done', (message) => {
          if (message[1] === command) settle(() => resolve(message))
        }),
        this.on('/fail', (message) => {
          if (message[1] !== command) return
          const reason = typeof message[2] === 'string' ? message[2] : 'no reason given'
          settle(() => reject(new Error(`${command} failed: ${reason}`)))
        }),
      )

      const timer = setTimeout(
        () => settle(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${command}`))),
        timeoutMs,
      )
      cleanups.push(() => clearTimeout(timer))
    })
  }

  /**
   * Resolve when a node ends.
   *
   * This is the synchronisation primitive the audio tests are built on: without
   * it they fall back to sleeping, and sleep-based audio tests are the main
   * source of flakiness in this kind of suite.
   */
  waitForNodeEnd(nodeId: number, options: WaitOptions = {}): Promise<OscMessage> {
    return this.wait('/n_end', (message) => message[1] === nodeId, options)
  }

  /** `/tr` triggers and SendReply output, optionally filtered. */
  onTrigger(
    handler: (nodeId: number, triggerId: number, value: number) => void,
    filter: { nodeId?: number; triggerId?: number } = {},
  ): Unsubscribe {
    return this.on('/tr', (message) => {
      const [, nodeId, triggerId, value] = message as [string, number, number, number]
      if (filter.nodeId !== undefined && filter.nodeId !== nodeId) return
      if (filter.triggerId !== undefined && filter.triggerId !== triggerId) return
      handler(nodeId, triggerId, value)
    })
  }

  dispose(): void {
    this.#disposed = true
    this.#handlers.clear()
    this.#detachNow()
  }

  #detachNow() {
    this.#detach?.()
    this.#detach = null
  }

  #deliver(message: OscMessage) {
    const handlers = this.#handlers.get(message[0])
    if (!handlers) return
    // Copy first: a handler that unsubscribes itself would otherwise mutate the
    // set mid-iteration.
    for (const handler of [...handlers]) handler(message)
  }
}

export interface NotifySender {
  send(address: '/notify', flag: 0 | 1): void
}

/**
 * Register this client for node lifecycle replies.
 *
 * scsynth sends `/n_go`, `/n_end`, `/n_on`, `/n_off` and `/n_move` only to
 * clients that asked for them, and **SuperSonic does not ask**. Without this,
 * `waitForNodeEnd` never resolves — synths play correctly and nothing reports
 * that they finished, which pushes anything waiting on a node back onto sleeps.
 *
 * Call it once after boot, before anything waits on a node.
 */
export async function enableNodeNotifications(
  sender: NotifySender,
  dispatcher: Dispatcher,
  options: WaitOptions = {},
): Promise<void> {
  // Register the waiter before sending, or a fast reply arrives unheard.
  const acknowledged = dispatcher.waitForDone('/notify', options)
  sender.send('/notify', 1)
  await acknowledged
}
