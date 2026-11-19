# -*- coding: utf-8 -*-
"""Colector: ÚNICO componente privilegiado. Procesa peticiones de la lista cerrada y deja informes saneados.

No recibe entrada libre: una petición es un fichero diminuto cuyo único dato útil es el NOMBRE de una comprobación de la lista cerrada y
habilitada. Todo lo que no encaja se descarta y se registra.

Garantías de publicación (revisión independiente, punto 1):
  1. el informe se prepara en un directorio de STAGING que el usuario restringido no puede leer;
  2. el RESULTADO se registra en la auditoría ANTES de publicar; si no puede registrarse, el informe no se publica y la petición se conserva;
  3. la publicación es un renombrado atómico (`os.replace`) dentro del mismo sistema de archivos;
  4. cualquier interrupción entre estas operaciones deja, como mucho, un archivo en staging que se retira en el pase siguiente.

Correspondencia petición↔informe (punto 2): el informe lleva el identificador de la petición (el nombre de su archivo, 32 hexadecimales aleatorios
que asigna el gate) y el gate solo acepta el informe con SU identificador.

Límites propios (punto 3): el usuario restringido puede crear peticiones SIN pasar por el gate, así que el colector aplica su propio cupo
diario e intervalo mínimo por comprobación con estado en un directorio de root, y descarta el exceso de peticiones pendientes.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time

from . import ancla, informe
from .checks import REGISTRY
from .config import (CHECKS, INSTALL_DIR, MAX_DAILY_REQUESTS, MAX_PENDING_REQUESTS, MAX_PENDING_TOTAL, MAX_REQUEST_FILE_BYTES)
from .ctx import Contexto
from .limits import Cuota
from .pathsafe import REQ_RE, RutaNoPermitida, atomic_write, safe_join, safe_read_file, valid_check_name, write_exclusive

TOTAL_CHECK_SECONDS = 45
_INFORME = re.compile(r"[a-z0-9-]+\.json")
_STAGED = re.compile(r"[0-9a-f]{32}\.[a-z0-9-]+\.json")


def ejecutar_con_limite(fn, segundos):
    """Ejecuta `fn()` con un tiempo total máximo. Devuelve (resultado, excepcion, agotado)."""
    caja = {}

    def objetivo():
        try:
            caja["r"] = fn()
        except Exception as e:  # noqa: BLE001 (se registra solo el tipo, nunca el mensaje)
            caja["e"] = type(e).__name__

    hilo = threading.Thread(target=objetivo, daemon=True)
    hilo.start()
    hilo.join(segundos)
    if hilo.is_alive():
        return None, None, True
    return caja.get("r"), caja.get("e"), False


class Colector(object):
    def __init__(self, req_dir, rep_dir, runner, enabled, settings, audit, now=time.time, install_dir=INSTALL_DIR,
                 manifest_path=None, audit_paths=None, max_pending=MAX_PENDING_REQUESTS, total_seconds=TOTAL_CHECK_SECONDS,
                 registry=None, statvfs=None, root="", staging_dir=None, state_dir=None, gate_audit_path=None, max_daily=MAX_DAILY_REQUESTS):
        self.req_dir, self.rep_dir = req_dir, rep_dir
        base = os.path.dirname(rep_dir)
        self.staging_dir = staging_dir if staging_dir is not None else os.path.join(base, "staging")
        self.state_dir = state_dir if state_dir is not None else os.path.join(base, "collector-state")
        self.runner, self.enabled, self.settings, self.audit, self.now = runner, set(enabled), settings, audit, now
        self.install_dir, self.manifest_path, self.audit_paths = install_dir, manifest_path, audit_paths
        self.max_pending, self.total_seconds = max_pending, total_seconds
        self.registry = REGISTRY if registry is None else registry
        self.statvfs, self.root = statvfs, root
        self.gate_audit_path = gate_audit_path
        self.cuota = Cuota(os.path.join(self.state_dir, "cuota.json"), max_daily, now=now)

    def _ctx(self):
        return Contexto(self.runner, settings=self.settings, root=self.root, now=self.now, install_dir=self.install_dir,
                        audit_paths=self.audit_paths, statvfs=self.statvfs, manifest_path=self.manifest_path,
                        gate_audit_path=self.gate_audit_path, collector_state_dir=self.state_dir)

    # ---- auditoría ----
    def _aud(self, evento, **campos):
        """Auditoría que NUNCA lanza excepciones: devuelve False si no se pudo registrar."""
        try:
            self.audit.log(evento, **campos)
            return True
        except Exception:  # noqa: BLE001
            return False

    # ---- anclas de integridad del registro del gate (punto 4) ----
    def _anclar(self):
        if not self.gate_audit_path:
            return
        destino = os.path.join(self.state_dir, "ancla-gate.json")
        try:
            previa = ancla.leer(destino)
            v = ancla.verificar(self.gate_audit_path, previa)
        except Exception as e:  # noqa: BLE001
            self._aud("colector_ancla", resultado="error_interno", detalle=type(e).__name__)
            return
        if not v["ok"]:
            self._aud("colector_ancla", resultado=v["motivo"] or "no_verificable")     # la ancla anterior se CONSERVA: la alarma persiste
            return
        if v["ancla"] is None:
            return                                                                     # aún no existe el registro del gate
        try:
            atomic_write(destino, json.dumps(v["ancla"], sort_keys=True).encode("ascii"), 0o600)
        except (OSError, RutaNoPermitida):
            self._aud("colector_ancla", resultado="escritura_fallida")
            return
        self._aud("colector_ancla", resultado="ok", ref_seq=v["ancla"]["seq"], bytes=v["ancla"]["bytes"], sha256=v["ancla"]["sha256"])

    # ---- staging ----
    def _limpiar_staging(self):
        try:
            nombres = os.listdir(self.staging_dir)
        except OSError:
            return
        for n in nombres:
            ruta = os.path.join(self.staging_dir, n)
            try:
                if not os.path.isdir(ruta) or os.path.islink(ruta):
                    os.unlink(ruta)                                    # restos de una interrupción: nunca se publicaron
            except OSError:
                pass

    # ---- pasada ----
    def procesar(self):
        """Procesa como máximo `max_pending` peticiones. Devuelve cuántas atendió.
        Cada petición se aísla: una petición hostil o defectuosa NUNCA detiene a las demás."""
        self._anclar()
        self._limpiar_staging()
        try:
            nombres = os.listdir(self.req_dir)
        except OSError:
            self._aud("error", resultado="req_dir_ilegible")
            return 0
        entradas = []
        for n in nombres:
            if n.startswith("."):
                continue                       # temporales de escritura atómica
            try:
                antiguedad = os.lstat(os.path.join(self.req_dir, n)).st_mtime
            except OSError:
                antiguedad = 0
            entradas.append((antiguedad, n))
        entradas.sort()                        # las MÁS ANTIGUAS primero: una petición rezagada no puede pisar el informe de otra más reciente
        atendidas = 0
        for posicion, (_, nombre) in enumerate(entradas):
            if posicion >= MAX_PENDING_TOTAL:
                self._descartar(nombre, "exceso_de_peticiones")
                continue
            if REQ_RE.fullmatch(nombre) is None:
                self._descartar(nombre, "nombre_invalido")
                continue
            if atendidas >= self.max_pending:
                continue
            atendidas += 1
            try:
                seguir = self._una(nombre)
            except Exception as e:  # noqa: BLE001  (solo se registra el TIPO de la excepción, nunca su mensaje)
                self._aud("error_peticion", resultado="error_interno", detalle=type(e).__name__)
                self._descartar(nombre, "error_interno")
                continue
            if seguir is False:                # auditoría no disponible: no se ejecuta nada más en esta pasada
                break
        return atendidas

    def _descartar(self, nombre, motivo):
        """Retira una entrada del directorio de peticiones SIN seguir enlaces simbólicos."""
        ruta = os.path.join(self.req_dir, nombre)
        try:
            if os.path.isdir(ruta) and not os.path.islink(ruta):
                pass                           # un directorio no se borra: solo se registra
            else:
                os.unlink(ruta)
        except OSError:
            pass
        self._aud("peticion_descartada", resultado=motivo)

    def _una(self, nombre):
        """Devuelve False solo si hay que detener la pasada (auditoría obligatoria no disponible)."""
        idp = nombre[:-4]
        try:
            ruta = safe_join(self.req_dir, nombre, REQ_RE)         # un enlace simbólico hace que realpath se salga de la ruta
            req = json.loads(safe_read_file(ruta, MAX_REQUEST_FILE_BYTES).decode("utf-8"))
            check = req.get("check") if isinstance(req, dict) else None
        except (OSError, RutaNoPermitida, ValueError, UnicodeDecodeError):
            self._descartar(nombre, "peticion_invalida")
            return True
        if not valid_check_name(check) or check not in CHECKS or check not in self.enabled or CHECKS[check]["kind"] != "colector" or check not in self.registry:
            self._descartar(nombre, "no_habilitada")
            return True
        # H5: la INTENCIÓN se registra ANTES de ejecutar; si no puede registrarse, no se ejecuta (la petición se conserva).
        if not self._aud("colector_intencion", check=check, id=idp, resultado="intencion"):
            return False
        # Límites propios del colector (estado de root): el usuario restringido puede crear peticiones sin pasar por el gate.
        ok, motivo = self.cuota.consumir(check, max(5, CHECKS[check]["interval"] // 2))
        if not ok:
            self._aud("colector_resultado", check=check, id=idp, resultado=motivo)       # no se ejecuta ni se publica nada
            self._borrar(ruta)
            return True
        t0 = self.now()
        t_reloj = time.time()
        r, exc, agotado = ejecutar_con_limite(lambda: self.registry[check](self._ctx()), self.total_seconds)
        ms = int((time.time() - t_reloj) * 1000)
        if agotado:
            datos, estado = informe.informe_error(check, "tiempo_agotado", t0, None, idp), "tiempo_agotado"
        elif exc is not None:
            datos, estado = informe.informe_error(check, "error_interno", t0, None, idp), "error_interno"
        else:
            cuerpo = informe.construir(check, r[0], r[1], t0, ms, peticion=idp)
            datos, estado = informe.finalizar(cuerpo, t0)
        return self._publicar(check, idp, datos, estado, ms, ruta)

    def _publicar(self, check, idp, datos, estado, ms, ruta):
        """staging → RESULTADO auditado → publicación atómica → confirmación. Nada queda disponible sin resultado registrado."""
        sha = informe.sha256_de(datos)
        staged = None
        try:
            staged = safe_join(self.staging_dir, idp + "." + check + ".json", _STAGED)
            destino = safe_join(self.rep_dir, check + ".json", _INFORME)
            write_exclusive(staged, datos, 0o640)                   # disco lleno u otro fallo → OSError: no se publica
        except (OSError, RutaNoPermitida):
            self._borrar(staged)
            self._aud("colector_resultado", check=check, id=idp, resultado="escritura_fallida", ms=ms)
            self._borrar(ruta)
            return True
        if not self._aud("colector_resultado", check=check, id=idp, resultado=estado, ms=ms, bytes=len(datos), sha256=sha):
            self._borrar(staged)                                    # sin resultado registrado NO se publica; la petición se conserva
            return False
        try:
            os.replace(staged, destino)                              # publicación atómica
        except OSError:
            self._borrar(staged)
            self._aud("colector_publicacion", check=check, id=idp, resultado="fallida")
            self._borrar(ruta)
            return True
        self._aud("colector_publicacion", check=check, id=idp, resultado="publicado", bytes=len(datos), sha256=sha)
        self._borrar(ruta)
        return True

    @staticmethod
    def _borrar(ruta):
        if not ruta:
            return
        try:
            os.unlink(ruta)
        except OSError:
            pass


def main():  # pragma: no cover  (punto de entrada de producción; no se ejecuta en esta etapa)
    import sys
    from . import config
    from .audit import Audit
    from .runner import Runner
    os.umask(0o027)
    audit = Audit(os.path.join(config.LOG_DIR, "collector-audit.log"), use_syslog=True, ident="tai-collector")
    col = Colector(config.REQ_DIR, config.REP_DIR, Runner(), config.load_enabled(), config.load_settings(), audit,
                   staging_dir=config.STAGING_DIR, state_dir=config.COLLECTOR_STATE_DIR, gate_audit_path=config.GATE_AUDIT_FILE)
    col.procesar()
    sys.exit(0)
