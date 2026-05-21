$ErrorActionPreference = 'Stop'

$ExpectedScriptId = '1U-1UOlud99m4NHPdaSUoL9yz4GNV193NW9mhw2t8aB-ypx9AcvfsbNSd'
$handoverPath = Join-Path (Get-Location) 'Handover'

Write-Host '== Handover preflight =='
if (!(Test-Path -LiteralPath $handoverPath)) {
  Write-Error 'Handover folder not found.'
}

Set-Location -LiteralPath $handoverPath
Write-Host "pwd: $((Get-Location).Path)"
Write-Host "branch: $(git branch --show-current)"
Write-Host 'status:'
git status --short

$claspPath = Join-Path (Get-Location) '.clasp.json'
if (!(Test-Path -LiteralPath $claspPath)) {
  Write-Error 'Handover .clasp.json not found.'
}

$clasp = Get-Content -LiteralPath $claspPath -Raw | ConvertFrom-Json
Write-Host "clasp: $claspPath"
Write-Host "scriptId detected: $($clasp.scriptId)"
Write-Host "scriptId expected: $ExpectedScriptId"

if ($clasp.scriptId -ne $ExpectedScriptId) {
  Write-Error 'Wrong scriptId for Handover.'
}

Write-Host 'Handover preflight OK.'
