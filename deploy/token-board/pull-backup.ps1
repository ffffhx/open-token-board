param(
  [string]$BackupHost = 'deploy@124.221.36.36',
  [string]$KeyFile = "$env:USERPROFILE\.ssh\id_rsa_tencent",
  [string]$Destination = "$env:USERPROFILE\Documents\Codex\Backups\open-token-board"
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $root | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $root /inheritance:r /grant:r "*${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict backup directory permissions' }
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-i', $KeyFile)
$latest = (& ssh @sshOptions $BackupHost 'cat /home/deploy/token-board-backups/latest').Trim()
if ($LASTEXITCODE -ne 0 -or $latest -notmatch '^/home/deploy/token-board-backups/token-board-[0-9]{8}T[0-9]{6}Z\.dump$') { throw 'Invalid remote backup manifest' }
$baseName = [IO.Path]::GetFileNameWithoutExtension($latest)
foreach ($suffix in @('.manifest.json', '.sha256')) {
  & scp @sshOptions "${BackupHost}:/home/deploy/token-board-backups/$baseName$suffix" $root
  if ($LASTEXITCODE -ne 0) { throw "Backup transfer failed: $suffix" }
}
$checksum = ((Get-Content -LiteralPath (Join-Path $root "$baseName.sha256") -Raw).Trim() -split '\s+')[0]
$dumpPath = Join-Path $root "$baseName.dump"
if (-not (Test-Path -LiteralPath $dumpPath) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $dumpPath).Hash -ne $checksum) {
  & scp @sshOptions "${BackupHost}:/home/deploy/token-board-backups/$baseName.dump" $root
  if ($LASTEXITCODE -ne 0) { throw 'Backup dump transfer failed' }
}
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root "$baseName.dump")).Hash
if ($actual -ne $checksum) { throw 'Off-host backup checksum mismatch' }
$cutoff = (Get-Date).AddDays(-30)
Get-ChildItem -LiteralPath $root -File | Where-Object { $_.Name -match '^token-board-[0-9]{8}T[0-9]{6}Z\.(dump|manifest\.json|sha256)$' -and $_.LastWriteTime -lt $cutoff -and -not $_.Name.StartsWith($baseName) } | ForEach-Object {
  $target = [IO.Path]::GetFullPath($_.FullName)
  if ([IO.Path]::GetDirectoryName($target) -ne $root.TrimEnd('\')) { throw 'Backup retention path escaped destination' }
  Remove-Item -LiteralPath $target
}
Set-Content -LiteralPath (Join-Path $root 'last-success.txt') -Value "$((Get-Date).ToUniversalTime().ToString('o')) $baseName SHA256 verified"
Write-Output "Off-host backup verified: $baseName"
