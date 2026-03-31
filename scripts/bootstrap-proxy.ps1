$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$proxyPort = 8317
$proxyDir = Join-Path $root "proxy"
$proxyExe = Join-Path $proxyDir "cli-proxy-api.exe"
$proxyCfgTemplate = Join-Path $proxyDir "config.yaml"
$proxyCfgRuntime = Join-Path $proxyDir "config.runtime.yaml"
$proxyAuthDir = Join-Path $proxyDir "auth"
$envFile = Join-Path $root ".env"
$envExampleFile = Join-Path $root ".env.example"
$configFile = Join-Path $root "config.json"
$configExampleFile = Join-Path $root "config.example.json"
$nodeModulesDir = Join-Path $root "node_modules"
$packageJson = Join-Path $root "package.json"
$packageLock = Join-Path $root "package-lock.json"
$cacheDir = Join-Path $root ".cache"
$depsStampFile = Join-Path $cacheDir "npm-lock.sha256"

function Write-Info {
  param([string]$Message)
  Write-Host "[ghost-overlay] $Message"
}

function Read-EnvValue {
  param(
    [string]$Path,
    [string]$Key
  )
  if (-not (Test-Path $Path)) { return $null }
  $line = Get-Content -Encoding UTF8 $Path | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  $v = ($line -split "=", 2)[1].Trim()
  if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
    $v = $v.Substring(1, $v.Length - 2)
  }
  return $v
}

function Ensure-ConfigFile {
  if (Test-Path $configFile) { return }
  if (-not (Test-Path $configExampleFile)) {
    Write-Info "WARNING: config.example.json not found. config.json was not created."
    return
  }
  Copy-Item -Path $configExampleFile -Destination $configFile -Force
  Write-Info "Created config.json from config.example.json."
}

function Ensure-EnvAndToken {
  if (-not (Test-Path $envFile)) {
    Write-Info "ERROR: Файл .env не найден."
    Write-Info "Создайте .env на основе .env.example, заполните ключи и повторите запуск."
    if (Test-Path $envExampleFile) {
      Write-Info "Шаблон: $envExampleFile"
    }
    exit 2
  }

  $token = Read-EnvValue -Path $envFile -Key "CLAUDE_CODE_SETUP_TOKEN"
  if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Info "ERROR: В .env отсутствует CLAUDE_CODE_SETUP_TOKEN."
    Write-Info "Заполните .env по шаблону .env.example и повторите запуск."
    exit 2
  }
  return $token
}

function Ensure-NpmDependencies {
  if (-not (Test-Path $packageJson)) {
    Write-Info "WARNING: package.json not found, skipping npm dependency check."
    return
  }

  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($null -eq $npm) {
    Write-Info "ERROR: npm не найден в PATH. Установите Node.js и повторите запуск."
    exit 3
  }

  $needInstall = $false
  if (-not (Test-Path $nodeModulesDir)) {
    $needInstall = $true
    Write-Info "node_modules not found, installing dependencies..."
  } elseif (Test-Path $packageLock) {
    $lockHash = (Get-FileHash -Path $packageLock -Algorithm SHA256).Hash
    $savedHash = $null
    if (Test-Path $depsStampFile) {
      $savedHash = (Get-Content -Path $depsStampFile -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    }
    if ([string]::IsNullOrWhiteSpace($savedHash) -or $savedHash -ne $lockHash) {
      $needInstall = $true
      Write-Info "Dependency lock changed, reinstalling npm dependencies..."
    }
  }

  if (-not $needInstall) {
    Write-Info "Node dependencies are up to date."
    return
  }

  if (-not (Test-Path $cacheDir)) {
    New-Item -Path $cacheDir -ItemType Directory -Force | Out-Null
  }

  Push-Location $root
  try {
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed with exit code $LASTEXITCODE"
    }

    if (Test-Path $packageLock) {
      $newHash = (Get-FileHash -Path $packageLock -Algorithm SHA256).Hash
      Set-Content -Path $depsStampFile -Value $newHash -Encoding UTF8
    }
  } finally {
    Pop-Location
  }
}

function Build-RuntimeProxyConfig {
  param([string]$Token)
  if (-not (Test-Path $proxyCfgTemplate)) { return }
  if ([string]::IsNullOrWhiteSpace($Token)) { return }

  $lines = [System.Collections.Generic.List[string]](Get-Content -Encoding UTF8 $proxyCfgTemplate)
  $inApiKeys = $false
  $updated = $false

  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*api-keys\s*:\s*$') {
      $inApiKeys = $true
      continue
    }
    if ($inApiKeys -and $lines[$i] -match '^\s*-\s*".*"\s*$') {
      $lines[$i] = "  - `"$Token`""
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $lines.Add("")
    $lines.Add("api-keys:")
    $lines.Add("  - `"$Token`"")
  }

  Set-Content -Encoding UTF8 $proxyCfgRuntime $lines
}

