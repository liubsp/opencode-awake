# Validation

## Current status

Verified for **Windows 11 with OpenCode 2.0.8**:

- Release build and TypeScript checks.
- TypeScript/Node tests, including real Windows power-request acquisition, installer lifecycle, and cleanup.
- 3 Rust unit tests for independent lease accounting and expiry.
- Rust formatting and Clippy with warnings treated as errors.
- Installed-tarball smoke test, including its bundled native helper.
- Two temporary locations loaded into the real OpenCode service, sharing one native helper.
- Unloading the first location preserved the second; final unload terminated the helper.

The macOS implementation and CI jobs are present, but **macOS runtime validation is pending**.
The workflow targets Windows and Apple Silicon macOS; adding the workflow is not evidence that
those remote jobs passed.

Actual screen-off and idle-sleep timeout behavior still requires hardware testing. Native API
acquisition passed without elevation; verification using the Windows `powercfg /requests`
listing remains pending. That diagnostic may require elevation.

## Automated tests

```sh
npm run build
npm run check
npm test
npm run test:native
npm run test:package
cargo fmt --manifest-path native/Cargo.toml --check
cargo clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
```

Coverage includes:

- Startup with sessions already running.
- Overlapping parent/child sessions and independent completion.
- Stale snapshots racing with a new session start.
- Parent/child handoff during release debounce.
- Failed snapshots without indefinite stale lease renewal.
- Reconnection after a missed completion event.
- Cancellation, terminal error, and unload during an in-flight request.
- Native lease expiry and invalid protocol input.
- Multiple plugin owners sharing a helper.
- Abrupt owner-process death and helper exit on stdin closure.
- Authenticated snapshots and rejecting a different server PID.

## Live-service integration

With an existing local service running:

```sh
npm run test:service
```

This check creates two temporary project configurations and non-executing test sessions. It
verifies plugin loading in the actual V2 host, helper process ownership, independent location
unload, and final cleanup. It does not invoke a model or edit global configuration. Its temporary
sessions, configurations, and helpers are removed afterward.

Run it while another session is working to exercise native helper startup. It also prints the
OS assertion report when permissions allow; that report includes other applications' requests.

## Hardware acceptance checks

On a test machine, temporarily use short display/sleep timeouts and start two overlapping
OpenCode sessions longer than both timeouts:

1. Confirm the display turns off while the system continues working.
2. Complete one session and confirm the other stays protected.
3. Finish or cancel the last session and confirm the plugin's assertion disappears promptly.
4. Confirm normal idle sleep resumes, subject to other applications' assertions.
5. Force-terminate a test OpenCode host and confirm its helper exits and its assertion disappears.
6. Repeat after plugin reload, a stream disconnect, and service restart.

Check `powercfg /requests` on Windows for a SYSTEM request without a DISPLAY request attributable
to this helper. On macOS, use `pmset -g assertions` to inspect its idle-system-sleep assertion.
Test on AC and battery, including Windows Modern Standby where applicable. Restore the original
timeout settings afterward.

Explicit user sleep, lid-close behavior, and critical battery policy are controlled by the OS.
Microsoft documents a battery-powered Modern Standby limit of the system sleep timeout plus five
minutes for system/execution power requests; validate unattended runs against that limitation.
