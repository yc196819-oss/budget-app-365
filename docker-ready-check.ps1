$desktopExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$dockerExe = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
if (Test-Path $desktopExe) { Start-Process -FilePath $desktopExe }
if (!(Test-Path $dockerExe)) { Write-Output 'NO_DOCKER_EXE'; exit 1 }
& $dockerExe --version
& $dockerExe compose version
& $dockerExe info
