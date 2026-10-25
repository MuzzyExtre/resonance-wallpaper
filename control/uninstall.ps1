# Resonance Control — удаление помощника: останавливает, убирает из автозагрузки и удаляет файлы.
Get-Process ResonanceControl -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 400
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Resonance Control.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force }
$dir = Join-Path $env:LOCALAPPDATA 'ResonanceControl'
if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
Write-Host 'Помощник удалён / Helper removed'
