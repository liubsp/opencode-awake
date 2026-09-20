// Explicit integration check: loads only into temporary locations on an existing service.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { spawnSync } from "node:child_process";

const endpoint = await Service.discover();
assert.ok(endpoint, "Start an OpenCode V2 service before running this explicit integration check");
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
const info = await client.server.info({ signal: AbortSignal.timeout(5_000) });
const root = fileURLToPath(new URL("../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const base = join(tmpdir(), "opencode");
await mkdir(base, { recursive: true });
const directories = await Promise.all([mkdtemp(join(base, "awake-a-")), mkdtemp(join(base, "awake-b-"))]);
const pluginID = "liubsp.opencode-awake";
const sessions = [];
function helpers() {
  const name = `opencode-awake${process.platform === "win32" ? ".exe" : ""}`;
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Get-CimInstance Win32_Process -Filter \"Name = '${name}' AND ParentProcessId = ${info.pid}\" | Select-Object -ExpandProperty ProcessId`], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
  }
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return match && Number(match[2]) === info.pid && match[3].endsWith(name) ? [Number(match[1])] : [];
  });
}
const originalHelpers = new Set(helpers());
let testHelpers = [];
const list = async (directory) => {
  const result = await client.plugin.list({ location: { directory } }, { signal: AbortSignal.timeout(15_000) });
  assert.equal(result.location.directory, directory, "API must target the requested temporary location");
  return result.data;
};
async function waitFor(directory, active) {
  let last = [];
  for (let i = 0; i < 30; i++) {
    const plugins = await list(directory);
    last = plugins.filter((plugin) => !plugin.id?.startsWith("opencode.")).map(({ id, state }) => ({ id, state }));
    const plugin = plugins.find((p) => p.id === pluginID);
    if (active && plugin?.state.status === "failed") throw new Error(plugin.state.error);
    if (active ? plugin?.state.status === "active" : !plugin) return;
    await delay(500);
  }
  throw new Error(`Plugin did not become ${active ? "active" : "unloaded"}: ${directory}; ${JSON.stringify(last)}`);
}
try {
  for (const directory of directories) {
    await writeFile(join(directory, "opencode.json"), JSON.stringify({ plugins: [{ package: root, options: { debug: true } }] }));
    const documents = await client.config.get({ location: { directory } });
    assert.ok(documents.some((doc) => doc.path === join(directory, "opencode.json")),
      `Temporary config was not discovered: ${JSON.stringify(documents.map((doc) => ({ type: doc.type, path: doc.path })))}`);
    const session = await client.session.create({ title: "opencode-awake integration check", location: { directory } });
    sessions.push(session.id);
    await client.session.prompt({ sessionID: session.id, text: "Plugin loading check (no execution).", resume: false });
    await waitFor(directory, true);
    console.log(`Loaded ${pluginID} in ${directory}`);
  }
  const active = await client.session.active({ signal: AbortSignal.timeout(5_000) });
  console.log(`Real service ${info.version}, PID ${info.pid}: ${Object.keys(active).length} active sessions`);
  await delay(3_000);
  testHelpers = helpers().filter((pid) => !originalHelpers.has(pid));
  if (Object.keys(active).length > 0 && originalHelpers.size === 0) {
    assert.ok(testHelpers.length > 0, "Running sessions must start a native helper owned by the real OpenCode service");
  }
  console.log(`Native helper PIDs owned by service: ${helpers().join(", ") || "none (idle)"}`);
  const command = process.platform === "win32" ? ["powercfg.exe", "/requests"] : ["/usr/bin/pmset", "-g", "assertions"];
  const report = spawnSync(command[0], command.slice(1), { encoding: "utf8", windowsHide: true });
  console.log(report.stdout || report.stderr || "OS assertion report unavailable");
  await writeFile(join(directories[0], "opencode.json"), JSON.stringify({ plugins: [`-${pluginID}`] }));
  await waitFor(directories[0], false);
  await waitFor(directories[1], true);
  if (testHelpers.length && Object.keys(await client.session.active()).length) {
    assert.ok(helpers().some((pid) => testHelpers.includes(pid)), "Unloading one location must preserve the shared helper");
  }
  console.log("First location unloaded; second location remains active.");
} finally {
  for (const sessionID of sessions) await client.session.remove({ sessionID });
  for (const directory of directories) {
    await writeFile(join(directory, "opencode.json"), JSON.stringify({ plugins: [`-${pluginID}`] }));
    await waitFor(directory, false);
    await rm(directory, { recursive: true, force: true });
  }
  for (let i = 0; i < 10 && helpers().some((pid) => testHelpers.includes(pid)); i++) await delay(300);
  assert.ok(!helpers().some((pid) => testHelpers.includes(pid)), "Temporary plugin helpers must exit on unload");
  console.log("Temporary plugin locations unloaded and removed.");
}
