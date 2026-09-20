#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'This installer targets Apple Silicon macOS.' >&2
  exit 1
fi
for command in node npm cargo curl tar; do
  command -v "$command" >/dev/null || { echo "Missing $command. Install Node.js 22+, npm, Rust stable, and Xcode command-line tools first." >&2; exit 1; }
done
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
ref="${1:-main}"
work="$(mktemp -d "${TMPDIR:-/tmp}/opencode-awake-install.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir "$work/source"
curl -fsSL --retry 3 "https://api.github.com/repos/liubsp/opencode-awake/tarball/$ref" -o "$work/source.tar.gz"
tar -xzf "$work/source.tar.gz" -C "$work/source" --strip-components=1
(
  cd "$work/source"
  npm ci --ignore-scripts --no-audit --no-fund
  npm run build
  npm prune --omit=dev --ignore-scripts --no-audit --no-fund
  node scripts/install.mjs
)
bin_dir="${OPENCODE_AWAKE_BIN_DIR:-$HOME/.local/bin}"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    case "${SHELL:-/bin/zsh}" in
      */bash) profile="$HOME/.bash_profile" ;;
      *) profile="$HOME/.zprofile" ;;
    esac
    # Quote arbitrary installation paths for the shell; avoid duplicate profile entries.
    printf -v quoted '%q' "$bin_dir"
    line="export PATH=$quoted:\$PATH # opencode-awake"
    if ! grep -Fqx "$line" "$profile" 2>/dev/null; then printf '\n%s\n' "$line" >> "$profile"; fi
    echo 'Open a new terminal to use the opencode-awake command.'
    ;;
esac
echo 'Ready: opencode-awake status | opencode-awake update | opencode-awake uninstall'
