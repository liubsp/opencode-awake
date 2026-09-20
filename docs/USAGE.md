# Usage and troubleshooting

## Normal operation

Start an OpenCode session as usual. The plugin watches the service's running sessions and manages
its power request automatically. Closing the UI doesn't release protection while the service
still has work running.

To inspect the local service and OS power requests, run from the checkout:

```sh
npm run status
```

It shows the active-session count, then invokes `powercfg /requests` on Windows or
`pmset -g assertions` on macOS. The OS report includes other applications' requests too.
Windows may require an elevated terminal for this diagnostic; the plugin itself doesn't.

## What counts as running?

OpenCode's `/api/session/active` is the source of truth. Concurrent sessions, child sessions,
and retries remain protected while OpenCode reports their execution as active. Open idle tabs
and saved session history don't keep the machine awake.

Permission and question waits follow that same status. V2 doesn't expose a distinct fully-blocked
state, and a pending question doesn't prove that all concurrent work has stopped.
Detached shell processes after their session becomes inactive, persistent development servers,
and auxiliary generation outside an active session aren't counted.

This protects the machine **hosting the OpenCode service**. Connecting a laptop to a remote
server doesn't keep the laptop awake.

## OS behavior

The request prevents automatic idle sleep while allowing normal display timeout and screen
locking. Explicit sleep, lid-close policy, and critical battery behavior remain governed by the OS.

On battery-powered Windows Modern Standby systems, Microsoft documents termination of
system/execution power requests after the system sleep timeout plus five minutes. Validate
long unattended battery runs on your target hardware; a power request isn't a universal override.
See [Microsoft's power-request documentation](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powersetrequest).

## If something gets stuck

| Symptom | What to check |
| --- | --- |
| Plugin doesn't load | Run `npm run build` and check that the configured path points to the checkout containing `index.js`. |
| Missing native helper | Build on the target machine, or set an absolute `helperPath` for its OS and architecture. |
| Active-session snapshot unavailable | Check `opencode service status`. Standalone/custom servers need their own connection options. |
| A different server was discovered | Configure `serverUrl` or `serviceFile` for the plugin's actual host process. |
| Sleep remains inhibited after work ends | Check `npm run status` for other sessions or applications holding power requests. |
| `powercfg /requests` reports access denied | Run the diagnostic from an elevated terminal. |

Set `debug` to `true` to emit plugin loading and native assertion transition messages. See
[configuration](CONFIGURATION.md) for all options.

Snapshot failures don't renew old leases. The helper releases within 30 seconds of its last
valid renewal, and protection resumes when activity can be verified again. Separate plugin
instances have independent leases; unloading one doesn't release another's request.

For test coverage and physical screen-off/sleep checks, see [validation](VALIDATION.md).
