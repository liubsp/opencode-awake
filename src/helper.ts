import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";

export const LEASE_MS = 30_000;
type Log = (message: string) => void;

export function defaultHelperPath(): string {
  const extension = process.platform === "win32" ? ".exe" : "";
  return fileURLToPath(new URL(`../bin/opencode-awake-${process.platform}-${process.arch}${extension}`, import.meta.url));
}

export class HelperClient {
  private readonly owners = new Map<string, number>();
  private child?: ChildProcessWithoutNullStreams;
  private ready = false;
  private blocked = false;
  private closing = false;
  private retryAt = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly path: string, private readonly log: Log, private readonly debug: Log) {
    accessSync(path, constants.X_OK);
    this.timer = setInterval(() => this.reconcile(), 1_000);
    this.timer.unref();
  }

  update(owner: string, active: boolean): void {
    if (this.closing) return;
    if (active) this.owners.set(owner, performance.now() + LEASE_MS);
    else this.owners.delete(owner);
    this.send(owner);
    this.reconcile();
  }

  private send(owner: string): void {
    if (!this.child || !this.ready || this.blocked) return;
    const ttl = Math.max(0, Math.min(LEASE_MS, Math.ceil((this.owners.get(owner) ?? 0) - performance.now())));
    this.blocked = !this.child.stdin.write(JSON.stringify({ owner, active: ttl > 0, ttl_ms: ttl }) + "\n");
  }

  private reconcile(): void {
    if (this.closing) return;
    for (const [owner, deadline] of this.owners) {
      if (deadline <= performance.now()) {
        this.owners.delete(owner);
        this.send(owner);
      }
    }
    if (this.owners.size && !this.child && performance.now() >= this.retryAt) this.launch();
  }

  private launch(): void {
    const child = spawn(this.path, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    this.ready = false;
    this.blocked = false;
    const startup = setTimeout(() => {
      if (!this.ready && this.child === child) {
        this.log("native helper did not become ready; terminating it");
        child.kill();
      }
    }, 5_000);
    startup.unref();
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (this.child !== child || this.closing) return;
      try {
        const message = JSON.parse(line) as { type?: string; protocol?: number; held?: boolean; owners?: number };
        if (message.type === "ready" && message.protocol === 1) {
          clearTimeout(startup);
          this.ready = true;
          for (const owner of this.owners.keys()) this.send(owner);
        } else if (message.type === "state") {
          this.debug(`system sleep ${message.held ? "inhibited" : "released"}; active plugin leases=${message.owners}`);
        }
      } catch {
        this.log("invalid native helper response");
        child.kill();
      }
    });
    child.stdin.on("drain", () => {
      if (this.child !== child) return;
      this.blocked = false;
      for (const owner of this.owners.keys()) this.send(owner);
      // Removed owners expire in the helper even if a release was lost to backpressure.
    });
    child.stdin.on("error", () => child.kill());
    child.stderr.on("data", (chunk: Buffer) => this.log(chunk.toString("utf8").trim().slice(0, 2_000)));
    child.on("error", (error) => this.log(`native helper failed: ${error.message}`));
    child.on("close", (code, signal) => {
      clearTimeout(startup);
      lines.close();
      if (this.child !== child) return;
      this.child = undefined;
      this.ready = false;
      this.retryAt = performance.now() + 2_000;
      if (!this.closing && this.owners.size) this.log(`native helper exited (${code ?? signal}); retrying while fresh activity remains`);
    });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    clearInterval(this.timer);
    this.owners.clear();
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill(), 2_000);
      force.unref();
      child.once("close", () => { clearTimeout(force); resolve(); });
      child.stdin.end();
    });
  }
}

interface Shared { helper: HelperClient; owners: Set<string> }
const key = Symbol.for("liubsp.opencode-awake.helpers.v1");
const globals = globalThis as unknown as Record<symbol, Map<string, Shared> | undefined>;
const pool = globals[key] ??= new Map<string, Shared>();

/** Shared within a JS runtime; isolated runtimes/processes safely use independent OS assertions. */
export function helperLease(path: string, log: Log, debug: Log) {
  let shared = pool.get(path);
  if (!shared) {
    shared = { helper: new HelperClient(path, log, debug), owners: new Set() };
    pool.set(path, shared);
  }
  const entry = shared;
  const owner = randomUUID();
  entry.owners.add(owner);
  let released = false;
  return {
    update(active: boolean) { if (!released) entry.helper.update(owner, active); },
    async dispose() {
      if (released) return;
      released = true;
      entry.helper.update(owner, false);
      entry.owners.delete(owner);
      if (entry.owners.size === 0) {
        if (pool.get(path) === entry) pool.delete(path);
        await entry.helper.close();
      }
    },
  };
}
