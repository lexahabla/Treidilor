# F7-Validacion-Windows.ps1 - V0-V8 de F7 desde Windows PowerShell 5.1 (solo ASCII). Alias SSH: tai-inspect-vps; clave dedicada ~/.ssh/tai-inspect_ed25519.
# Cuerpo IDENTICO al script de la seccion 8.1 de automation/docs/INSPECCION-ETAPA-2-PLAN.md (una prueba lo comprueba); solo cambian las variables de entrada, que aqui son parametros.
# Ejecuta SOLO `ssh` (cada llamada ACOTADA en tiempo, con la entrada cerrada y el arbol de procesos eliminado si excede su tiempo) y UNA consulta HTTPS de lectura a /api/health.
# NO modifica el servidor, NO cancela NI AUTORIZA CANCELAR la reversion, NO rearma, NO despliega. Solo informa. La cancelacion se decide en la consola con su puerta (plan F7, paso 5).
# Uso: powershell.exe -NoProfile -ExecutionPolicy Bypass -File <ruta> -VenceUtc '2026-11-14T12:30:05Z'
[CmdletBinding()]
param(
    # OBLIGATORIO: VENCE_UTC que imprimio la consola del VPS al armar la reversion (solo si dijo VENCIMIENTO_VERIFICADO). Ej.: 2026-11-14T12:30:05Z
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')]
    [string]$VenceUtc,
    # OBLIGATORIOS: id y clave de ESTA activacion que imprime `sh /root/tai-etapa2/f7-vps.sh activar` en la consola del VPS.
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$')]
    [string]$IdActivacion,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{32}$')]
    [string]$SecretoActivacion,
    [string]$AliasAdmin = "",  # opcional: alias SSH del administrador habitual (acceso por clave, BatchMode), independiente de tai-inspect
    [string]$Dominio = "treidilor.com",
    [string]$SourceHashEsperado = "0885734050b5c946c3eb22e328120eea080d7a68adb17a1c10816da0f15c7487",
    [string]$HuellaClave = "SHA256:OW0d/GCWjasNxmoh7RWafXSFQZvvYt7nNIgtHXVpQtU",   # huella REAL de /etc/ssh/authorized_keys.tai-inspect (comprobada en el VPS)
    [int]$Esperas = 35,        # s: reintento y V2b (limitador de 30 s)
    [int]$MaxSsh = 25,         # s maximos de CADA llamada a ssh
    [int]$MargenS = 90,        # s minimos que deben quedar hasta el vencimiento de la reversion
    [string]$SshExe = "",      # solo para pruebas locales con un ssh simulado
    [string[]]$SshPrefijo = @()
)
$Alias = "tai-inspect-vps"
if (-not (Test-Path function:AhoraUtc)) { function AhoraUtc { return (Get-Date).ToUniversalTime() } }
if (-not (Test-Path function:Dormir)) { function Dormir([int]$s) { Start-Sleep -Seconds $s } }
$ErrorActionPreference = "Continue"
$inicio = Get-Date
$ok = 0; $ko = 0; $abortado = $false
$omitidas = @(); $hijos = @()
$estadoAdmin = "NO_PROBADO"

