# Configuration

Defaults work without options. To customize the plugin, use the object form in OpenCode's
`plugins` array:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "C:/path/to/opencode-awake",
    "options": {
      "pollMs": 2000,
      "releaseDelayMs": 1000,
      "debug": false
    }
  }]
}
```

Use your actual checkout path and preserve other entries and settings.

| Option | Default | Meaning |
| --- | --- | --- |
| `pollMs` | `2000` | Active-session snapshot interval, 250–10000 milliseconds. Live events trigger earlier updates. |
| `releaseDelayMs` | `1000` | Final-release debounce, 0–5000 milliseconds, covering short workload handoffs. |
| `debug` | `false` | Emit plugin loading and native assertion transition messages. |
| `helperPath` | Bundled platform binary | Absolute path to an alternative protocol-v1 helper for this OS and architecture. |
| `serviceFile` | Standard OpenCode discovery | Absolute path to an alternative service registration file. |
| `serverUrl` | Discover local shared service | Explicit HTTP/HTTPS endpoint for a standalone/custom server. |
| `authorizationEnv` | None | With `serverUrl`, the name of an environment variable containing the complete Authorization header. |

## Standalone and custom servers

The plugin normally discovers and authenticates with the existing local shared service. For a
standalone/custom server, provide its own reachable `serverUrl` and, if needed, `authorizationEnv`.
Alternatively, use `serviceFile` for a different service registration file.

Every snapshot checks that the server PID matches the process hosting the plugin. A plugin
running in a standalone server cannot observe the shared service by mistake. Discovery never
starts a new service.

For details about the V2.0.8 API limitation requiring this connection, see
[connection internals](DEVELOPMENT.md#connection-options).
