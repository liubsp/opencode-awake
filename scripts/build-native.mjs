import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
// Panic locations and debug metadata can embed Cargo/home paths even in release binaries.
// Encoded flags preserve paths containing spaces and any caller-supplied compiler flags.
const existingFlags = process.env.CARGO_ENCODED_RUSTFLAGS?.split("\x1f") ??
  process.env.RUSTFLAGS?.trim().split(/\s+/).filter(Boolean) ?? [];
const remaps = [
  [homedir(), "/home/builder"],
  [process.env.CARGO_HOME || join(homedir(), ".cargo"), "/cargo"],
  [root.replace(/[\\/]$/, ""), "/workspace/opencode-awake"],
];
const flags = [...existingFlags, ...remaps.flatMap(([from, to]) => ["--remap-path-prefix", `${from}=${to}`])];
const result = spawnSync("cargo", ["build", "--release", "--locked", "--manifest-path", "native/Cargo.toml"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const suffix = process.platform === "win32" ? ".exe" : "";
mkdirSync(join(root, "bin"), { recursive: true });
const destination = join(root, "bin", `opencode-awake${suffix}`);
copyFileSync(join(root, "native", "target", "release", `opencode-awake-helper${suffix}`), destination);
// Remove this build's obsolete filename so it is not included in packages.
rmSync(join(root, "bin", `opencode-awake-${process.platform}-${process.arch}${suffix}`), { force: true });
rmSync(join(root, "bin", `opencode-awake-helper${suffix}`), { force: true });
if (process.platform !== "win32") chmodSync(destination, 0o755);
console.log(`Built ${destination}`);
