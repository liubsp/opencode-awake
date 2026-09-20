import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ActivityMonitor, type ActivitySource } from "../src/activity.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const running = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { type: "running" }]));

function fixture(snapshot: ActivitySource["snapshot"], releaseDelayMs = 5) {
  const updates: boolean[] = [];
  const warnings: string[] = [];
  const monitor = new ActivityMonitor({
    snapshot,
    async *subscribe(signal) { await delay(60_000, undefined, { signal }).catch(() => {}); },
  }, (active) => updates.push(active), { pollMs: 60_000, releaseDelayMs }, (message) => warnings.push(message));
  return { monitor, updates, warnings };
}

test("startup snapshot protects already-running root and child sessions; one completion cannot release the other", async () => {
  let active = ["ses_parent", "ses_child"];
  const f = fixture(async () => running(active));
  try {
    await f.monitor.refresh();
    assert.deepEqual(f.updates, [true]);
    active = ["ses_child"];
    f.monitor.handle({ type: "session.execution.succeeded", data: { sessionID: "ses_parent" } });
    await f.monitor.refresh();
    await delay(10);
    assert.ok(f.updates.every(Boolean));
    active = [];
    await f.monitor.refresh();
    await delay(10);
    assert.equal(f.updates.at(-1), false);
  } finally { await f.monitor.stop(); }
});

test("a stale in-flight empty snapshot cannot overwrite a newly started session", async () => {
  const first = deferred<ReturnType<typeof running>>();
  let reads = 0;
  const f = fixture(async () => ++reads === 1 ? first.promise : running(["ses_new"]));
  try {
    const read = f.monitor.refresh();
    f.monitor.handle({ type: "session.execution.started", data: { sessionID: "ses_new" } });
    first.resolve({});
    await read;
    await delay(10);
    assert.ok(reads >= 2);
    assert.ok(f.updates.every(Boolean));
  } finally { await f.monitor.stop(); }
});

test("handoff during release debounce keeps the assertion", async () => {
  let active = ["ses_a"];
  const f = fixture(async () => running(active), 40);
  try {
    await f.monitor.refresh();
    active = [];
    await f.monitor.refresh();
    active = ["ses_b"];
    f.monitor.handle({ type: "session.status", data: { sessionID: "ses_b", status: { type: "busy" } } });
    await f.monitor.refresh();
    await delay(60);
    assert.ok(f.updates.every(Boolean));
  } finally { await f.monitor.stop(); }
});

test("errors do not renew old leases; a successful recovery can renew", async () => {
  let failing = false;
  const f = fixture(async () => {
    if (failing) throw new Error("disconnected");
    return running(["ses_a"]);
  });
  try {
    await f.monitor.refresh();
    failing = true;
    await f.monitor.refresh();
    await f.monitor.refresh();
    assert.deepEqual(f.updates, [true]);
    assert.equal(f.warnings.length, 1);
    failing = false;
    await f.monitor.refresh();
    assert.deepEqual(f.updates, [true, true]);
  } finally { await f.monitor.stop(); }
});

test("duplicate busy/retry events do not perpetually renew an unverifiable session", async () => {
  const f = fixture(async () => { throw new Error("offline"); });
  try {
    const event = { type: "session.status", data: { sessionID: "ses_a", status: { type: "retry" } } };
    f.monitor.handle(event);
    await f.monitor.refresh();
    f.monitor.handle(event);
    await f.monitor.refresh();
    assert.deepEqual(f.updates, [true]);
  } finally { await f.monitor.stop(); }
});

test("unload during an in-flight request cannot reacquire", async () => {
  const snapshot = deferred<ReturnType<typeof running>>();
  const f = fixture(async () => snapshot.promise);
  const read = f.monitor.refresh();
  const stopped = f.monitor.stop();
  snapshot.resolve(running(["ses_late"]));
  await Promise.all([read, stopped]);
  assert.deepEqual(f.updates, [false]);
});

test("terminal errors and interruptions reconcile to idle", async () => {
  for (const type of ["session.execution.failed", "session.execution.interrupted", "session.idle", "session.deleted"]) {
    let active = ["ses_a"];
    const f = fixture(async () => running(active));
    try {
      await f.monitor.refresh();
      active = [];
      f.monitor.handle({ type, data: { sessionID: "ses_a" } });
      await f.monitor.refresh();
      await delay(10);
      assert.equal(f.updates.at(-1), false, type);
    } finally { await f.monitor.stop(); }
  }
});

test("event stream reconnect triggers reconciliation after missed completion", async () => {
  let subscriptions = 0;
  let active = ["ses_a"];
  const updates: boolean[] = [];
  const monitor = new ActivityMonitor({
    snapshot: async () => running(active),
    async *subscribe(signal) {
      subscriptions++;
      if (subscriptions === 1) {
        yield { type: "server.connected" };
        await delay(10);
        active = [];
        throw new Error("stream disconnected");
      }
      yield { type: "server.connected" };
      await delay(60_000, undefined, { signal }).catch(() => {});
    },
  }, (active) => updates.push(active), { pollMs: 60_000, releaseDelayMs: 0 }, () => {});
  try {
    monitor.start();
    for (let i = 0; i < 100 && updates.at(-1) !== false; i++) await delay(10);
    assert.ok(subscriptions >= 2);
    assert.equal(updates.at(-1), false);
  } finally { await monitor.stop(); }
});
