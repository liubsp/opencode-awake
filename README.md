# 🦀 OpenCode Awake

[![Rust](https://img.shields.io/badge/Built_with-Rust-000000?logo=rust)](https://www.rust-lang.org/)
[![OpenCode V2](https://img.shields.io/badge/Works_with-OpenCode_V2-18181B)](https://opencode.ai/)

Keep your machine awake while OpenCode works. Let the screen turn off normally.

It follows running sessions across projects and child agents, prevents automatic system sleep
while work is active, and releases its request when the last session finishes.

- **System sleep only**, with normal display timeout and screen locking.
- **Concurrent sessions and child agents**, tracked across the OpenCode service.
- **Automatic cleanup**, including owner-process exit and expired activity leases.
- **Native Rust helper** for Windows and macOS (Apple Silicon), connected through a V2 plugin.

## Install

Requires **OpenCode V2, Node.js 22+, npm, and Rust stable**, plus the platform's C++ build tools.
Tested with OpenCode 2.0.8 on Windows x64; macOS runtime validation is pending.

Clone the repository and build:

```sh
git clone https://github.com/liubsp/opencode-awake.git
cd opencode-awake
npm ci
npm run build
```

Add the checkout to `plugins` in your global `~/.config/opencode/opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["C:/path/to/opencode-awake"]
}
```

Replace the example with your checkout's absolute path; on macOS, use `/path/to/opencode-awake`.
Keep existing plugin entries, and use the config under `XDG_CONFIG_HOME` when set.
See [installation](docs/INSTALLATION.md) for per-project setup, updates, and removal.

## Use it

Start an OpenCode session as usual. The plugin manages sleep protection automatically, including
when you close the UI while the service keeps working.

To inspect running sessions and OS power requests, run from the checkout:

```sh
npm run status
```

See [usage and troubleshooting](docs/USAGE.md) for diagnostics and what counts as running.

## What to expect

The plugin protects the **machine hosting the OpenCode service**. It checks active sessions every
**two seconds**, responds to live events, and releases **one second** after the final idle snapshot.
If activity can't be verified, its last lease expires within **30 seconds**.

Permission waits follow OpenCode's active status. Detached processes after their session becomes
inactive aren't counted. Explicit sleep and lid-close policy remain controlled by the OS;
battery-powered Windows Modern Standby also has [power-request limits](docs/USAGE.md#os-behavior).

Defaults work without configuration. To adjust polling, release timing, diagnostics, or a custom
server connection, see [settings](docs/CONFIGURATION.md).

## Documentation

- [Installation, updates, and removal](docs/INSTALLATION.md)
- [Usage and troubleshooting](docs/USAGE.md)
- [Settings](docs/CONFIGURATION.md)
- [Development and architecture](docs/DEVELOPMENT.md)
- [Validation status](docs/VALIDATION.md)
