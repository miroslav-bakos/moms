param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($Destination) -or (Test-Path $Destination)) { throw 'Supply a new absolute output directory.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $work | Out-Null
function Download-Pinned($Url, $File, $Hash) {
  Invoke-WebRequest -Uri $Url -OutFile $File
  if ((Get-FileHash -Algorithm SHA256 $File).Hash.ToLowerInvariant() -ne $Hash) { throw 'Runtime archive checksum mismatch.' }
}
try {
  Download-Pinned 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip' (Join-Path $work 'node.zip') '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71'
  Download-Pinned 'https://get.enterprisedb.com/postgresql/postgresql-16.15-1-windows-x64-binaries.zip' (Join-Path $work 'postgres.zip') '25e6fcdfb8caec38691bf461125e7564508760666f7b8e5dc6a5f0818f58f81e'
  Expand-Archive (Join-Path $work 'node.zip') (Join-Path $work 'node')
  Expand-Archive (Join-Path $work 'postgres.zip') (Join-Path $work 'postgres')
  New-Item -ItemType Directory -Path $Destination | Out-Null
  Copy-Item (Join-Path $work 'node/node-v22.23.3-win-x64/node.exe') (Join-Path $Destination 'node.exe')
  Copy-Item (Join-Path $work 'node/node-v22.23.3-win-x64/LICENSE') (Join-Path $Destination 'NODE-LICENSE')
  Copy-Item (Join-Path $work 'postgres/pgsql') (Join-Path $Destination 'postgresql') -Recurse
  Download-Pinned 'https://raw.githubusercontent.com/postgres/postgres/REL_16_15/COPYRIGHT' (Join-Path $Destination 'POSTGRESQL-LICENSE') '3d6af92ff8a4c2cdf69afb1cf44edea727922f5cd0cf8b5f72b11cdecac8fdfd'
  # EDB supplies the matching Microsoft C runtime alongside its Python distribution.
  foreach ($name in @('vcruntime140.dll','vcruntime140_1.dll')) {
    Copy-Item (Join-Path $Destination "postgresql/pgAdmin 4/python/$name") (Join-Path $Destination "postgresql/bin/$name")
  }
  Remove-Item (Join-Path $Destination 'postgresql/pgAdmin 4') -Recurse -Force
  Write-Output 'Prepared pinned Node 22.23.3 and PostgreSQL 16.15 Windows x64 runtimes.'
} finally { Remove-Item $work -Recurse -Force }
