# -*- coding: utf-8 -*-
"""Gate: la ÚNICA orden que puede ejecutar la clave SSH restringida (`ForceCommand`).

Acepta exclusivamente `solicitar <comprobación>` o `leer <comprobación>` con un nombre de la lista cerrada y
habilitada. No interpreta la orden con ningún intérprete, no la reenvía a ningún programa y no la repite en las
respuestas. No tiene privilegios: solo escribe peticiones y lee informes ya saneados (o ejecuta las comprobaciones
del host, que no necesitan privilegios).
"""
from __future__ import annotations

import json
import os
import re
import time

from . import informe
from .audit import Audit, command_hash, origin_from_ssh_connection, sanitize_text
from .checks import REGISTRY
from .config import (CHECKS, GATE_POLL_SECONDS, GATE_WAIT_SECONDS, MAX_COMMAND_CHARS, MAX_DAILY_REQUESTS,
                     MAX_REPORT_BYTES, INSTALL_DIR)
from .ctx import Contexto
from .limits import Bloqueo, Cuota
from .pathsafe import RutaNoPermitida, atomic_write, safe_join, safe_read_file
from .redact import scan

_ORDEN = re.compile(r"(solicitar|leer) ([a-z0-9]+(?:-[a-z0-9]+)*)")
_INFORME = re.compile(r"^[a-z0-9-]+\.json$")

# Códigos de salida
OK, RECHAZADA, DESACTIVADO, SIN_INFORME, SIN_RESPUESTA, OCUPADO, LIMITE, ERROR, AUDITORIA = 0, 2, 3, 4, 5, 6, 7, 8, 9
MENSAJE_GENERICO = "error interno\n"      # único texto que ve el cliente ante cualquier fallo interno (códigos 8 y 9)


def parse_orden(original):
    """Devuelve (verbo, comprobación) o None. Validación ESTRICTA: ASCII, longitud acotada, forma exacta."""
    if not isinstance(original, str) or not original or len(original) > MAX_COMMAND_CHARS or not original.isascii():
        return None
    m = _ORDEN.fullmatch(original)
    return (m.group(1), m.group(2)) if m else None


