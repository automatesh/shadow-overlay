$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$proxyPort = 8317
$proxyDir = Join-Path $root "proxy"
$proxyExe = Join-Path $proxyDir "cli-proxy-api.exe"
$proxyCfgTemplate = Join-Path $proxyDir "config.yaml"
$proxyCfgRuntime = Join-Path $proxyDir "config.runtime.yaml"
$proxyAuthDir = Join-Path $proxyDir "auth"
$envFile = Join-Path $root ".env"

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

function Build-RuntimeProxyConfig {
  param(
    [string]$TemplatePath,
    [string]$RuntimePath,
    [string]$Token
  )
  if (-not (Test-Path $TemplatePath)) { return }
  if ([string]::IsNullOrWhiteSpace($Token)) { return }

  $lines = [System.Collections.Generic.List[string]](Get-Content -Encoding UTF8 $TemplatePath)
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

  Set-Content -Encoding UTF8 $RuntimePath $lines
}

function Has-ClaudeAuthArtifacts {
  param(
    [string]$AuthDir
  )
  if (-not (Test-Path $AuthDir)) { return $false }
  $files = Get-ChildItem -Path $AuthDir -Filter "*.json" -File -ErrorAction SilentlyContinue
  return ($files -and $files.Count -gt 0)
}

function Start-LocalProxy {
  if (-not (Test-Path $proxyCfgRuntime)) {
    Write-Host "[ghost-overlay] WARNING: runtime proxy config not found: $proxyCfgRuntime"
    return
  }
  Write-Host "[ghost-overlay] Starting local proxy..."
  Start-Process -FilePath $proxyExe -ArgumentList "--config", "config.runtime.yaml" -WorkingDirectory $proxyDir -WindowStyle Minimized | Out-Null
  Start-Sleep -Seconds 2
}

if (-not (Test-Path $proxyExe)) {
  Write-Host "[ghost-overlay] WARNING: proxy runtime not found at $proxyExe"
  exit 0
}

$token = Read-EnvValue -Path $envFile -Key "CLAUDE_CODE_SETUP_TOKEN"
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Host "[ghost-overlay] WARNING: CLAUDE_CODE_SETUP_TOKEN is empty in .env"
  exit 0
}

Build-RuntimeProxyConfig -TemplatePath $proxyCfgTemplate -RuntimePath $proxyCfgRuntime -Token $token

if (-not (Has-ClaudeAuthArtifacts -AuthDir $proxyAuthDir)) {
  Write-Host "[ghost-overlay] WARNING: proxy/auth has no *.json auth artifacts."
  Write-Host "[ghost-overlay] Add Claude auth files to proxy/auth (for example: claude.json and claude-<email>.json)."
}

$listener = Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $listener) {
  Start-LocalProxy
  exit 0
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
  Write-Host "[ghost-overlay] Local proxy already listening on port $proxyPort."
  exit 0
}

Write-Host "[ghost-overlay] Port $proxyPort is occupied by another process/config. Restarting local proxy..."
try {
  Stop-Process -Id $ownerPid -Force -ErrorAction Stop
  Start-Sleep -Seconds 1
} catch {
  Write-Host "[ghost-overlay] WARNING: failed to stop PID $ownerPid. $_"
}

Start-LocalProxy
