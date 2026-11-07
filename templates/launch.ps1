# Manual Windows Intel launcher. No desktop/registry/execution-policy changes.
param(
    [ValidateSet('setup', 'start', 'stop', 'logs', 'check')]
    [string]$Action = 'start'
)
$ErrorActionPreference = 'Stop'
$team = '__TEAM__'
Set-Location $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install Docker Desktop first.' }
$engine = & docker info --format '{{.OSType}}/{{.Architecture}}' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop, then run the launcher again.' }
if ($engine -notin @('linux/amd64', 'linux/x86_64')) { throw 'This folder requires Windows Intel/AMD64 with Docker Linux containers (WSL2).' }
$versionText = & docker compose version --short
if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v?(\d+)\.(\d+)') { throw 'Docker Compose 2.30+ is required.' }
if ([int]$Matches[1] -lt 2 -or ([int]$Matches[1] -eq 2 -and [int]$Matches[2] -lt 30)) { throw 'Update Docker Desktop: Compose 2.30+ is required.' }
if (-not (Test-Path -LiteralPath 'credentials.env' -PathType Leaf)) { throw 'Missing credentials.env. Ask the organizer for the complete team folder.' }
$composeArgs = @('compose', '--env-file', (Join-Path $PSScriptRoot 'runtime.env'), '--file', (Join-Path $PSScriptRoot 'compose.yaml'), '--project-name', "smash-$team")
function Invoke-Compose([string[]]$Arguments) {
    & docker @composeArgs @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Docker operation failed; check the preceding status message. Configuration was not changed.' }
}
Invoke-Compose -Arguments @('config', '--quiet')
switch ($Action) {
    'setup' {
        Invoke-Compose -Arguments @('pull')
        Invoke-Compose -Arguments @('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', 'broker', 'validator')
        Write-Host 'Setup ready. Run: .\launch.ps1'
    }
    'start' {
        Invoke-Compose -Arguments @('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', 'broker', 'validator')
        Invoke-Compose -Arguments @('run', '--rm', '--no-deps', '--pull', 'never', 'agent')
    }
    'stop' { Invoke-Compose -Arguments @('down') } # Keep drafts and unpushed commits.
    'logs' { Invoke-Compose -Arguments @('logs', 'broker', 'validator') }
    'check' { Write-Host 'Team folder, Docker architecture, and Compose configuration are valid.' }
}
