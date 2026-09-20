import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parse } from "jsonc-parser";
import { configure, exists } from "../scripts/install-config.mjs";
import { install } from "../scripts/install.mjs";
import { parseOptions } from "../src/options.js";

async function temporary() {
  const base = join(tmpdir(), "opencode");
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, "awake-install-test-"));
}

test("installer merges both global config files, preserves comments/options, and is idempotent", async () => {
  const root = await temporary();
  const configDir = join(root, "config");
  const dataDir = join(root, "managed");
  const checkout = join(root, "old-checkout");
  try {
    await mkdir(configDir);
    await mkdir(checkout);
    await writeFile(join(checkout, "package.json"), JSON.stringify({ name: "@liubsp/opencode-awake" }));
    const old = `// retain this comment\n${JSON.stringify({ model: "example/model", plugins: [
      { package: checkout, options: { pollMs: 2000, releaseDelayMs: 1000, debug: true } }, "other-plugin",
    ] }, null, 2)}\n`;
    await writeFile(join(configDir, "opencode.json"), old);
    await writeFile(join(configDir, "opencode.jsonc"), '{\n // retain settings\n "agents": {},\n}\n');
    assert.equal(await configure(configDir, dataDir), 2);
    const lower = await readFile(join(configDir, "opencode.json"), "utf8");
    const higher = await readFile(join(configDir, "opencode.jsonc"), "utf8");
    assert.ok(lower.includes("retain this comment"));
    assert.ok(higher.includes("retain settings"));
    assert.deepEqual(parse(lower), { model: "example/model", plugins: ["other-plugin"] });
    assert.deepEqual(parse(higher).plugins, [{ package: dataDir.replaceAll("\\", "/"), options: { pollSeconds: 2, releaseDelaySeconds: 1, debug: true } }]);
    assert.equal(await readFile(join(configDir, "opencode.json.opencode-awake.bak"), "utf8"), old);
    assert.equal(await configure(configDir, dataDir), 0);
    await configure(configDir, dataDir, { uninstall: true });
    assert.deepEqual(parse(await readFile(join(configDir, "opencode.jsonc"), "utf8")).plugins, []);
    assert.deepEqual(parse(await readFile(join(configDir, "opencode.json"), "utf8")).plugins, ["other-plugin"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("installer preserves inline option comments while migrating timing units", async () => {
  const root = await temporary();
  const dataDir = join(root, "managed");
  try {
    const text = `{ "plugins": [{ "package": ${JSON.stringify(dataDir)}, "options": {
      // important custom option
      "debug": true,
      "pollMs": 1000,
      "releaseDelayMs": 0
    }}] }`;
    await writeFile(join(root, "opencode.jsonc"), text);
    await configure(root, dataDir);
    const updated = await readFile(join(root, "opencode.jsonc"), "utf8");
    assert.ok(updated.includes("important custom option"));
    assert.deepEqual(parse(updated).plugins[0].options, { debug: true, pollSeconds: 1, releaseDelaySeconds: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid config is not overwritten and an empty config directory is initialized", async () => {
  const root = await temporary();
  try {
    const path = join(root, "opencode.jsonc");
    await writeFile(path, '{ "plugins": [ broken');
    await assert.rejects(configure(root, join(root, "managed")), /Invalid OpenCode configuration/);
    assert.equal(await readFile(path, "utf8"), '{ "plugins": [ broken');
    await rm(path);
    assert.equal(await configure(root, join(root, "managed"), { uninstall: true }), 0);
    await configure(root, join(root, "managed"));
    assert.equal(parse(await readFile(path, "utf8")).plugins.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("managed install, update, CLI, rollback, and uninstall work outside a checkout", async () => {
  const root = await temporary();
  const source = join(root, "source");
  const dataDir = join(root, "runtime with spaces");
  const configDir = join(root, "config");
  const binDir = join(root, "commands");
  try {
    for (const directory of ["dist", "bin", "node_modules"]) await mkdir(join(source, directory), { recursive: true });
    await cp(resolve("scripts"), join(source, "scripts"), { recursive: true });
    await cp(resolve("node_modules/jsonc-parser"), join(source, "node_modules/jsonc-parser"), { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "@liubsp/opencode-awake", version: "0.0.0-test", type: "module" }));
    await writeFile(join(source, "index.js"), 'export { default } from "./dist/index.js";');
    await writeFile(join(source, "dist/index.js"), 'export default { id: "liubsp.opencode-awake", generation: 1 };');
    await writeFile(join(source, "bin", `opencode-awake${process.platform === "win32" ? ".exe" : ""}`), "fixture");
    const settings = { source, dataDir, configDir, binDir };
    const first = await install(settings);
    assert.equal((await import(pathToFileURL(join(dataDir, "index.js")).href)).default.generation, 1);
    const command = join(binDir, process.platform === "win32" ? "opencode-awake.cmd" : "opencode-awake");
    const help = process.platform === "win32" ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `& '${command.replaceAll("'", "''")}' help`], { encoding: "utf8", cwd: root }) :
      spawnSync(command, ["help"], { encoding: "utf8", cwd: root });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /status\|update\|uninstall/);
    await writeFile(join(source, "dist/index.js"), 'export default { id: "liubsp.opencode-awake", generation: 2 };');
    const second = await install(settings);
    assert.notEqual(first, second);
    assert.ok(await exists(first), "old runtime must remain intact while it may be in use");
    assert.equal((await import(`${pathToFileURL(join(dataDir, "index.js")).href}?updated`)).default.generation, 2);
    const config = join(configDir, "opencode.jsonc");
    const valid = await readFile(config, "utf8");
    const loader = await readFile(join(dataDir, "index.js"), "utf8");
    const manager = await readFile(join(dataDir, "manage.mjs"), "utf8");
    await writeFile(config, "invalid");
    await assert.rejects(install(settings), /Invalid OpenCode configuration/);
    assert.equal(await readFile(join(dataDir, "index.js"), "utf8"), loader);
    assert.equal(await readFile(join(dataDir, "manage.mjs"), "utf8"), manager);
    await writeFile(config, valid);
    const removed = spawnSync(process.execPath, [join(dataDir, "manage.mjs"), "uninstall"], { encoding: "utf8", cwd: root });
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!await exists(dataDir));
    assert.ok(!await exists(command));
    assert.deepEqual(parse(await readFile(config, "utf8")).plugins, []);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
});

test("public timing options use whole seconds within the watchdog window", () => {
  const defaults = parseOptions({});
  assert.equal(defaults.pollMs, 10_000);
  assert.equal(defaults.releaseDelayMs, 1_000);
  assert.equal(parseOptions({ pollSeconds: 3, releaseDelaySeconds: 0 }).pollMs, 3_000);
  assert.throws(() => parseOptions({ pollSeconds: 0.5 }), /integer/);
  assert.throws(() => parseOptions({ pollSeconds: 30 }), /integer/);
  assert.throws(() => parseOptions({ pollMs: 2000 }), /use pollSeconds/);
});
