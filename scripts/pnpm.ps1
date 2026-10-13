param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CommandArguments
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeVersion = (Get-Content (Join-Path $projectRoot '.node-version') -Raw).Trim()
if (-not $env:NVM_HOME) { throw 'NVM_HOME is missing. Install nvm-windows first.' }
$runtimeDirectory = Join-Path $env:NVM_HOME ('v' + $nodeVersion)
$nodeExecutable = Join-Path $runtimeDirectory 'node.exe'
if (-not (Test-Path -LiteralPath $nodeExecutable)) {
    throw ('Run nvm install ' + $nodeVersion + ' first. This script does not change the global nvm selection.')
}
$originalPath = $env:PATH
try {
    # Only this process and its children use the project runtime.
    $env:PATH = $runtimeDirectory + ';' + $originalPath
    $toolchainDirectory = Join-Path $projectRoot '.cache\toolchain'
    $pnpmEntry = Join-Path $toolchainDirectory 'node_modules\pnpm\bin\pnpm.cjs'
    if (-not (Test-Path -LiteralPath $pnpmEntry)) {
        $npmEntry = Join-Path $runtimeDirectory 'node_modules\npm\bin\npm-cli.js'
        & $nodeExecutable $npmEntry install --prefix $toolchainDirectory pnpm@10.28.2 --registry=https://registry.npmjs.org/ --cache (Join-Path $projectRoot '.cache\npm') --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned pnpm toolchain.' }
    }
    Push-Location $projectRoot
    try {
        & $nodeExecutable $pnpmEntry @CommandArguments
        $commandExitCode = $LASTEXITCODE
    } finally { Pop-Location }
} finally { $env:PATH = $originalPath }
exit $commandExitCode
