param([string]$Ref = 'main')
$ErrorActionPreference = 'Stop'
foreach ($command in @('node', 'npm', 'cargo')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Missing $command. Install Node.js 22+ with npm and Rust stable (including C++ build tools), then rerun." }
}
& node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or newer is required.' }
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('opencode-awake-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $archive = Join-Path $work 'source.zip'
    $url = 'https://api.github.com/repos/liubsp/opencode-awake/zipball/' + [uri]::EscapeDataString($Ref)
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $work 'source')
    $source = (Get-ChildItem -Directory (Join-Path $work 'source') | Select-Object -First 1).FullName
    Push-Location $source
    try {
        & npm ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed; existing installation remains active.' }
        & npm prune --omit=dev --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency preparation failed.' }
        & node scripts/install.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Setup failed.' }
    } finally { Pop-Location }
    $dataDir = if ($env:OPENCODE_AWAKE_INSTALL_DIR) { $env:OPENCODE_AWAKE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'opencode-awake' }
    $binDir = if ($env:OPENCODE_AWAKE_BIN_DIR) { $env:OPENCODE_AWAKE_BIN_DIR } else { Join-Path $dataDir 'bin' }
    $userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $binDir) {
        [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $binDir).TrimStart(';')), 'User')
    }
    if (($env:Path -split ';') -notcontains $binDir) { $env:Path += ';' + $binDir }
    Write-Host 'Ready: opencode-awake status | opencode-awake update | opencode-awake uninstall'
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
