# Development

## Layout

| Path | Responsibility |
| --- | --- |
| `index.js` | Root entrypoint for OpenCode's local-directory plugin loader. |
| `src/index.ts` | V2 plugin setup and cleanup. |
| `src/activity.ts` | Events, serialized snapshots, reconnects, and final-release debounce. |
| `src/service.ts` | Authenticated service discovery and host PID verification. |
| `src/helper.ts` | Shared native-helper ownership and protocol supervision. |
| `native/src/main.rs` | Rust lease manager, expiry watchdog, and stdin protocol. |
| `native/src/power.rs` | Windows/macOS power assertions with owned-resource cleanup. |
| `test/` | Activity, service, and native-process tests. |

## Build and check

Prerequisites: Node.js 22+, npm, Rust stable, and the platform's native linker.

```sh
npm ci
npm run build
npm run check
npm test
npm run test:native
cargo fmt --manifest-path native/Cargo.toml --check
cargo clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
```

`npm run build` compiles Rust in release mode, copies the executable to
`bin/opencode-awake[.exe]`, and compiles TypeScript into `dist/`.
Both output directories are ignored by Git. The Cargo and npm lockfiles are committed inputs.
Release builds remap checkout, home, and Cargo paths so embedded compiler metadata does not expose
the build environment's private filesystem layout.
The root `index.js` is required: OpenCode's local-directory loader looks for an index entrypoint,
even when package exports point elsewhere.

Disable the plugin before replacing a loaded native executable, particularly on Windows.

## Activity tracking

The initial target is the published OpenCode V2.0.8 contract:

- `session.execution.started`, `succeeded`, `failed`, and `interrupted`.
- `session.status` (`busy`, `retry`, `idle`), `session.idle`, and `session.deleted`.
- Payloads use `event.data.sessionID`.
- `/api/session/active` returns the process-wide active-session map.

Start events acquire promptly. Terminal events request a fresh whole-process snapshot rather than
directly clearing a counter. A session-ID set avoids duplicate-event counting errors. Snapshot
requests are serialized; a lifecycle change invalidates an older in-flight snapshot. A final empty
snapshot releases after the configured debounce unless new activity arrives.

Event streams have no replay or automatic reconnect. The monitor reconnects with bounded backoff
and also polls. Successful snapshots renew the native lease even during long, silent work.
Failed snapshots do not renew stale state, and repeated busy events for an already-known session
cannot indefinitely extend an unverifiable lease.

### Connection options

V2.0.8 exposes `session.active()` on the HTTP client but omits it from the plugin context.
The plugin uses `@opencode/client/service` to discover the existing shared service, obtains its
authentication headers, and verifies `server.info().pid === process.pid` on every snapshot.
It never starts a service or silently observes a different OpenCode process.

| Option | Default | Meaning |
| --- | --- | --- |
| `serviceFile` | Standard OpenCode discovery | Absolute path to an alternative service registration file. |
| `serverUrl` | Discover local shared service | Explicit HTTP/HTTPS endpoint for a standalone/custom server. |
| `authorizationEnv` | None | With `serverUrl`, the name of an environment variable containing the complete Authorization header. |
| `helperPath` | Bundled platform binary | Absolute path to an alternative protocol-v1 helper. |

The PID check applies to explicitly configured endpoints too. A server restart invalidates the
cached connection on its next failed or mismatched snapshot. A newly loaded plugin discovers the
new host through its own lifecycle.

### Coverage boundary

The active API describes foreground session execution, including running child-agent sessions.
It does not promise coverage of every detached tool or auxiliary generation request. The plugin
doesn't count arbitrary shell inventory: shell records lack a required session ownership link,
and persistent development servers should not cause permanent inhibition.

User-input waits follow OpenCode's active status. There is no verified fully-blocked status that
would justify releasing just because a permission request or question exists.

## Native assertions and ownership

**Windows:** `PowerCreateRequest` and `PowerSetRequest(PowerRequestSystemRequired)`. Cleanup calls
`PowerClearRequest` and closes the owned handle. No display request is made.

**macOS:** IOKit's `IOPMAssertionCreateWithName` with `PreventUserIdleSystemSleep`, released with
`IOPMAssertionRelease`. This is the system-only assertion used by `caffeinate -i`.

Location instances share a helper per binary path through a versioned `globalThis` symbol when
they share a JavaScript runtime. Each instance has its own lease. Separate runtimes/processes
hold independent OS assertions, which the OS aggregates. No process clears another's assertion.

The helper starts lazily when activity appears. While loaded it can remain running with zero
assertions. The last plugin owner closes stdin and waits for helper exit, with forced termination
as a fallback. Parent death closes stdin immediately; a hung parent stops renewing its leases.

### Protocol v1

The helper reads one JSON object per line from stdin:

```json
{"owner":"unique-plugin-instance","active":true,"ttl_ms":180000}
```

Use `active: false` to release that owner. TTLs must be 1–180000 milliseconds for active leases.
Each owner expires independently using Rust's monotonic clock. The helper acquires one assertion
while any fresh lease exists, and releases it when the map becomes empty. Malformed input fails
closed; EOF exits and releases resources.

Responses on stdout are JSON lines:

```json
{"type":"ready","protocol":1}
{"type":"state","held":true,"owners":2}
{"type":"state","held":false,"owners":0}
```

`state` is emitted after a successful OS transition or owner-count change. Errors go to stderr.
The supervisor restarts a failed helper only while fresh activity remains, replaying each lease's
remaining lifetime rather than extending stale leases during recovery.

## Packaging

```sh
npm run test:package
```

This packs the built plugin, checks included files and binaries for private home/checkout paths,
installs the tarball into a temporary directory, checks the installed
entrypoint, and acquires/releases a real assertion using the installed helper. It removes the
temporary installation afterward and leaves the `.tgz` in the checkout.

`npm pack` builds first through `prepack`. Each package contains the binary for the build machine;
it is a platform-specific local artifact. The package is private and is not published to npm.
The CI matrix creates separate Windows and Apple Silicon macOS artifacts.

## Sources

- [V2 plugin API](https://opencode.ai/v2/docs/build/plugins)
- [V2 client and event streams](https://opencode.ai/v2/docs/build/client)
- [V2 API contract](https://opencode.ai/v2/openapi.json)
- [Windows power requests and Modern Standby limits](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powersetrequest)
