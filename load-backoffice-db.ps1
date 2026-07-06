$psqlContainer = 'daycare-postgres'
Set-Location 'C:\Users\user\Desktop\backoffice-cloud-saas'
Get-Content '.\db\database.sql' | docker exec -i $psqlContainer psql -U daycare_user -d daycare
