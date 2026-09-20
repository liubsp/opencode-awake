import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { snapshotReader } from "../src/service.js";
import { parseOptions } from "../src/options.js";

test("snapshot reader checks host identity on every read and forwards authentication", async () => {
  let pid = process.pid;
  const seen: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    seen.push(request.headers.authorization);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.url === "/api/info" ? { pid } : { data: { ses_a: { type: "running" } } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const env = "OPENCODE_AWAKE_TEST_AUTH";
  process.env[env] = "Basic test-only";
  const reader = snapshotReader(parseOptions({ serverUrl: `http://127.0.0.1:${address.port}`, authorizationEnv: env }));
  try {
    assert.deepEqual(await reader(AbortSignal.timeout(2_000)), { ses_a: { type: "running" } });
    assert.ok(seen.every((header) => header === "Basic test-only"));
    pid++;
    await assert.rejects(reader(AbortSignal.timeout(2_000)), /not this plugin's host/);
  } finally {
    delete process.env[env];
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