class Gate(object):
    def __init__(self, enabled, runner, settings, req_dir, rep_dir, state_dir, disable_file, audit, now=time.time,
                 sleep=time.sleep, max_daily=MAX_DAILY_REQUESTS, wait=GATE_WAIT_SECONDS, poll=GATE_POLL_SECONDS,
                 install_dir=INSTALL_DIR, manifest_path=None, audit_paths=None, registry=None, statvfs=None, root=""):
        self.enabled, self.runner, self.settings = set(enabled), runner, settings
        self.req_dir, self.rep_dir, self.state_dir, self.disable_file = req_dir, rep_dir, state_dir, disable_file
        self.audit, self.now, self.sleep, self.wait, self.poll = audit, now, sleep, wait, poll
        self.install_dir, self.manifest_path, self.audit_paths = install_dir, manifest_path, audit_paths
        self.registry = REGISTRY if registry is None else registry
        self.statvfs, self.root = statvfs, root
        self.cuota = Cuota(os.path.join(state_dir, "cuota.json"), max_daily, now=now)

    # ---- utilidades ----
    def _ctx(self):
        return Contexto(self.runner, settings=self.settings, root=self.root, now=self.now, install_dir=self.install_dir,
                        audit_paths=self.audit_paths, statvfs=self.statvfs, manifest_path=self.manifest_path)

    def _salida(self, datos):
        """Último filtro ANTES de imprimir: tamaño y secretos."""
        if len(datos) > MAX_REPORT_BYTES:
            return None
        try:
            if scan(json.loads(datos.decode("utf-8"))):
                return None
        except ValueError:
            return None
        return datos.decode("ascii", "replace")

    # ---- auditoría ----
    def _aud(self, evento, **campos):
        """Auditoría que NUNCA lanza excepciones: devuelve False si no se pudo registrar."""
        try:
            self.audit.log(evento, **campos)
            return True
        except Exception:  # noqa: BLE001
            return False

    # ---- punto de entrada ----
    def handle(self, original, ssh_connection=None):
        """Devuelve (código, texto). NUNCA lanza excepciones: ante cualquier fallo interno devuelve solo `error interno`."""
        base = {}
        try:
            base["origen"] = origin_from_ssh_connection(ssh_connection)
            if isinstance(original, str):
                base["cmd_hash"] = command_hash(original)
            return self._handle(original, base)
        except Exception as e:  # noqa: BLE001 (solo se registra el TIPO de la excepción, nunca su mensaje)
            self._aud("gate_resultado", resultado="error_interno", detalle=type(e).__name__, **base)
            return ERROR, MENSAJE_GENERICO

    def _handle(self, original, base):
        t_reloj = time.time()
        if os.path.exists(self.disable_file):
            self._aud("gate", resultado="desactivado", **base)
            return DESACTIVADO, "desactivado\n"
        if not isinstance(original, str) or not original:
            self._aud("gate", resultado="sin_orden", **base)
            return RECHAZADA, "orden no permitida\n"
        orden = parse_orden(original)
        if orden is None:
            self._aud("gate", resultado="orden_rechazada", detalle=sanitize_text(original), **base)
            return RECHAZADA, "orden no permitida\n"
        verbo, check = orden
        if check not in CHECKS or check not in self.enabled:
            self._aud("gate", verbo=verbo, resultado="no_habilitada", **base)
            return RECHAZADA, "comprobacion no disponible\n"
        kind = CHECKS[check]["kind"]
        if verbo == "leer" and kind != "colector":
            self._aud("gate", verbo=verbo, check=check, resultado="orden_rechazada", **base)
            return RECHAZADA, "orden no permitida\n"
        # H5: AUDITORÍA PREVIA OBLIGATORIA. Se registra la INTENCIÓN antes de tocar nada (ni cupo, ni bloqueo, ni comprobación).
        # Si no puede registrarse, la comprobación NO se ejecuta.
        if not self._aud("gate_intencion", verbo=verbo, check=check, resultado="intencion", **base):
            return AUDITORIA, MENSAJE_GENERICO
        bloqueo = Bloqueo(os.path.join(self.state_dir, "gate.lock"), ttl=self.wait * 3 + 10, now=self.now)
        codigo, texto, datos, resultado = ERROR, MENSAJE_GENERICO, b"", "error_interno"
        try:
            if not bloqueo.acquire():
                codigo, texto, resultado = OCUPADO, "ocupado\n", "ocupado"
            else:
                try:
                    ok, motivo = self.cuota.consumir(check, CHECKS[check]["interval"] if verbo == "solicitar" else 0)
                    if not ok:
                        codigo, texto, resultado = LIMITE, "limite alcanzado\n", motivo
                    elif verbo == "leer":
                        codigo, texto, datos = self._leer(check)
                    elif kind == "host":
                        codigo, texto, datos = self._host(check)
                    else:
                        codigo, texto, datos = self._solicitar(check)
                    if ok:
                        resultado = {OK: "ok", SIN_INFORME: "sin_informe", SIN_RESPUESTA: "sin_respuesta"}.get(codigo, "error")
                finally:
                    bloqueo.release()
        except Exception as e:  # noqa: BLE001
            self._aud("gate_resultado", verbo=verbo, check=check, resultado="error_interno", detalle=type(e).__name__, **base)
            return ERROR, MENSAJE_GENERICO
        ms = int((time.time() - t_reloj) * 1000)
        campos = dict(base, verbo=verbo, check=check, resultado=resultado, ms=ms)
        if codigo == OK:
            campos.update(bytes=len(datos), sha256=informe.sha256_de(datos))
            # Si el resultado no puede registrarse NO se entrega el informe (no sale información sin rastro).
            if not self._aud("gate_resultado", **campos):
                return AUDITORIA, MENSAJE_GENERICO
        else:
            self._aud("gate_resultado", **campos)
        return codigo, texto

    # ---- verbos ----
    def _leer(self, check):
        try:
            ruta = safe_join(self.rep_dir, check + ".json", _INFORME)
            datos = safe_read_file(ruta, MAX_REPORT_BYTES)
        except (OSError, RutaNoPermitida):
            return SIN_INFORME, "sin informe\n", b""
        texto = self._salida(datos)
        if texto is None:
            return ERROR, "informe no disponible\n", b""
        return OK, texto + "\n", datos

    def _host(self, check):
        t0 = self.now()
        ini = time.time()
        datos_av = self.registry[check](self._ctx())
        cuerpo = informe.construir(check, datos_av[0], datos_av[1], t0, int((time.time() - ini) * 1000))
        datos, estado = informe.finalizar(cuerpo, t0)
        texto = self._salida(datos)
        if texto is None:
            return ERROR, "informe no disponible\n", b""
        return (OK if estado == "ok" else ERROR), texto + "\n", datos

    def _solicitar(self, check):
        t_req = int(self.now())
        idp = os.urandom(16).hex()                  # identificador único de la petición (128 bits aleatorios)
        nombre = idp + ".req"
        ruta = os.path.join(self.req_dir, nombre)
        atomic_write(ruta, json.dumps({"check": check, "v": 1, "t": t_req}, separators=(",", ":")).encode("ascii"), 0o640)
        limite = self.now() + self.wait
        try:
            while True:
                try:
                    datos = safe_read_file(safe_join(self.rep_dir, check + ".json", _INFORME), MAX_REPORT_BYTES)
                    rep = json.loads(datos.decode("utf-8"))
                    # Correspondencia por IDENTIFICADOR ÚNICO de petición (no por fecha): solo se entrega el informe cuya petición
                    # (nombre del archivo que creó este gate, 32 hexadecimales aleatorios) y comprobación coinciden con las de ESTA llamada.
                    if isinstance(rep, dict) and rep.get("peticion") == idp and rep.get("check") == check:
                        texto = self._salida(datos)
                        if texto is None:
                            return ERROR, "informe no disponible\n", b""
                        return (ERROR if "error" in rep else OK), texto + "\n", datos
                except (OSError, RutaNoPermitida, ValueError):
                    pass
                if self.now() >= limite:
                    return SIN_RESPUESTA, "sin respuesta del colector\n", b""
                self.sleep(self.poll)
        finally:
            try:
                os.unlink(ruta)
            except OSError:
                pass


