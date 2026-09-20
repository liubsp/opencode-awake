import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

let endpoint;
for (let attempt = 0; attempt < 3; attempt++) {
  try { endpoint = await Service.discover(); } catch { /* Discovery failure is not proof of inactivity. */ }
  if (endpoint) break;
  if (attempt < 2) await delay(500);
}
if (!endpoint) {
  console.log("OpenCode activity: unknown (service discovery did not succeed after 3 attempts).");
  console.log("This does not mean the service stopped or its sleep assertion was released.");
  console.log("Check opencode service status in the same terminal. Elevated terminals may use different user/environment settings.");
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
