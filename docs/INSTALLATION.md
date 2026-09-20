# Installation

## Prerequisites

- OpenCode V2 (tested with 2.0.8).
- Node.js 22+, npm, and Rust stable.
- Windows 11: Visual Studio C++ Build Tools.
- macOS (Apple Silicon): Xcode command-line tools.

The installer builds from source. Windows 11 has been live-tested; macOS runtime validation is
pending. Rust and build tools are needed for installation and updates, not normal plugin use.

## One-command setup

Run from any directory.

**Windows · PowerShell**

```powershell
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/liubsp/opencode-awake/main/scripts/install.ps1').Content))
```

**macOS · Apple Silicon**

```sh
curl -fsSL https://raw.githubusercontent.com/liubsp/opencode-awake/main/scripts/install.sh | bash
```

Setup downloads the source to a temporary directory, builds it, installs the runtime, and
registers it in the global `~/.config/opencode/opencode.json(c)` (under `XDG_CONFIG_HOME` if set).
Existing settings, comments, plugin options, and unrelated plugin entries are preserved.
Modified config files receive a local `.opencode-awake.bak` backup. Existing global checkout
registrations for this package are migrated to the managed installation.

No Git checkout is required. OpenCode watches the updated configuration. If it doesn't reload,
let current work finish and run `opencode service restart`.

## Installed locations

| Platform | Runtime | Command |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\opencode-awake` | `opencode-awake.cmd` in the runtime's `bin` directory, added to your user PATH |
| macOS | `~/Library/Application Support/opencode-awake` | `~/.local/bin/opencode-awake` |

Windows setup also updates PATH for the current PowerShell process. Other open terminals may
need reopening. macOS setup adds the command directory to the login-shell profile when needed;
open a new terminal afterward. These are user-level changes; no administrator installation is needed.

## Status and updates

From any directory:

```sh
opencode-awake status
opencode-awake update
```

Updates run the installer again. Each build gets a separate runtime directory, so an existing
Windows helper doesn't lock the executable being installed. The existing plugin stays usable
while the replacement builds; the loader switches only after build completion. Older runtime
directories are retained for now and removed by uninstall.

You can also rerun the original one-command installer. Neither update method requires a checkout
or manual configuration edits. Per-project registrations outside the global config must be
removed separately when migrating from a manual installation.

## Uninstall

```sh
opencode-awake uninstall
```

This removes the managed global plugin registration and installation files. Other settings,
plugins, and configuration backups remain. OpenCode releases the helper when it reloads.
If files are still locked, the command reports that registration was removed and file cleanup
remains; remove those files after OpenCode reloads. The harmless PATH/profile entry can be removed
separately if desired.

## Development setup

Developers can still build from a checkout and register it manually:

```sh
npm ci
npm run build
```

Add the checkout's absolute path to `plugins` in a project or global `opencode.json(c)`.
For example, use `C:/path/to/opencode-awake` on Windows or `/path/to/opencode-awake` on macOS.
See [development](DEVELOPMENT.md) for tests and packaging.

For isolated installer checks, `OPENCODE_AWAKE_INSTALL_DIR`, `OPENCODE_AWAKE_CONFIG_DIR`, and
`OPENCODE_AWAKE_BIN_DIR` override the runtime, configuration, and command directories.
