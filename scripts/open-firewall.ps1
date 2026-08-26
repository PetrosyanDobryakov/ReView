# Run this once as Administrator (right-click PowerShell → Run as administrator)
# Allows LAN friends to reach ReView UI + sync while ping already works.

$ports = @(
  @{ Name = 'ReView UI 8080'; Port = 8080 },
  @{ Name = 'ReView Sync 1235'; Port = 1235 },
  @{ Name = 'ReView UI 5173'; Port = 5173 },
  @{ Name = 'ReView Sync 1234'; Port = 1234 }
)

foreach ($r in $ports) {
  netsh advfirewall firewall delete rule name="$($r.Name)" > $null 2>&1
  netsh advfirewall firewall add rule name="$($r.Name)" dir=in action=allow protocol=TCP localport=$($r.Port) profile=any
  if ($LASTEXITCODE -eq 0) { Write-Host "OK  TCP $($r.Port)  $($r.Name)" }
  else { Write-Host "FAIL TCP $($r.Port)"; exit 1 }
}

Write-Host ""
Write-Host "Friend should open:  http://<lan-ip>:8080"
Write-Host "Then on THEIR PC:    Test-NetConnection <lan-ip> -Port 8080"
