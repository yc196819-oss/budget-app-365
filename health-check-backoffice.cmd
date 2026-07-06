@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Invoke-WebRequest -UseBasicParsing http://localhost:3000/health -TimeoutSec 5).StatusCode } catch { $_.Exception.Message }; try { (Invoke-WebRequest -UseBasicParsing http://localhost:5173 -TimeoutSec 5).StatusCode } catch { $_.Exception.Message }"
