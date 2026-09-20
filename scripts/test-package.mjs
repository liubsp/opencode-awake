import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(process.env.npm_execpath, "Run this check through npm run test:package");
const npm = (args, cwd) => {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
};
const packed = JSON.parse(npm(["pack", "--ignore-scripts", "--json"], root))[0];
const privatePaths = [root.replace(/[\\/]$/, ""), homedir()]
  .flatMap((path) => [path, path.replaceAll("\\", "/"), pathToFileURL(path).href]);
for (const file of packed.files) {
  const bytes = await readFile(join(root, file.path));
  for (const encoding of ["utf8", "utf16le"]) {
    const text = bytes.toString(encoding).toLowerCase();
    assert.ok(!privatePaths.some((path) => text.includes(path.toLowerCase())),
      `Packaged file contains a private build path: ${file.path}`);
  }
}
console.log("Packaged files contain no current home or checkout paths (UTF-8/UTF-16).");
const base = join(tmpdir(), "opencode");
await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, "awake-package-"));
try {
  npm(["install", "--prefix", directory, "--ignore-scripts", "--no-audit", "--no-fund", join(root, packed.filename)], directory);
  const installed = join(directory, "node_modules", "@liubsp", "opencode-awake");
  const script = `
    import assert from 'node:assert/strict';
    import { spawn } from 'node:child_process';
    import { createInterface } from 'node:readline';
    const { default: plugin } = await import(${JSON.stringify(pathToFileURL(join(installed, "index.js")).href)});
    const { defaultHelperPath } = await import(${JSON.stringify(pathToFileURL(join(installed, "dist", "helper.js")).href)});
    assert.equal(plugin.id, 'liubsp.opencode-awake');
    assert.equal(typeof plugin.setup, 'function');
    const child = spawn(defaultHelperPath(), [], { stdio: 'pipe', windowsHide: true });
    let acquired = false;
    const timeout = setTimeout(() => child.kill(), 5000);
    const lines = createInterface({ input: child.stdout });
    child.stderr.pipe(process.stderr);
    lines.on('line', line => {
      const event = JSON.parse(line);
      if (event.type === 'state' && event.held) { acquired = true; child.stdin.end(); }
    });
    child.stdin.write(JSON.stringify({ owner: 'package-check', active: true, ttl_ms: 1000 }) + '\\n');
    const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
    clearTimeout(timeout);
    lines.close();
    assert.equal(code, 0);
    assert.ok(acquired, 'installed helper must acquire a native assertion');
    console.log('Installed tarball: plugin import and native assertion passed.');
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: directory, encoding: "utf8", windowsHide: true, timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  console.log(result.stdout.trim());
} finally {
  await rm(directory, { recursive: true, force: true });
}
