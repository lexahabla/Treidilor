# Ejecuta F7-Validacion-Windows.ps1 (con parametros) contra el ssh SIMULADO. No se conecta a nada.
param([string]$Modo = "normal", [string]$Script = "", [string]$Dir = "", [int]$X = 600, [string]$Vence = "", [string]$Id = "20261114T120000Z-0123456789abcdef", [string]$Clave = "00112233445566778899aabbccddeeff", [switch]$ConAdmin)
$ErrorActionPreference = "Continue"
$work = Join-Path $Dir ("run3-" + $Modo)
New-Item -ItemType Directory -Force -Path $work | Out-Null
Remove-Item (Join-Path $work "*") -Force -ErrorAction SilentlyContinue
Set-Content (Join-Path $work "reloj.txt") 0
$env:TAI_FAKE_DIR = $work; $env:TAI_FAKE_MODO = $Modo
$global:t0 = [datetime]::UtcNow
$global:rf = Join-Path $work "reloj.txt"
$global:n = 0; $global:salto = 0
if ($Modo -eq "margen_final") { $global:salto = 6 }
function AhoraUtc { $global:n++; return $global:t0.AddSeconds([double](Get-Content $global:rf) + $global:n * $global:salto) }
function Dormir([int]$s) { Set-Content $global:rf ([double](Get-Content $global:rf) + $s) }
function ssh-add { param() if ($Modo -eq "agente_vacio") { "The agent has no identities." } elseif ($Modo -eq "huella_antigua") { "256 SHA256:tUYYG5OPlBwlSvAiGwsMT+7kycbB5dpQDQfbzgOFnVA treidilor-tai-inspect (ED25519)" } else { "256 SHA256:OW0d/GCWjasNxmoh7RWafXSFQZvvYt7nNIgtHXVpQtU tai-inspect (ED25519)" } }
function Invoke-RestMethod { param($Uri, $TimeoutSec)
    if ($Modo -eq "health_error") { throw "No se puede conectar con el servidor remoto" }
    if ($Modo -eq "status_ko") { return [pscustomobject]@{ status = "degraded"; sourceHash = "0885734050b5c946c3eb22e328120eea080d7a68adb17a1c10816da0f15c7487" } }
    if ($Modo -eq "hash_distinto") { return [pscustomobject]@{ status = "ok"; sourceHash = "0885734050b5c946c3eb22e328120eea080d7a68adb17a1c10816da0f15c7488" } }
    if ($Modo -eq "hash_mayusculas") { return [pscustomobject]@{ status = "ok"; sourceHash = "0885734050B5C946C3EB22E328120EEA080D7A68ADB17A1C10816DA0F15C7487" } }
    if ($Modo -eq "hash_ausente") { return [pscustomobject]@{ status = "ok" } }
    return [pscustomobject]@{ status = "ok"; sourceHash = "0885734050b5c946c3eb22e328120eea080d7a68adb17a1c10816da0f15c7487" } }
if ($Modo -eq "limitada_previa") { Set-Content (Join-Path $work "ultimo.json") '{"host-recursos": -5}' }
if ($Modo -eq "actualizaciones_recientes") { Set-Content (Join-Path $work "ultimo.json") '{"host-actualizaciones": -10}' }
$secs = 600
if ($Modo -eq "vence_proximo") { $secs = 60 }
if ($Modo -eq "vence_corto") { $secs = 100 }
if ($Modo -eq "vence_bucle") { $secs = 100 }
if ($Modo -eq "vence_obsoleto") { $secs = -300 }
if ($Modo -eq "margen_final") { $secs = $X }
$a = @{
    VenceUtc = $global:t0.AddSeconds($secs).ToString("yyyy-MM-ddTHH:mm:ssZ")
    SshExe = (Get-Command powershell.exe).Source
    SshPrefijo = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "fake-ssh.ps1"))
    MaxSsh = 4
}
if ($Vence -ne "") { $a.VenceUtc = $Vence }
$a.IdActivacion = $Id
$a.SecretoActivacion = $Clave
if ($ConAdmin) { $a.AliasAdmin = "admin-vps" }
if ($Modo -eq "vence_bucle") { $a.Esperas = 0 }
if ($Modo -eq "sin_hash_esperado") { $a.SourceHashEsperado = "" }
. $Script @a
$vivos = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*fake-ssh.ps1*" }).Count
"[prueba] procesos del ssh simulado vivos al terminar: $vivos"
