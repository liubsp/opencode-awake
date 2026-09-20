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
Tested with OpenCode 2.0.8 on Windows 11; macOS runtime validation is pending.

**Windows · PowerShell**

```powershell
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/liubsp/opencode-awake/main/scripts/install.ps1').Content))
```

**macOS · Apple Silicon**

```sh
curl -fsSL https://raw.githubusercontent.com/liubsp/opencode-awake/main/scripts/install.sh | bash
```

Setup builds and installs into your user-data directory, registers the plugin globally, and adds
the `opencode-awake` command. No checkout or JSON editing needed. On macOS, open a new terminal
after setup. See [installation](docs/INSTALLATION.md) for updates and removal.

## Use it

Start an OpenCode session as usual. The plugin manages sleep protection automatically, including
when you close the UI while the service keeps working.

Use the installed command from any directory:

```sh
opencode-awake status
opencode-awake update
opencode-awake uninstall
```

See [usage and troubleshooting](docs/USAGE.md) for diagnostics and what counts as running.

## What to expect

The plugin protects the **machine hosting the OpenCode service**. It checks active sessions every
**minute** as recovery, responds to live events, and releases **one second** after the final idle snapshot.
If activity can't be verified, its last lease expires within **three minutes**.

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