# ---------------------------------------------------------------------------------------------------------------
def main():  # pragma: no cover  (punto de entrada de producción; no se ejecuta en esta etapa)
    """Punto de entrada de la orden forzada. Garantías: nunca imprime un traceback ni rutas internas y siempre termina con
    un código definido (0 ok, 2 rechazada, 3 desactivado, 4 sin informe, 5 sin respuesta, 6 ocupado, 7 límite, 8/9 error interno)."""
    import sys
    try:
        fd = os.open(os.devnull, os.O_WRONLY)
        os.dup2(fd, 2)                              # el error estándar queda descartado: el cliente SSH no ve diagnósticos
    except OSError:
        pass
    codigo, texto = ERROR, MENSAJE_GENERICO
    try:
        from . import config
        from .runner import Runner
        os.umask(0o077)
        audit = Audit(config.GATE_AUDIT_FILE, use_syslog=True, ident="tai-gate", lock_path=os.path.join(config.STATE_DIR, "audit.lock"))
        gate = Gate(config.load_enabled(), Runner(), config.load_settings(), config.REQ_DIR, config.REP_DIR, config.STATE_DIR,
                    config.DISABLE_FILE, audit)
        codigo, texto = gate.handle(os.environ.get("SSH_ORIGINAL_COMMAND"), os.environ.get("SSH_CONNECTION"))
    except BaseException:  # noqa: BLE001
        codigo, texto = ERROR, MENSAJE_GENERICO
    try:
        sys.stdout.write(texto)
        sys.stdout.flush()
    except BaseException:  # noqa: BLE001
        pass
    os._exit(codigo)                                # sin trazas al salir ni cierres que puedan escribir
