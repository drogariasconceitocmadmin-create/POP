$ErrorActionPreference = 'Stop'

$MaxLines = 1500

Write-Host '== diff guard =='
git diff --stat

$numstat = git diff --numstat
$added = 0
$deleted = 0
foreach ($line in $numstat) {
  $parts = $line -split "`t"
  if ($parts.Length -lt 3) { continue }
  if ($parts[0] -match '^\d+$') { $added += [int]$parts[0] }
  if ($parts[1] -match '^\d+$') { $deleted += [int]$parts[1] }
}

Write-Host "added: $added"
Write-Host "deleted: $deleted"

if (($added + $deleted) -gt $MaxLines) {
  Write-Error "Diff exceeds $MaxLines lines. Stop and request authorization."
}

$deletedFiles = git diff --name-status | Where-Object { $_ -match '^D\s+' }
if ($deletedFiles) {
  Write-Error "Tracked file deletion detected:`n$($deletedFiles -join "`n")"
}

if (Test-Path -LiteralPath 'apps-script/Code.gs') {
  Write-Error 'Forbidden file detected: apps-script/Code.gs'
}

Write-Host 'Diff guard OK.'
