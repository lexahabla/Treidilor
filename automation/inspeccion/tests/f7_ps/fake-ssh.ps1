# SSH SIMULADO para probar el script V1-V8 en local. NO se conecta a nada. Estado en $env:TAI_FAKE_DIR (reloj virtual y limitador).
$d = $env:TAI_FAKE_DIR; $modo = $env:TAI_FAKE_MODO
$rf = Join-Path $d "reloj.txt"; $uf = Join-Path $d "ultimo.json"
$reloj = [double](Get-Content $rf) + 2
Set-Content $rf $reloj
$ultimo = @{}
if (Test-Path $uf) { $o = Get-Content $uf -Raw | ConvertFrom-Json; foreach ($p in $o.PSObject.Properties) { $ultimo[$p.Name] = [double]$p.Value } }
function Salir([int]$rc) { $h = @{}; foreach ($k in $ultimo.Keys) { $h[$k] = $ultimo[$k] }; ($h | ConvertTo-Json) | Set-Content $uf; exit $rc }
function Err([string]$t) { [Console]::Error.WriteLine($t) }
function Out([string]$t) { [Console]::Out.WriteLine($t) }
$a = @($args); $j = $a -join " "
$alias = "tai-inspect-vps"
if ($a -contains "admin-vps") {    # acceso de administrador SIMULADO (otro alias, por clave)
    if ($modo -eq "admin_falla") { Err "admin@203.0.113.9: Permission denied (publickey)."; Salir 255 }
    Out "TAI_ADMIN_OK"; Salir 0
}
$pos = [array]::IndexOf($a, $alias)
$cmd = $null; if ($pos -ge 0 -and ($pos + 1) -lt $a.Count) { $cmd = [string]$a[$pos + 1] }

if ($a -contains "-G") {
    if ($modo -eq "identidad_antigua") { Out "user tai-inspect"; Out "identityfile ~/.ssh/id_ed25519_tai_inspect"; Out "identitiesonly yes" }
    elseif ($modo -eq "sin_identitiesonly") { Out "user tai-inspect"; Out "identityfile ~/.ssh/tai-inspect_ed25519" }
    else { Out "hostname 203.0.113.9"; Out "user tai-inspect"; Out "identityfile ~/.ssh/tai-inspect_ed25519"; Out "identitiesonly yes" }
    Salir 0
}
if ($modo -eq "red_caida") { Err "ssh: connect to host 203.0.113.9 port 22: Connection timed out"; Salir 255 }
if ($modo -eq "clave_no_aceptada") { Err "tai-inspect@203.0.113.9: Permission denied (publickey)."; Salir 255 }

if ($j -match "PubkeyAuthentication=no") {
    if ($modo -eq "v6_red") { Err "ssh: connect to host 203.0.113.9 port 22: Connection refused"; Salir 255 }
    if ($modo -eq "password_ofrecida") { Err "debug1: Authentications that can continue: publickey,password" } else { Err "debug1: Authentications that can continue: publickey" }
    Err "tai-inspect@203.0.113.9: Permission denied (publickey)."
    Salir 255
}
if ($a -contains "-W") {
    if ($modo -eq "cuelga_W") { Start-Sleep -Seconds 90 }
    if ($modo -eq "v5_red") { Err "Connection reset by 203.0.113.9 port 22"; Salir 255 }
    if ($modo -eq "reenvio_permitido") { Out "SSH-2.0-OpenSSH_9.6"; Salir 0 }
    Err "debug1: Authenticated to 203.0.113.9 ([203.0.113.9]:22) using ""publickey""."
    Err "channel 0: open failed: administratively prohibited: open failed"
    Err "stdio forwarding failed"
    Salir 255
}
if ($a -contains "-tt") {
    # OpenSSH real: con -tt el rechazo del PTY es FATAL (RC=255) antes de ejecutar el comando
    if ($modo -eq "tt_red") { Err "Connection reset by 203.0.113.9 port 22"; Salir 255 }
    if ($modo -eq "tt_sin_auth") { Err "PTY allocation request failed on channel 0"; Salir 255 }
    if ($modo -eq "tt_con_salida") { Err "debug1: Authenticated to 203.0.113.9 ([203.0.113.9]:22) using ""publickey""."; Err "PTY allocation request failed on channel 0"; Out "orden no permitida"; Salir 255 }
    if ($modo -ne "pty_concedido") { Err "debug1: Authenticated to 203.0.113.9 ([203.0.113.9]:22) using ""publickey""."; Err "PTY allocation request failed on channel 0"; Salir 255 }
}
if (-not $cmd) {
    if ($modo -eq "shell_interactiva") { Out "uid=1001(tai-inspect) gid=1001"; Salir 0 }
    Out "orden no permitida"; Salir 2
}
if ($cmd -match '^solicitar (host-[a-z]+)$') {
    $c = $Matches[1]
    $int = 30; if ($c -eq "host-actualizaciones") { $int = 300 }
    $lim = $ultimo.ContainsKey($c) -and (($reloj - $ultimo[$c]) -lt $int)
    if ($modo -eq "limitador_roto") { $lim = $false }
    if ($lim) { Out "limite alcanzado"; Salir 7 }
    $ultimo[$c] = $reloj
    if ($modo -eq "json_roto") { Out "esto no es json"; Salir 0 }
    Out ('{"v":1,"check":"' + $c + '","avisos":[],"datos":{}}')
    Salir 0
}
if ($cmd -eq "solicitar docker-nodos") {
    if ($modo -eq "sensible_abierta") { Out '{"v":1,"check":"docker-nodos","avisos":[],"datos":{}}'; Salir 0 }
    Out "comprobacion no disponible"; Salir 2
}
if ($modo -eq "shell_en_orden" -and $cmd -eq "id") { Out "uid=0(root) gid=0(root)"; Salir 0 }
Out "orden no permitida"; Salir 2
