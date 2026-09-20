import { rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { configure } from "./install-config.mjs";

export async function main(settings, args = process.argv.slice(2)) {
  const command = args[0] ?? "help";
  if (command === "status") { await import("./status.mjs"); return; }
  if (command === "update") {
    const base = "https://raw.githubusercontent.com/liubsp/opencode-awake/main/scripts";
    const executable = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
    const argv = process.platform === "win32" ? ["-NoProfile", "-Command", `& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing '${base}/install.ps1').Content))`] :
      ["-c", `curl -fsSL '${base}/install.sh' | bash`];
    const child = spawn(executable, argv, { stdio: "inherit", env: {
      ...process.env, OPENCODE_AWAKE_INSTALL_DIR: settings.dataDir,
      OPENCODE_AWAKE_CONFIG_DIR: settings.configDir, OPENCODE_AWAKE_BIN_DIR: settings.binDir,
    } });
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    process.exitCode = code ?? 1;
    return;
  }
  if (command === "uninstall") {
    await configure(settings.configDir, settings.dataDir, { uninstall: true });
    try {
      await rm(settings.dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await rm(join(settings.binDir, process.platform === "win32" ? "opencode-awake.cmd" : "opencode-awake"), { force: true });
      console.log("OpenCode Awake unregistered and removed.");
    } catch {
      console.log("OpenCode Awake unregistered. Some files are still in use; remaining installation files can be removed after OpenCode reloads.");
    }
    return;
  }
  console.log("Usage: opencode-awake <status|update|uninstall>");
  if (command !== "help" && command !== "--help" && command !== "-h") process.exitCode = 1;
}
