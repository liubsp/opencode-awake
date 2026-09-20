import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { defaultHelperPath, helperLease } from "../src/helper.js";

const supported = process.platform === "win32" || process.platform === "darwin";

function helper() {
  const child = spawn(defaultHelperPath(), [], { stdio: "pipe", windowsHide: true });
  const messages: Array<{ type: string; held?: boolean; owners?: number }> = [];
  let errors = "";
  child.stderr.on("data", (data) => { errors += data; });
  child.stdin.on("error", () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => messages.push(JSON.parse(line)));
  const closed = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => { lines.close(); resolve(code); });
  });
  return {
    child, messages, closed,
    update(owner: string, active: boolean, ttl_ms = 1_000) { child.stdin.write(JSON.stringify({ owner, active, ttl_ms }) + "\n"); },
    async wait(predicate: () => boolean) {
      for (let i = 0; i < 200; i++) {
        if (predicate()) return;
        await delay(10);
      }
      assert.fail(`helper response timed out: ${errors}; messages=${JSON.stringify(messages)}`);
    },
    async dispose() { child.kill(); await closed; },
  };
}

test("native assertions aggregate owners, expire stale leases, and release after EOF", { skip: !supported, timeout: 10_000 }, async () => {
  const h = helper();
  try {
    await h.wait(() => h.messages.some((m) => m.type === "ready"));
    h.update("a", true, 1_000);
    h.update("b", true, 1_000);
    await h.wait(() => h.messages.at(-1)?.owners === 2);
    h.update("a", false);
    await h.wait(() => h.messages.at(-1)?.owners === 1);
    assert.equal(h.messages.at(-1)?.held, true);
    await h.wait(() => h.messages.at(-1)?.held === false);
    h.update("remaining", true);
    await h.wait(() => h.messages.at(-1)?.held === true);
    h.child.stdin.end();
    assert.equal(await h.closed, 0);
  } finally { await h.dispose(); }
});

test("invalid protocol input fails closed", { skip: !supported, timeout: 5_000 }, async () => {
  const h = helper();
  try {
    h.update("owner", true);
    await h.wait(() => h.messages.at(-1)?.held === true);
    h.child.stdin.write("not json\n");
    assert.equal(await h.closed, 1);
  } finally { await h.dispose(); }
});

test("multiple plugin instances share a helper without one unload releasing another", { skip: !supported, timeout: 8_000 }, async () => {
  const logs: string[] = [];
  const states: string[] = [];
  const first = helperLease(defaultHelperPath(), (s) => logs.push(s), (s) => states.push(s));
  const second = helperLease(defaultHelperPath(), (s) => logs.push(s), (s) => states.push(s));
  const wait = async (match: string) => {
    for (let i = 0; i < 200 && !states.at(-1)?.includes(match); i++) await delay(10);
    assert.ok(states.at(-1)?.includes(match), JSON.stringify({ logs, states }));
  };
  try {
    first.update(true);
    second.update(true);
    await wait("leases=2");
    await first.dispose();
    await wait("leases=1");
    assert.ok(states.at(-1)?.includes("inhibited"));
    second.update(false);
    await wait("released");
    assert.deepEqual(logs, []);
  } finally { await first.dispose(); await second.dispose(); }
});

test("abrupt owner-process death closes the helper's lease and exits the helper", { skip: !supported, timeout: 10_000 }, async () => {
  const script = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.argv[1], [], { stdio: 'pipe', windowsHide: true });
    console.log(JSON.stringify({ type: 'pid', pid: child.pid }));
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.stdin.write(JSON.stringify({ owner: 'crash-test', active: true, ttl_ms: 30000 }) + '\\n');
    setInterval(() => {}, 1000);
  `;
  const owner = spawn(process.execPath, ["-e", script, defaultHelperPath()], { stdio: "pipe", windowsHide: true });
  let helperPID: number | undefined;
  let held = false;
  let errors = "";
  owner.stderr.on("data", (data) => { errors += data; });
  const lines = createInterface({ input: owner.stdout });
  lines.on("line", (line) => {
    const event = JSON.parse(line);
    if (event.type === "pid") helperPID = event.pid;
    if (event.type === "state") held = event.held;
  });
  const exited = new Promise<void>((resolve) => owner.on("close", () => resolve()));
  const alive = () => {
    if (!helperPID) return false;
    try { process.kill(helperPID, 0); return true; } catch { return false; }
  };
  try {
    for (let i = 0; i < 200 && !held; i++) await delay(10);
    assert.ok(held && helperPID, errors || "helper must acquire before the owner is terminated");
    owner.kill("SIGKILL");
    await exited;
    for (let i = 0; i < 200 && alive(); i++) await delay(10);
    assert.equal(alive(), false, "helper should exit on stdin EOF, without waiting for the 30s watchdog");
  } finally {
    owner.kill();
    if (alive()) process.kill(helperPID!);
    lines.close();
    await exited;
  }
});