function Test-ClaudeAuthPayload {
  param([object]$Obj)

  if ($null -eq $Obj) { return $false }

  $props = @($Obj.PSObject.Properties.Name)
  if ($props -contains "claudeAiOauth") {
    $oauth = $Obj.claudeAiOauth
    if ($oauth -and $oauth.accessToken -and $oauth.refreshToken) {
      return $true
    }
  }

  if (($props -contains "access_token") -and ($props -contains "refresh_token")) {
    return $true
  }

  return $false
}

function Has-ClaudeAuthArtifacts {
  if (-not (Test-Path $proxyAuthDir)) { return $false }
  $files = Get-ChildItem -Path $proxyAuthDir -Filter "*.json" -File -ErrorAction SilentlyContinue
  return ($files -and $files.Count -gt 0)
}

function Try-ImportClaudeAuthArtifacts {
  if (-not (Test-Path $proxyAuthDir)) {
    New-Item -Path $proxyAuthDir -ItemType Directory -Force | Out-Null
  }

  if (Has-ClaudeAuthArtifacts) {
    Write-Info "Claude auth artifacts already present in proxy/auth."
    return
  }

  Write-Info "proxy/auth is empty. Scanning project directory for Claude auth artifacts..."
  $skipPattern = '\\(node_modules|\.git|proxy\\auth|proxy\\static|dist|build|out|coverage)\\'
  $candidates = Get-ChildItem -Path $root -Recurse -File -Filter *.json -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'claude' -and $_.FullName -notmatch $skipPattern }

  $validFiles = @()
  foreach ($file in $candidates) {
    try {
      $raw = Get-Content -Path $file.FullName -Raw -Encoding UTF8
      if ([string]::IsNullOrWhiteSpace($raw)) { continue }
      $json = $raw | ConvertFrom-Json -ErrorAction Stop
      if (Test-ClaudeAuthPayload -Obj $json) {
        $validFiles += $file
      }
    } catch {
      continue
    }
  }

  if ($validFiles.Count -eq 0) {
    Write-Info "WARNING: Claude auth artifacts were not found automatically."
    Write-Info "Add claude auth json files to proxy/auth (example: claude.json, claude-<email>.json)."
    return
  }

  foreach ($file in $validFiles) {
    $dest = Join-Path $proxyAuthDir $file.Name
    if (-not (Test-Path $dest)) {
      Copy-Item -Path $file.FullName -Destination $dest -Force
    }
  }

  Write-Info "Imported $($validFiles.Count) Claude auth artifact(s) into proxy/auth."
}

function Start-LocalProxy {
  if (-not (Test-Path $proxyCfgRuntime)) {
    Write-Info "WARNING: runtime proxy config not found: $proxyCfgRuntime"
    return
  }
  Write-Info "Starting local proxy..."
  Start-Process -FilePath $proxyExe -ArgumentList "--config", "config.runtime.yaml" -WorkingDirectory $proxyDir -WindowStyle Minimized | Out-Null
  Start-Sleep -Seconds 2
}

function Ensure-ProxyIsRunning {
  if (-not (Test-Path $proxyExe)) {
    Write-Info "WARNING: proxy runtime not found at $proxyExe"
    return
  }

  $listener = Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $listener) {
    Start-LocalProxy
    return
  }

  $ownerPid = $listener.OwningProcess
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
  $procExe = $proc.ExecutablePath
  $procCmd = $proc.CommandLine

  if (
    $procExe -and
    (($procExe.ToLower()) -eq ($proxyExe.ToLower())) -and
    $procCmd -and
    ($procCmd.ToLower().Contains("config.runtime.yaml"))
  ) {
    Write-Info "Local proxy already listening on port $proxyPort."
    return
  }

  Write-Info "Port $proxyPort is occupied by another process/config. Restarting local proxy..."
  try {
    Stop-Process -Id $ownerPid -Force -ErrorAction Stop
    Start-Sleep -Seconds 1
  } catch {
    Write-Info "WARNING: failed to stop PID $ownerPid. $_"
  }

  Start-LocalProxy
}

Ensure-ConfigFile
$token = Ensure-EnvAndToken
Ensure-NpmDependencies
Try-ImportClaudeAuthArtifacts
Build-RuntimeProxyConfig -Token $token
Ensure-ProxyIsRunning
