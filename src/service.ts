import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import type { Options } from "./options.js";

/** V2.0.8's plugin context omits session.active; use the public authenticated HTTP client. */
export function snapshotReader(options: Options, expectedPID = process.pid) {
  let client: ReturnType<typeof OpenCode.make> | undefined;
  return async (signal: AbortSignal) => {
    try {
      if (!client) {
        if (options.serverUrl) {
          const authorization = options.authorizationEnv ? process.env[options.authorizationEnv] : undefined;
          if (options.authorizationEnv && !authorization) throw new Error(`missing authorization environment variable ${options.authorizationEnv}`);
          client = OpenCode.make({ baseUrl: options.serverUrl, headers: authorization ? { authorization } : undefined });
        } else {
          const endpoint = await Service.discover({ file: options.serviceFile, version: (v) => v.startsWith("2.") });
          if (!endpoint) throw new Error("no local V2 service discovered; standalone servers require the serverUrl option");
          client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
        }
      }
      // Verify every snapshot, including after an endpoint is reused by a replacement process.
      const info = await client.server.info({ signal });
      if (info.pid !== expectedPID) throw new Error("discovered server is not this plugin's host process; configure serverUrl/serviceFile for this server");
      return await client.session.active({ signal });
    } catch (error) {
      client = undefined;
      throw error;
    }
  };
}
