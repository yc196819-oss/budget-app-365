$dockerExe = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$deadline = (Get-Date).AddMinutes(4)
do {
  try {
    & $dockerExe info | Out-Null
    Write-Output 'DOCKER_READY'
    exit 0
  } catch {
    Write-Output 'WAITING_FOR_DOCKER'
    Start-Sleep -Seconds 5
  }
} while ((Get-Date) -lt $deadline)
Write-Output 'DOCKER_NOT_READY'
exit 1
