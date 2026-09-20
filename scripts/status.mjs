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
  console.log(`OpenCode ${info.version}, PID ${info.pid}: ${Object.keys(sessions).length} active sessions`);
  console.log("The following OS report includes assertions from all applications:");
}
const command = process.platform === "win32" ? ["powercfg.exe", "/requests"] :
  process.platform === "darwin" ? ["/usr/bin/pmset", "-g", "assertions"] : undefined;
if (command) {
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.status) process.exitCode = result.status;
}
