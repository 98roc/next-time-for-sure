<#
.SYNOPSIS
Build and upload production Docker images from Windows PowerShell 5.1.
.DESCRIPTION
Prepare configures the server without publishing business code. Check is read-only.
Validate builds images and tests them in temporary loopback-only containers, without migrations.
Deploy backs up the database, migrates, starts containers and checks readiness.
InitAdmin is an explicit, separate first-account operation.
#>
param(
    [ValidateSet('Prepare', 'Check', 'Validate', 'Deploy', 'InitAdmin')]
    [string]$Action = 'Deploy',
    [string]$Config = '.deploy.production.local',
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dependencyRoot = Join-Path $projectRoot '.cache\deploy-tools'
Push-Location $projectRoot
try {
    if (-not (Test-Path (Join-Path $dependencyRoot 'paramiko\__init__.py'))) {
        & $Python -m pip install --target $dependencyRoot 'paramiko==5.0.0' --disable-pip-version-check
        if ($LASTEXITCODE -ne 0) { throw 'Cannot install deployment SSH dependency.' }
    }
    & $Python scripts/deployment/deploy.py $Action --config $Config
    if ($LASTEXITCODE -ne 0) { throw 'Deployment command failed; see the preceding diagnostic.' }
} finally { Pop-Location }
