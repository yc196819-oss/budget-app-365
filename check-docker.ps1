$dockerExe = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$desktopExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (!(Test-Path $dockerExe)) { Write-Output 'NO_DOCKER_EXE'; exit 1 }
if (Test-Path $desktopExe) {
  $running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Docker*' }
  if (-not $running) {
    Start-Process -FilePath $desktopExe
    Write-Output 'DOCKER_DESKTOP_STARTED'
  }
}
& $dockerExe --version
& $dockerExe compose version
