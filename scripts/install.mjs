import { cp, mkdir, readFile, rm, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { atomicWrite, configure, exists } from "./install-config.mjs";

export function defaults() {
  const dataDir = process.env.OPENCODE_AWAKE_INSTALL_DIR || (process.platform === "win32" ?
    join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "opencode-awake") :
    join(homedir(), "Library", "Application Support", "opencode-awake"));
  const configDir = process.env.OPENCODE_AWAKE_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode");
  const binDir = process.env.OPENCODE_AWAKE_BIN_DIR || (process.platform === "win32" ? join(dataDir, "bin") : join(homedir(), ".local", "bin"));
  return { dataDir: resolve(dataDir), configDir: resolve(configDir), binDir: resolve(binDir) };
}

export async function install({ source, dataDir, configDir, binDir }) {
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  const versionDir = join(dataDir, "versions", `${manifest.version}-${randomUUID()}`);
  const suffix = process.platform === "win32" ? ".exe" : "";
  const binary = `opencode-awake${suffix}`;
  if (!await exists(join(source, "dist", "index.js")) || !await exists(join(source, "bin", binary))) {
    throw new Error("Build the plugin before running setup");
  }
  const files = ["index.js", "package.json", "dist", "bin", "node_modules", "scripts"];
  const indexPath = join(dataDir, "index.js");
  const rootPackage = join(dataDir, "package.json");
  if (await exists(rootPackage) && JSON.parse(await readFile(rootPackage, "utf8")).name !== "opencode-awake-managed") {
    throw new Error("Installation directory belongs to another package; choose an empty managed installation directory");
  }
  const shimPath = join(binDir, process.platform === "win32" ? "opencode-awake.cmd" : "opencode-awake");
  const ownedFiles = [indexPath, rootPackage, join(dataDir, "manage.mjs"), shimPath];
  const previous = new Map(await Promise.all(ownedFiles.map(async (path) => [path, await exists(path) ? await readFile(path, "utf8") : undefined])));
  let activated = false;
  try {
    await mkdir(versionDir, { recursive: true });
    for (const file of files) await cp(join(source, file), join(versionDir, file), { recursive: true });
    const prefix = `./${relative(dataDir, versionDir).replaceAll("\\", "/")}`;
    await atomicWrite(join(dataDir, "package.json"), JSON.stringify({ name: "opencode-awake-managed", private: true, type: "module" }) + "\n");
    await atomicWrite(join(dataDir, "manage.mjs"),
      `import { main } from ${JSON.stringify(`${prefix}/scripts/manage.mjs`)};\nawait main(${JSON.stringify({ dataDir, configDir, binDir })});\n`);
    await mkdir(binDir, { recursive: true });
    if (process.platform === "win32") {
      await atomicWrite(join(binDir, "opencode-awake.cmd"), `@echo off\r\nnode "${join(dataDir, "manage.mjs")}" %*\r\n`);
    } else {
      const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
      const shim = join(binDir, "opencode-awake");
      await atomicWrite(shim, `#!/bin/sh\nexec node ${quote(join(dataDir, "manage.mjs"))} "$@"\n`);
      await chmod(shim, 0o755);
    }
    await atomicWrite(indexPath, `export { default } from ${JSON.stringify(`${prefix}/index.js`)};\n`);
    activated = true;
    await configure(configDir, dataDir);
  } catch (error) {
    for (const [path, content] of previous) {
      if (content === undefined) await rm(path, { force: true });
      else await atomicWrite(path, content);
      if (path === shimPath && content !== undefined && process.platform !== "win32") await chmod(path, 0o755);
    }
    if (!activated) await rm(versionDir, { recursive: true, force: true });
    // A briefly activated version may still have a helper open while OpenCode processes rollback.
    throw error;
  }
  return versionDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!(process.platform === "win32" || (process.platform === "darwin" && process.arch === "arm64"))) throw new Error("Supported targets: Windows and Apple Silicon macOS");
  await install({ source: fileURLToPath(new URL("../", import.meta.url)), ...defaults() });
  console.log("OpenCode Awake installed and registered globally. OpenCode will reload its configuration.");
}
