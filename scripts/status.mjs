import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { spawnSync } from "node:child_process";

const endpoint = await Service.discover();
if (!endpoint) {
  console.log("No running local OpenCode service was discovered.");
} else {
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
  const signal = AbortSignal.timeout(5_000);
  const info = await client.server.info({ signal });
  const sessions = await client.session.active({ signal });
  const details = await Promise.all(Object.keys(sessions).map(async (sessionID) => {
    try { return await client.session.get({ sessionID }, { signal }); }
    catch { return { id: sessionID, title: "Session finished or unavailable" }; }
  }));
  console.log(`OpenCode ${info.version}: ${details.length} active executions across the service (including child agents)`);
  for (const session of details) console.log(`  ${session.parentID ? "child" : "session"}: ${session.title} [${session.id}]`);
}
const osReport = process.argv.includes("--os");
if (!osReport) console.log("Optional system-wide power report: opencode-awake status --os (requires elevation on Windows).");
const command = process.platform === "win32" ? ["powercfg.exe", "/requests"] :
  process.platform === "darwin" ? ["/usr/bin/pmset", "-g", "assertions"] : undefined;
if (osReport && command) {
  console.log("OS assertions from all applications:");
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.status) process.exitCode = result.status;
}
