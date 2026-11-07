param(
    [ValidateSet('team_a', 'team_b', 'team_c', 'team_d')]
    [string]$Team = 'team_a',
    [string]$EnvFile = '.env'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:ENV_FILE = $EnvFile
$env:EVENT_TEAM_ID = $Team
$project = "smash-$Team"

docker compose --env-file $EnvFile --project-name $project up -d --wait broker validator
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose --env-file $EnvFile --project-name $project run --rm --no-deps agent
exit $LASTEXITCODE