function Marca { return ("{0:mm\:ss}" -f ((Get-Date) - $inicio)) }
function VenceDe([string]$t) { return [datetime]::ParseExact($t, "yyyy-MM-ddTHH:mm:ssZ", [Globalization.CultureInfo]::InvariantCulture, ([Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)) }
function Restante { return [int](((VenceDe $VenceUtc) - (AhoraUtc)).TotalSeconds) }
function Margen([string]$donde) {
    $r = Restante
    if ($r -lt $MargenS) { throw "reversion inminente (quedan $r s antes de $donde; minimo $MargenS s): NO se rearma: NO cancelar; reversion manual segura o dejar vencer la automatica" }
}
function Control([string]$etapa) {
    $r = Restante
    "   [tiempo] antes de $etapa : quedan $r s para el vencimiento REAL de la reversion (minimo exigido $MargenS s)"
    Margen $etapa
}
function Espera([int]$s) {
    if ((Restante) - $s -lt $MargenS) { throw "no hay tiempo para esperar $s s (quedan $(Restante) s): NO se rearma; reversion manual segura o dejar vencer la automatica" }
    Dormir $s
}
function Q([string]$s) { if ($s -eq "" -or $s -match '[\s";]') { return '"' + ($s -replace '"', '\"') + '"' } else { return $s } }
function Ejecutar([string[]]$arg, [int]$seg) {
    $exe = $SshExe
    if ($exe -eq "") {
        $c = Get-Command ssh.exe -ErrorAction SilentlyContinue
        if (-not $c) { return [pscustomobject]@{ Rc = -1; Out = ""; Err = "ssh.exe no encontrado"; TimedOut = $false } }
        $exe = $c.Source
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = ((@($SshPrefijo) + @($arg)) | ForEach-Object { Q $_ }) -join " "
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $script:hijos += $p.Id
    $p.StandardInput.Close()
    $tOut = $p.StandardOutput.ReadToEndAsync(); $tErr = $p.StandardError.ReadToEndAsync()
    $timeout = $false
    if (-not $p.WaitForExit($seg * 1000)) {
        $timeout = $true
        & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null
        [void]$p.WaitForExit(5000)
    }
    $o = ""; $e = ""
    if ($tOut.Wait(3000)) { $o = [string]$tOut.Result }
    if ($tErr.Wait(3000)) { $e = [string]$tErr.Result }
    $rc = -1
    if ($p.HasExited) { $rc = $p.ExitCode }
    return [pscustomobject]@{ Rc = $rc; Out = $o; Err = $e; TimedOut = $timeout }
}
function Gate([string]$orden, [string[]]$opc = @(), [int]$seg = $MaxSsh, [bool]$sinN = $false) {
    Margen "cada llamada a ssh"     # TODA llamada (tambien dentro de los bucles V4 y V8 y las repeticiones manuales) exige >= $MargenS s hasta el vencimiento
    $a = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=10")
    if (-not $sinN) { $a = @("-n") + $a }
    $a = $a + $opc + @($Alias)
    if ($orden) { $a += $orden }
    return (Ejecutar $a $seg)
}
function Causa($r) {
    if ($r.TimedOut) { return "TIMEOUT: ssh excedio su tiempo y fue terminado" }
    if ($r.Rc -eq -1) { return "ERROR_LOCAL: " + $r.Err }
    if ($r.Rc -eq 255 -and $r.Err -match "Permission denied") { return "AUTENTICACION: la clave no se cargo o no fue aceptada" }
    if ($r.Rc -eq 255) { return "RED/CONEXION: " + (($r.Err -replace "\s+", " ").Trim()) }
    return "RC=" + $r.Rc
}
function EsRedOAuth($r) { return ($r.TimedOut -or $r.Rc -eq 255 -or $r.Rc -eq -1) }
function Res([string]$nombre, [bool]$bien, [string]$detalle) {
    if ($bien) { $script:ok++; "[{0}] OK     {1} ({2})" -f (Marca), $nombre, $detalle }
    else { $script:ko++; "[{0}] FALLA  {1} ({2})" -f (Marca), $nombre, $detalle }
}
function Json([string]$t) { try { return ($t | ConvertFrom-Json) } catch { return $null } }
function Pide([string]$check, [int]$espera) {
    $r = Gate ("solicitar " + $check)
    if ($r.Rc -eq 7 -and $espera -gt 0) {
        "   $check limitada por una peticion aceptada reciente (limitador persistente): espero $espera s y reintento UNA vez"
        Espera $espera
        $r = Gate ("solicitar " + $check)
    }
    return $r
}

try {
    "== V0: condiciones locales (sin conectar) y vencimiento de la reversion =="
    try { [void](VenceDe $VenceUtc) }
    catch { throw "defina `$VenceUtc con la hora VENCE_UTC que imprimio la consola al armar la reversion, SOLO si la consola dijo VENCIMIENTO_VERIFICADO (formato 2026-11-14T12:30:05Z)" }
    if ($IdActivacion -cnotmatch '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$') { throw "defina `$IdActivacion con el id que imprimio 'activar' en la consola (ej. 20261114T120000Z-0123456789abcdef)" }
    if ($SecretoActivacion -cnotmatch '^[0-9a-f]{32}$') { throw "defina `$SecretoActivacion con la clave que imprimio 'activar' en la consola (32 hexadecimales)" }
    if ($AliasAdmin -ceq $Alias) { throw "`$AliasAdmin no puede ser el alias de tai-inspect: debe ser el acceso de administrador habitual, INDEPENDIENTE" }
    $r0 = Restante
    if ($r0 -gt 660 -or $r0 -lt 0) { throw "`$VenceUtc no es de esta tanda (restan $r0 s; se esperan entre 0 y 660): vuelva a copiar VENCE_UTC del ultimo armado" }
    $g = Ejecutar @("-G", $Alias) 15
    $idf = @($g.Out -split "`r?`n" | Where-Object { $_ -match "^identityfile " })
    Res "V0 alias: usuario tai-inspect, UNA sola clave tai-inspect_ed25519 (no id_ed25519_tai_inspect) e identitiesonly yes" (($g.Rc -eq 0) -and ($g.Out -match '(?m)^user tai-inspect\s*$') -and ($idf.Count -eq 1) -and ($idf[0] -match 'tai-inspect_ed25519\s*$') -and ($g.Out -notmatch "id_ed25519_tai_inspect") -and ($g.Out -match '(?m)^identitiesonly yes\s*$')) ("identityfile=" + ($idf -join ";"))
    $ag = (& ssh-add -l 2>&1 | Out-String)
    Res "V0 la clave dedicada esta cargada en el agente" ($ag.Contains($HuellaClave)) ("huella esperada " + $HuellaClave)
    if ($ko -gt 0) { throw "las condiciones locales no se cumplen: corregir antes de probar contra el VPS" }
    Control "V1"

    "== V1/V2/V2b: limitador (30 s por comprobacion; V1 primera peticion, V2 la inmediata) =="
    $r1 = Pide "host-recursos" $Esperas
    if (EsRedOAuth $r1) { throw ("V1 NO CONCLUYENTE: " + (Causa $r1)) }
    $j1 = Json $r1.Out
    Res "V1 host-recursos acepta y devuelve JSON valido" (($r1.Rc -eq 0) -and ($j1 -ne $null) -and ($j1.check -eq "host-recursos")) (Causa $r1)
    $r2 = Gate "solicitar host-recursos"
    Res "V2 la repetida inmediata se rechaza (RC=7, limite alcanzado)" ((-not $r2.TimedOut) -and ($r2.Rc -eq 7) -and ($r2.Out -match "limite alcanzado")) (Causa $r2)
    "   espero $Esperas s desde la ultima peticion ACEPTADA (V1)"
    Espera $Esperas
    $r3 = Gate "solicitar host-recursos"
    $j3 = Json $r3.Out
    Res "V2b pasados $Esperas s vuelve a aceptar (RC=0, JSON valido)" (($r3.Rc -eq 0) -and ($j3 -ne $null) -and ($j3.check -eq "host-recursos")) (Causa $r3)

    Control "V3-V4"
    "== V3: comprobacion sensible cerrada =="
    $r = Gate "solicitar docker-nodos"
    Res "V3 docker-nodos no disponible (RC=2)" ((-not $r.TimedOut) -and ($r.Rc -eq 2) -and ($r.Out -match "comprobacion no disponible")) (Causa $r)
    "== V4: ordenes hostiles y sesion sin orden =="
    foreach ($o in @("id", "bash", "solicitar ../x", "id; cat /etc/passwd")) {
        $r = Gate $o
        Res "V4 orden hostil '$o' -> orden no permitida (RC=2), sin shell" ((-not $r.TimedOut) -and ($r.Rc -eq 2) -and ($r.Out -match "orden no permitida") -and ($r.Out -notmatch "uid=|root:")) (Causa $r)
    }
    $r = Gate "" @("-T")
    Res "V4 sesion sin orden -> orden no permitida (RC=2)" ((-not $r.TimedOut) -and ($r.Rc -eq 2) -and ($r.Out -match "orden no permitida")) (Causa $r)

    Control "V5-V6"
    $tc = [Math]::Min($MaxSsh, 15)
    "== V5: reenvio y pseudoterminal denegados POR EL SERVIDOR (no se acepta un simple error de red) =="
    $r = Gate "" @("-v", "-W", "127.0.0.1:22") $tc $true
    $pw = ((-not $r.TimedOut) -and ($r.Rc -ne 0) -and ($r.Err -match "Authenticated to") -and ($r.Err -match "administratively prohibited|stdio forwarding failed") -and ($r.Out -notmatch "SSH-2\.0"))
    Res "V5 -W: autentico y el servidor prohibio el reenvio" $pw $(if ($pw) { "RC=" + $r.Rc + ", denegado por el servidor" } else { Causa $r })
    $r = Gate "id" @("-v", "-tt") $tc
    # Con -tt el cliente trata el rechazo del PTY como FATAL (RC=255) ANTES de ejecutar el comando: no hay respuesta del gate. La evidencia del servidor es: sesion autenticada + CHANNEL_FAILURE del pty-req + ninguna salida.
    $ptt = ((-not $r.TimedOut) -and ($r.Rc -eq 255) -and ($r.Err -match "Authenticated to") -and ($r.Err -match "PTY allocation request failed on channel \d+") -and ([string]::IsNullOrWhiteSpace($r.Out)))
    Res "V5 -tt: autentico y el servidor rechazo el pseudoterminal (fatal con -tt; no se ejecuta ni el gate ni un shell)" $ptt $(if ($ptt) { "RC=255, PTY rechazado por el servidor tras autenticar" } else { (Causa $r) + "; stdout: " + (($r.Out -replace "\s+", " ").Trim()) + "; stderr: " + (($r.Err -replace "\s+", " ").Trim()) })
    "== V6: la contrasena no se ofrece (el servidor solo ofrece publickey) =="
    Margen "V6"
    $r = Ejecutar @("-v", "-n", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no", $Alias, "true") $tc
    $ms = [regex]::Matches($r.Err, "Authentications that can continue: ([^\r\n]*)")
    $soloPk = ($ms.Count -ge 1)
    foreach ($m in $ms) { if ($m.Groups[1].Value.Trim() -ne "publickey") { $soloPk = $false } }
    $p6 = ((-not $r.TimedOut) -and ($r.Rc -ne 0) -and $soloPk)
    $det6 = "RC=" + $r.Rc + ", denegado por el servidor"
    if (-not $p6) { if (($ms.Count -ge 1) -and (-not $soloPk)) { $det6 = "METODOS OFRECIDOS: " + (($ms | ForEach-Object { $_.Groups[1].Value.Trim() }) -join " | ") } else { $det6 = Causa $r } }
    Res "V6 el servidor ofrece solo publickey y deniega" $p6 $det6

    Control "V7"
    "== V7 (OBLIGATORIA): /api/health de $Dominio =="
    if ([string]::IsNullOrWhiteSpace($Dominio)) { throw "V7 es obligatoria: `$Dominio no puede estar vacio" }
    if ($SourceHashEsperado -cnotmatch '^[0-9a-f]{64}$') { throw "V7 es obligatoria: `$SourceHashEsperado debe ser el sourceHash real (64 hexadecimales en minuscula)" }
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $h = Invoke-RestMethod ("https://" + $Dominio + "/api/health") -TimeoutSec 20
        $st = [string]$h.status; $sh = [string]$h.sourceHash
        Res "V7 /api/health status=ok" ($st -ceq "ok") ("status=" + $st)
        $dsh = "sourceHash=" + $sh; if ([string]::IsNullOrWhiteSpace($sh)) { $dsh = "sourceHash AUSENTE en la respuesta" }
        Res "V7 sourceHash REAL igual al esperado (exacto)" ($sh -ceq $SourceHashEsperado) $dsh
    } catch { Res "V7 /api/health (obligatoria)" $false ("error: " + $_.Exception.Message) }

    if ($AliasAdmin -ne "") {
        Control "V7-admin"
        "== V7-admin (opcional): el acceso de administrador habitual, independiente de tai-inspect, entra como siempre =="
        Margen "V7-admin"
        $ra = Ejecutar @("-n", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", $AliasAdmin, "echo TAI_ADMIN_OK") ([Math]::Min($MaxSsh, 15))
        $adminOk = ((-not $ra.TimedOut) -and ($ra.Rc -eq 0) -and ($ra.Out.Trim() -ceq "TAI_ADMIN_OK"))
        if ($adminOk) { $estadoAdmin = "SSH_OK" } else { $estadoAdmin = "FALLA" }
        Res "V7-admin acceso administrativo independiente por SSH (BatchMode, solo lectura: echo)" $adminOk $(if ($adminOk) { "entro como siempre" } else { Causa $ra })
    }

    Control "V8"
    "== V8: resto de comprobaciones del host (cada una con su propio intervalo; host-actualizaciones, 300 s) =="
    foreach ($c in @("host-red", "host-servicios", "host-tiempo", "host-actualizaciones")) {
        $espera = $Esperas; if ($c -eq "host-actualizaciones") { $espera = 0 }
        $r = Pide $c $espera
        if ($r.Rc -eq 7) { $omitidas += $c; "[{0}] PENDIENTE (limitador) V8 {1}: RC=7; es OBLIGATORIA y debe resolverse antes de cancelar la reversion" -f (Marca), $c; continue }
        $j = Json $r.Out
        Res ("V8 " + $c + " acepta y devuelve JSON valido") ((-not (EsRedOAuth $r)) -and ($r.Rc -eq 0) -and ($j -ne $null) -and ($j.check -eq $c)) (Causa $r)
        if ($r.Out -match "\b(\d{1,3}\.){3}\d{1,3}\b") { "   AVISO: aparece una direccion IP en el informe de $c; revisar el contenido" }
    }
} catch {
    $abortado = $true
    "ABORTADO: " + $_.Exception.Message
} finally {
    $vivos = 0
    foreach ($id in $hijos) { $q = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($q) { $vivos++; & taskkill.exe /T /F /PID $id 2>&1 | Out-Null } }
    "   [procesos ssh que quedaban abiertos y se terminaron: $vivos]"
}

"== Resumen: $ok correctas, $ko fallidas, $($omitidas.Count) pendientes por el limitador; $(Marca) desde el arranque =="
# Margen de proteccion AL TERMINAR: nunca se declara un resultado satisfactorio (ni incompleto) si ya no queda margen o el vencimiento no se puede calcular
$finRestante = $null
try { $finRestante = Restante } catch { $finRestante = $null }
$fueraMargen = (($finRestante -eq $null) -or ($finRestante -lt ($MargenS + 60)))   # 90 s de margen + 60 s para pegar el cierre en la consola
if ($finRestante -ne $null) { "   [tiempo] al terminar: quedan $finRestante s para el vencimiento REAL de la reversion (minimo exigido $MargenS s)" }
if ($abortado -or $ko -gt 0 -or $fueraMargen) {
    if ($fueraMargen) { "FUERA_DE_MARGEN: no quedan los $($MargenS + 60) s necesarios (90 s de margen + 60 s para pegar el cierre) o no se puede calcular: ningun resultado es satisfactorio" }
    $veredicto = "V_FALLA"
    "V_FALLA: NO cancelar la reversion; NO se rearma: reversion manual segura o dejar vencer la automatica (F7, 'Si algo falla')"
} elseif ($omitidas.Count -gt 0) {
    $veredicto = "V_INCOMPLETO"
    "V_INCOMPLETO: pendientes OBLIGATORIAS por el limitador: " + ($omitidas -join ", ") + ". Resolver SOLO si queda margen (>= 90 s) en el temporizador ORIGINAL: esperar a que pase su intervalo y ejecutar en esta sesion: `$r = Gate 'solicitar <comprobacion>'; `$r.Rc; (`$r.Out | ConvertFrom-Json).check  -> RC=0 y la comprobacion correcta. NO se rearma: sin tiempo, NO cancelar; reversion manual segura o dejar vencer la automatica"
} else {
    $veredicto = "AUTOMATICAS_OK"
    "AUTOMATICAS_OK (V0-V8 automaticas superadas). ESTO NO AUTORIZA CANCELAR por si mismo: lo decide la consola con la orden 'cerrar' que se imprime abajo (o, en el procedimiento manual, con su puerta de cancelacion)."
}

# Resultado ATADO a esta activacion (id + HMAC con la clave que imprimio 'activar'); la consola lo verifica y decide. Se emite SIEMPRE: con un fallo, la consola revierte con seguridad.
$ab = 0; if ($abortado) { $ab = 1 }
$fu = 0; if ($fueraMargen) { $fu = 1 }
$msgF7 = "F7R1|" + $IdActivacion + "|" + $veredicto + "|" + $ok + "|" + $ko + "|" + $omitidas.Count + "|" + $ab + "|" + $fu + "|" + $VenceUtc + "|" + $estadoAdmin
$hmacF7 = New-Object System.Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($SecretoActivacion))
$hexF7 = ([BitConverter]::ToString($hmacF7.ComputeHash([Text.Encoding]::UTF8.GetBytes($msgF7))) -replace "-", "").ToLower()
$psF7 = ""
try { if ($PSCommandPath) { $psF7 = " ps=" + (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash.Substring(0, 16).ToLower() } } catch { $psF7 = "" }
$lineaF7 = "F7R1 id=" + $IdActivacion + " veredicto=" + $veredicto + " ok=" + $ok + " ko=" + $ko + " pend=" + $omitidas.Count + " abortado=" + $ab + " fuera=" + $fu + " vence=" + $VenceUtc + " admin=" + $estadoAdmin + $psF7 + " hmac=" + $hexF7
"== EN LA CONSOLA DE HOSTINGER, pegar esta orden (tambien si ha fallado: la consola decide y revierte con seguridad) =="
"sh /root/tai-etapa2/f7-vps.sh cerrar '" + $lineaF7 + "'"
