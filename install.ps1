# SalesBoard one-command install (Windows PowerShell).
#   powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'
$RepoUrl = if ($env:SALESBOARD_REPO) { $env:SALESBOARD_REPO } else { 'https://github.com/tidewaterrepair-code/sales-board.git' }
$TargetDir = if ($env:SALESBOARD_DIR) { $env:SALESBOARD_DIR } else { Join-Path $HOME 'sales-board' }

function Say($m) { Write-Host "`n> $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

Write-Host 'SalesBoard installer'

# 1. Get the code
$here = Test-Path 'package.json' -PathType Leaf
if ($here -and (Select-String -Path 'package.json' -Pattern '"name": "sales-board"' -Quiet)) {
  Ok "Using this folder: $(Get-Location)"
} else {
  if (-not (Has git)) { Say 'Installing Git'; winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements; Refresh-Path }
  Say "Downloading SalesBoard to $TargetDir"
  if (Test-Path (Join-Path $TargetDir '.git')) { git -C $TargetDir pull --ff-only } else { git clone $RepoUrl $TargetDir }
  Set-Location $TargetDir
}

# 2. Node.js 20+
$nodeOk = $false
if (Has node) { $nodeOk = [int](node -p "process.versions.node.split('.')[0]") -ge 20 }
if (-not $nodeOk) {
  Say 'Installing Node.js LTS'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Refresh-Path
}
if (-not (Has node)) { throw 'Node.js is required. Install it from https://nodejs.org and run this again.' }
Ok "Node.js $(node -v)"

# 3. Settings
Say 'Setting up your keys (press Enter to skip any of them)'
node scripts/setup.js
New-Item -ItemType Directory -Force -Path data | Out-Null

# 4. Self-check + start
Say 'Running a quick self-check'
npm test --silent | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Self-check failed. Run 'npm test' to see why." }
Ok 'All checks passed'
$port = (Select-String -Path .env -Pattern '^PORT=(.*)$' | ForEach-Object { $_.Matches[0].Groups[1].Value }) ; if (-not $port) { $port = 3000 }
Say "Starting SalesBoard -> http://localhost:$port  (Ctrl+C to stop, 'npm start' to start again)"
Start-Process "http://localhost:$port"
node server.js
