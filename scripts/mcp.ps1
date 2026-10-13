$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeVersion = (Get-Content (Join-Path $projectRoot '.node-version') -Raw).Trim()
if (-not $env:NVM_HOME) { throw 'NVM_HOME is missing.' }
$nodeExecutable = Join-Path $env:NVM_HOME ('v' + $nodeVersion + '\node.exe')
$entry = Join-Path $projectRoot 'apps\mcp\dist\main.js'
if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw ('Install Node ' + $nodeVersion + ' in nvm first.') }
if (-not (Test-Path -LiteralPath $entry)) { throw 'Build the project before starting MCP.' }
# Do not print anything to stdout: it is reserved for the MCP protocol.
& $nodeExecutable $entry
exit $LASTEXITCODE
