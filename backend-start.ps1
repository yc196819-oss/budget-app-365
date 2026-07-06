Set-Location 'C:\Users\user\Desktop\backoffice-cloud-saas\backend'
if (!(Test-Path '.env') -and (Test-Path '.env.example')) { Copy-Item '.env.example' '.env' }
npm install
npm run seed
npm run dev
