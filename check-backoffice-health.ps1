try {
  $backend = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/health' -TimeoutSec 5
  Write-Output ('BACKEND:' + $backend.StatusCode)
} catch {
  Write-Output ('BACKEND_ERR:' + $_.Exception.Message)
}
try {
  $frontend = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173' -TimeoutSec 5
  Write-Output ('FRONTEND:' + $frontend.StatusCode)
} catch {
  Write-Output ('FRONTEND_ERR:' + $_.Exception.Message)
}
