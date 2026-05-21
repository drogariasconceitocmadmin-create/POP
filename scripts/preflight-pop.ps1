$ErrorActionPreference = 'Stop'

$ExpectedScriptId = '1aNJwuBlFksSAM3NhU6y1Jj6zU841239n59YXxnFAL6EXY7YjTr7lL8Y8'

Write-Host '== POP preflight =='
Write-Host "pwd: $((Get-Location).Path)"
Write-Host "branch: $(git branch --show-current)"
Write-Host 'status:'
git status --short

$claspPath = Join-Path (Get-Location) '.clasp.json'
if (!(Test-Path -LiteralPath $claspPath)) {
  Write-Error 'POP .clasp.json not found at repository root.'
}

$clasp = Get-Content -LiteralPath $claspPath -Raw | ConvertFrom-Json
Write-Host "clasp: $claspPath"
Write-Host "scriptId detected: $($clasp.scriptId)"
Write-Host "scriptId expected: $ExpectedScriptId"

if ($clasp.scriptId -ne $ExpectedScriptId) {
  Write-Error 'Wrong scriptId for Portal de POPs.'
}

Write-Host 'POP preflight OK.'
