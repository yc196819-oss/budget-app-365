$dockerExe = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$root = 'C:\Users\user\Desktop\backoffice-cloud-saas'
if (!(Test-Path $dockerExe)) { Write-Output 'NO_DOCKER_EXE'; exit 1 }
Set-Location (Join-Path $root 'infra')
& $dockerExe compose up -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Set-Location $root
Get-Content '.\db\database.sql' | & $dockerExe exec -i daycare-postgres psql -U daycare_user -d daycare
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',"Set-Location '$root\backend'; if (!(Test-Path '.env') -and (Test-Path '.env.example')) { Copy-Item '.env.example' '.env' }; npm install; npm run seed; npm run dev"
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',"Set-Location '$root\frontend'; npm install; npm run dev"
Write-Output 'BACKOFFICE_START_TRIGGERED'
