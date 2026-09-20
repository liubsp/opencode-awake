# Installation

## Prerequisites

- OpenCode V2 (tested with 2.0.8).
- Node.js 22+, npm, and Rust stable.
- Windows: Visual Studio C++ Build Tools.
- macOS: Xcode command-line tools.

Windows x64 has been live-tested. macOS support is implemented, with runtime validation pending.

## Build from a checkout

```sh
npm ci
npm run build
```

The build creates the plugin and a helper for your machine's OS and architecture. Build on each
target machine; a Windows build doesn't include a macOS binary. The package isn't published to
npm yet, so installation currently uses a local checkout.

## Enable it for every project

Add the checkout to `plugins` in your global `~/.config/opencode/opencode.json(c)`, or the config
under `XDG_CONFIG_HOME` when set. Keep your other plugin entries.

**Windows**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["C:/path/to/opencode-awake"]
}
```

**macOS**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/path/to/opencode-awake"]
}
```

Use your actual absolute checkout path. OpenCode watches configuration changes. If the plugin
isn't picked up, let current work finish, then run `opencode service restart`.

## Enable it for one project

Use the same plugin entry in that project's `opencode.json(c)` instead of the global configuration.
Global installation is recommended for this plugin: it should be available whichever project
starts working. Each loaded instance observes the service-wide active-session state.

## Update

Let current work finish and temporarily disable the plugin before rebuilding. On Windows, a
running helper can keep its executable locked. Append `"-liubsp.opencode-awake"` after its entry
in `plugins`, let OpenCode unload it, then run:

```sh
npm ci
npm run build
```

Remove the disabling entry to load the rebuilt plugin. If configuration reload hasn't completed,
restart the service after current work finishes.

## Uninstall

Remove its entry from your global or project `opencode.json(c)` and reload affected locations.
Remove any separate project registrations too. When the last instance unloads, its helper exits
and releases its assertion. You can then delete the checkout.
