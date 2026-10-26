# Resonance Control — установка помощника для кнопок управления плеером в обоях Resonance.
# Компилирует ResonanceControl.cs и Station.cs встроенным в Windows компилятором C#, кладёт exe в
# %LOCALAPPDATA%\ResonanceControl, добавляет в автозагрузку и запускает.
$ErrorActionPreference = 'Stop'
$src = @((Join-Path $PSScriptRoot 'ResonanceControl.cs'), (Join-Path $PSScriptRoot 'Station.cs'))
$dir = Join-Path $env:LOCALAPPDATA 'ResonanceControl'
$exe = Join-Path $dir 'ResonanceControl.exe'

$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path (Join-Path $fw 'csc.exe'))) { $fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319' }
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path $csc)) { Write-Host 'Не найден компилятор C# (.NET Framework 4) / C# compiler not found'; exit 1 }

New-Item -ItemType Directory -Force $dir | Out-Null
Get-Process ResonanceControl -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 400

$common = @('/nologo', '/target:winexe', '/optimize+', '/codepage:65001', "/out:$exe", '/r:System.Web.Extensions.dll', '/r:System.Security.dll')

# с перемоткой (системный медиа-API Windows), а если не выйдет — без неё
$wm = Join-Path $env:WINDIR 'System32\WinMetadata'
$gac = Join-Path $env:WINDIR 'Microsoft.NET\assembly\GAC_MSIL\System.Runtime'
$sr = Get-ChildItem $gac -Recurse -Filter System.Runtime.dll -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$built = $false
if ($sr -and (Test-Path (Join-Path $wm 'Windows.Media.winmd'))) {
  & $csc @common /define:SMTC "/r:$wm\Windows.Media.winmd" "/r:$wm\Windows.Foundation.winmd" "/r:$sr" $src
  $built = ($LASTEXITCODE -eq 0)
}
if (-not $built) {
  & $csc @common $src
  if ($LASTEXITCODE -ne 0) { Write-Host 'Ошибка компиляции / Build failed'; exit 1 }
  Write-Host 'Собрано без перемотки / Built without seeking'
}

# автозапуск вместе с Windows
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Resonance Control.lnk'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $exe
$sc.WorkingDirectory = $dir
$sc.Description = 'Resonance: кнопки управления плеером в обоях'
$sc.Save()

Start-Process $exe
Write-Host ''
Write-Host 'Готово! Помощник запущен и будет стартовать вместе с Windows.'
Write-Host 'Done! The helper is running and will start with Windows.'
