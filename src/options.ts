import { isAbsolute } from "node:path";

export interface Options {
  pollMs: number;
  releaseDelayMs: number;
  helperPath?: string;
  serviceFile?: string;
  serverUrl?: string;
  authorizationEnv?: string;
  debug: boolean;
}

export function parseOptions(input: Record<string, unknown>): Options {
  const number = (name: string, fallback: number, min: number, max: number) => {
    const value = input[name] ?? fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`opencode-awake: ${name} must be an integer from ${min} to ${max}`);
    }
    return value;
  };
  const string = (name: string) => {
    const value = input[name];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length === 0) throw new Error(`opencode-awake: invalid ${name}`);
    return value;
  };
  const helperPath = string("helperPath");
  const serviceFile = string("serviceFile");
  for (const path of [helperPath, serviceFile]) {
    if (path && !isAbsolute(path)) throw new Error("opencode-awake: helperPath and serviceFile must be absolute paths");
  }
  const serverUrl = string("serverUrl");
  if (serverUrl && !["http:", "https:"].includes(new URL(serverUrl).protocol)) {
    throw new Error("opencode-awake: serverUrl must use HTTP or HTTPS");
  }
  if (input.debug !== undefined && typeof input.debug !== "boolean") throw new Error("opencode-awake: debug must be boolean");
  return {
    pollMs: number("pollMs", 2_000, 250, 10_000),
    releaseDelayMs: number("releaseDelayMs", 1_000, 0, 5_000),
    helperPath, serviceFile, serverUrl, authorizationEnv: string("authorizationEnv"), debug: input.debug === true,
  };
}
