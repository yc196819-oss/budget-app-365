$dockerExe = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
Set-Location 'C:\Users\user\Desktop\backoffice-cloud-saas\infra'
& $dockerExe compose up -d
