import { setTimeout as delay } from "node:timers/promises";

export interface ActivityEvent {
  type: string;
  data?: unknown;
}

export interface ActivitySource {
  snapshot(signal: AbortSignal): Promise<Readonly<Record<string, { type: string }>>>;
  subscribe(signal: AbortSignal): AsyncIterable<ActivityEvent>;
}

export interface ActivityOptions {
  pollMs: number;
  releaseDelayMs: number;
  snapshotTimeoutMs?: number;
}

/** Snapshots own releases. Start events can acquire early, but never renew stale state forever. */
export class ActivityMonitor {
  private readonly abort = new AbortController();
  private readonly tasks: Promise<void>[] = [];
  private sessions = new Set<string>();
  private revision = 0;
  private reading?: Promise<void>;
  private queued = false;
  private release?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private snapshotFailed = false;

  constructor(
    private readonly source: ActivitySource,
    private readonly publish: (active: boolean) => void,
    private readonly options: ActivityOptions,
    private readonly warn: (message: string) => void,
  ) {}

  start(): void {
    this.tasks.push(this.events());
    void this.refresh();
    this.tasks.push((async () => {
      try {
        while (!this.abort.signal.aborted) {
          await delay(this.options.pollMs, undefined, { signal: this.abort.signal });
          await this.refresh();
        }
      } catch (error) {
        if (!this.abort.signal.aborted) this.warn(`polling failed: ${String(error)}`);
      }
    })());
  }

  private cancelRelease(): void {
    if (this.release) clearTimeout(this.release);
    this.release = undefined;
  }

  private applySnapshot(snapshot: Readonly<Record<string, { type: string }>>): void {
    this.sessions = new Set(Object.entries(snapshot).filter(([, status]) => status.type === "running").map(([id]) => id));
    if (this.sessions.size) {
      this.cancelRelease();
      this.publish(true);
    } else if (!this.release) {
      this.release = setTimeout(() => {
        this.release = undefined;
        if (!this.stopped && this.sessions.size === 0) this.publish(false);
      }, this.options.releaseDelayMs);
      this.release.unref();
    }
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    if (this.reading) { this.queued = true; return this.reading; }
    this.reading = (async () => {
      do {
        this.queued = false;
        const revision = this.revision;
        try {
          const snapshot = await this.source.snapshot(AbortSignal.any([
            this.abort.signal, AbortSignal.timeout(this.options.snapshotTimeoutMs ?? 5_000),
          ]));
          if (this.stopped) return;
          this.snapshotFailed = false;
          if (revision !== this.revision) { this.queued = true; continue; }
          this.applySnapshot(snapshot);
        } catch (error) {
          if (!this.stopped && !this.snapshotFailed) {
            this.warn(`active-session snapshot unavailable; existing leases expire within 30s: ${String(error)}`);
            this.snapshotFailed = true;
          }
          // Do not renew a lease using an old snapshot.
        }
      } while (this.queued && !this.stopped);
    })();
    try { await this.reading; } finally { this.reading = undefined; }
  }

  handle(event: ActivityEvent): void {
    if (this.stopped) return;
    if (event.type === "server.connected") { void this.refresh(); return; }
    const relevant = event.type.startsWith("session.execution.") || event.type === "session.status" || event.type === "session.idle" || event.type === "session.deleted";
    if (!relevant) return;
    const data = event.data as { sessionID?: unknown; status?: { type?: unknown } } | undefined;
    this.revision++;
    const starting = event.type === "session.execution.started" ||
      (event.type === "session.status" && (data?.status?.type === "busy" || data?.status?.type === "retry"));
    if (starting && typeof data?.sessionID === "string" && !this.sessions.has(data.sessionID)) {
      this.sessions.add(data.sessionID);
      this.cancelRelease();
      this.publish(true);
    }
    // A terminal event can precede a child start. Reconcile the whole process before releasing.
    void this.refresh();
  }

  private async events(): Promise<void> {
    let backoff = 250;
    while (!this.abort.signal.aborted) {
      try {
        for await (const event of this.source.subscribe(this.abort.signal)) {
          backoff = 250;
          this.handle(event);
        }
        if (this.abort.signal.aborted) return;
        this.warn("event stream ended; reconnecting (snapshot polling remains active)");
      } catch (error) {
        if (this.abort.signal.aborted) return;
        this.warn(`event stream disconnected; reconnecting: ${String(error)}`);
      }
      try { await delay(backoff, undefined, { signal: this.abort.signal }); } catch { return; }
      backoff = Math.min(backoff * 2, 10_000);
      void this.refresh();
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelRelease();
    this.abort.abort();
    this.publish(false);
    await Promise.allSettled([...this.tasks, ...(this.reading ? [this.reading] : [])]);
  }
}
