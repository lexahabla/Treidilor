# -*- coding: utf-8 -*-
"""Registro de auditoría: solo campos permitidos, saneados, sin contenido de informes ni datos personales.

Integridad (ver también `ancla.py`):
  · cada línea lleva un número de secuencia `seq` correlativo, asignado SIEMPRE por este módulo (el llamante no puede fijarlo);
    una línea borrada o insertada deja un hueco o una repetición detectable;
  · la única vía de escritura es `O_APPEND` (sin `O_TRUNC`): con el atributo de solo-añadir del sistema de archivos (`chattr +a`, que debe
    comprobarse en el servidor real) ni siquiera el propietario podría reescribir el historial;
  · el colector (root) ancla periódicamente una huella del prefijo del registro del gate en un archivo que el usuario restringido no puede tocar.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import time

from .limits import Bloqueo
from .pathsafe import safe_read_tail
from .redact import mask_text

try:  # syslog no existe en Windows (solo pruebas locales)
    import syslog as _syslog
except ImportError:  # pragma: no cover
    _syslog = None

ALLOWED_FIELDS = ("ts", "seq", "evento", "verbo", "check", "id", "resultado", "codigo", "ms", "bytes", "sha256", "origen", "cmd_hash", "detalle", "ref_seq")
_SHA = re.compile(r"[0-9a-f]{64}")
_ID = re.compile(r"[0-9a-f]{8,32}")
_SLUG = re.compile(r"[a-z0-9][a-z0-9_.-]{0,40}")
MAX_LINE_BYTES = 1000


def sanitize_text(s, maxlen=64):
    """Texto seguro para el registro: sin secretos, sin saltos de línea, ASCII imprimible, truncado."""
    if not isinstance(s, str):
        return ""
    s = mask_text(s)
    s = "".join(ch if 32 <= ord(ch) < 127 else "?" for ch in s)
    return s[:maxlen]


def mask_ip(ip):
    """Enmascara la IP del cliente (se conserva solo la red): a.b.c.x / grupo IPv6 inicial."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return "desconocido"
    if addr.version == 4:
        o = str(addr).split(".")
        return "%s.%s.%s.x" % (o[0], o[1], o[2])
    return ":".join(addr.exploded.split(":")[:3]) + "::x"


def origin_from_ssh_connection(valor):
    """`SSH_CONNECTION` = 'ip_cliente puerto_cliente ip_servidor puerto_servidor'."""
    if not isinstance(valor, str):
        return "desconocido"
    partes = valor.split()
    return mask_ip(partes[0]) if partes else "desconocido"


def command_hash(texto):
    return hashlib.sha256(texto.encode("utf-8", "replace")).hexdigest()[:16]


class Audit:
    def __init__(self, path=None, now=time.time, use_syslog=False, ident="tai-inspect", lock_path=None):
        self.path = path
        self.now = now
        self.lock_path = lock_path          # solo cuando varios procesos escriben el mismo registro (el gate); el colector es único
        self.use_syslog = bool(use_syslog and _syslog is not None)
        self.ident = ident
        if self.use_syslog:  # pragma: no cover (solo en el servidor)
            _syslog.openlog(ident, 0, _syslog.LOG_AUTH)

    def _limpiar(self, campos):
        reg = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.now()))}
        for k in ALLOWED_FIELDS:
            if k in ("ts", "seq") or k not in campos:
                continue
            v = campos[k]
            if k == "sha256":
                v = v if isinstance(v, str) and _SHA.fullmatch(v) else "-"
            elif k == "id":
                v = v if isinstance(v, str) and _ID.fullmatch(v) else "-"
            elif k in ("check", "verbo", "evento", "resultado", "codigo"):
                v = v if isinstance(v, str) and _SLUG.fullmatch(v) else "-"
            elif k in ("ms", "bytes", "ref_seq"):
                v = int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0
            elif k == "cmd_hash":
                v = v if isinstance(v, str) and re.fullmatch(r"[0-9a-f]{16}", v) else "-"
            elif k == "origen":
                v = sanitize_text(str(v), 40)
            elif k == "detalle":
                v = sanitize_text(str(v), 64)
            reg[k] = v
        return reg

    def _ultimo_seq(self):
        """Último `seq` de la cola del registro (0 si no existe). Cualquier otro fallo se propaga: sin poder encadenar no se audita (falla cerrado)."""
        try:
            datos = safe_read_tail(self.path, 8192)
        except FileNotFoundError:
            return 0
        for linea in reversed(datos.splitlines()):
            try:
                s = json.loads(linea.decode("utf-8", "replace")).get("seq")
            except (ValueError, AttributeError):
                continue
            if isinstance(s, int) and not isinstance(s, bool):
                return s
        return 0

    def log(self, evento, **campos):
        campos["evento"] = evento
        reg = self._limpiar(campos)
        bloqueo = None
        if self.path and self.lock_path:
            bloqueo = Bloqueo(self.lock_path, ttl=5)
            for _ in range(40):                              # hasta ~2 s; si no se consigue, el registro falla y quien llama RECHAZA la ejecución
                if bloqueo.acquire():
                    break
                time.sleep(0.05)
            else:
                raise OSError("registro ocupado")
        try:
            if self.path:
                reg["seq"] = self._ultimo_seq() + 1
            linea = json.dumps(reg, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
            datos = (linea + "\n").encode("ascii")
            if len(datos) > MAX_LINE_BYTES:
                reg = {k: reg[k] for k in ("ts", "seq", "evento", "resultado") if k in reg}
                datos = (json.dumps(reg, separators=(",", ":"), sort_keys=True) + "\n").encode("ascii")
            if self.path:
                flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_BINARY", 0)
                fd = os.open(self.path, flags, 0o640)
                try:
                    os.write(fd, datos)
                finally:
                    os.close(fd)
        finally:
            if bloqueo is not None:
                bloqueo.release()
        if self.use_syslog:  # pragma: no cover
            _syslog.syslog(_syslog.LOG_INFO, datos.decode("ascii").strip())
        return reg
