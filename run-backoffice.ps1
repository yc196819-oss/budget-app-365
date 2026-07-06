Set-Location 'C:\Users\user\Desktop\backoffice-cloud-saas\backend'
if (!(Test-Path '.env') -and (Test-Path '.env.example')) { Copy-Item '.env.example' '.env' }
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','Set-Location ''C:\Users\user\Desktop\backoffice-cloud-saas\backend''; npm install; npm run seed; npm run dev' -WindowStyle Normal
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','Set-Location ''C:\Users\user\Desktop\backoffice-cloud-saas\frontend''; npm install; npm run dev' -WindowStyle Normal
