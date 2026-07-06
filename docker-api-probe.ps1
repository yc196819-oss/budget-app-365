$d = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$versions = '1.55','1.54','1.53','1.52','1.51','1.50','1.49','1.48','1.47','1.46','1.45','1.44'
foreach($v in $versions){
  Write-Output ('TRY ' + $v)
  $env:DOCKER_API_VERSION = $v
  & $d version
  if($LASTEXITCODE -eq 0){ Write-Output ('OK ' + $v); exit 0 }
}
exit 1
