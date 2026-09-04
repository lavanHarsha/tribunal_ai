$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$line = Get-Content .env.local | Where-Object { $_ -match '^\s*GEMINI_API_KEY\s*=' } | Select-Object -First 1
$key = ($line -split '=', 2)[1].Trim()
Write-Output ("KEY starts with: " + $key.Substring(0, [Math]::Min(6, $key.Length)) + "   LENGTH: " + $key.Length)

Write-Output "`n=== A) IS THE KEY VALID? WHAT MODELS CAN IT USE? ==="
$raw = (curl.exe -s --max-time 30 -H "x-goog-api-key: $key" "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200") -join "`n"
try {
  $j = $raw | ConvertFrom-Json
  if ($j.models) {
    Write-Output "KEY IS VALID. Models this key can call:"
    $j.models | ForEach-Object { Write-Output ("  " + $_.name) }
  } else {
    Write-Output ("NO MODELS RETURNED -> " + $raw.Substring(0, [Math]::Min(700, $raw.Length)))
  }
} catch {
  Write-Output ("PARSE FAIL -> " + $raw.Substring(0, [Math]::Min(700, $raw.Length)))
}

Write-Output "`n=== B) EXACT GEMINI ERROR FOR THE CONFIGURED MODEL ==="
$cfgLine = Get-Content .env.local | Where-Object { $_ -match '^\s*GEMINI_MODEL\s*=' } | Select-Object -First 1
$model = 'gemini-2.5-flash'
if ($cfgLine) { $model = (($cfgLine -split '=', 2)[1]).Trim() }
Write-Output ("Testing model: " + $model)
'{"contents":[{"parts":[{"text":"Say hi"}]}]}' | Set-Content -Encoding ascii t_body.json
$resp = (curl.exe -s --max-time 30 -w "`nHTTP_CODE:%{http_code}" -H "x-goog-api-key: $key" -H "Content-Type: application/json" --data "@t_body.json" ("https://generativelanguage.googleapis.com/v1beta/models/" + $model + ":generateContent")) -join "`n"
Write-Output $resp.Substring(0, [Math]::Min(1200, $resp.Length))
