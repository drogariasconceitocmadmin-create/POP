$ErrorActionPreference = 'Stop'

$PopScriptId = '1aNJwuBlFksSAM3NhU6y1Jj6zU841239n59YXxnFAL6EXY7YjTr7lL8Y8'
$HandoverScriptId = '1U-1UOlud99m4NHPdaSUoL9yz4GNV193NW9mhw2t8aB-ypx9AcvfsbNSd'

param(
  [ValidateSet('pop', 'handover', 'auto')]
  [string]$Project = 'auto'
)

Write-Host '== clasp target check =='
Write-Host "pwd: $((Get-Location).Path)"

$claspPath = Join-Path (Get-Location) '.clasp.json'
if (!(Test-Path -LiteralPath $claspPath)) {
  Write-Error '.clasp.json not found in current directory.'
}

$clasp = Get-Content -LiteralPath $claspPath -Raw | ConvertFrom-Json
$detected = $clasp.scriptId

Write-Host "scriptId detected: $detected"
Write-Host "POP scriptId: $PopScriptId"
Write-Host "Handover scriptId: $HandoverScriptId"

if ($detected -eq $PopScriptId) {
  Write-Host 'target: POP'
  if ($Project -eq 'handover') { Write-Error 'Expected Handover, detected POP.' }
} elseif ($detected -eq $HandoverScriptId) {
  Write-Host 'target: Handover'
  if ($Project -eq 'pop') { Write-Error 'Expected POP, detected Handover.' }
} else {
  Write-Error 'Unknown scriptId. Stop before push/deploy.'
}
