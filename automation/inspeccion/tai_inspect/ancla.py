# -*- coding: utf-8 -*-
"""Anclas de integridad del registro de auditoría del gate.

El usuario restringido es propietario de `gate-audit.log` (necesita añadir líneas), así que PODRÍA reescribirlo. Esto no se puede impedir solo
con permisos; se combina: (1) `chattr +a` si el sistema de archivos lo admite (a verificar en el servidor), (2) la copia en `syslog`/`journald`
y (3) estas ANCLAS: el colector (root) guarda, en un directorio que el usuario restringido no puede leer ni escribir, el tamaño, el último `seq`
y la huella SHA-256 del PREFIJO verificado del registro. En el pase siguiente se comprueba que ese prefijo no ha cambiado.

Garantía y límite: cualquier modificación, truncado o borrado de lo ANCLADO se detecta; lo escrito después del último ancla puede alterarse
sin que se note hasta el siguiente ancla (ventana = intervalo entre pases del colector), salvo por huecos/repeticiones en `seq`.
"""
from __future__ import annotations

import hashlib
import json

from .config import MAX_AUDIT_BYTES
from .pathsafe import RutaNoPermitida, safe_read_file


def leer(path):
    """Ancla guardada (dict) o None si no existe o no es válida."""
    try:
        a = json.loads(safe_read_file(path, 4096).decode("utf-8"))
    except (OSError, RutaNoPermitida, ValueError, UnicodeDecodeError):
        return None
    if (isinstance(a, dict) and isinstance(a.get("bytes"), int) and isinstance(a.get("seq"), int) and isinstance(a.get("sha256"), str)
            and len(a["sha256"]) == 64 and a["bytes"] >= 0 and a["seq"] >= 0):
        return a
    return None


def _analizar(datos):
    """Analiza el prefijo de líneas COMPLETAS. Devuelve (ancla, problemas)."""
    fin = datos.rfind(b"\n") + 1                       # una línea a medio escribir no se ancla
    prefijo = datos[:fin]
    problemas, anterior, invalidas, lineas = [], None, 0, 0
    for crudo in prefijo.split(b"\n")[:-1]:
        lineas += 1
        try:
            seq = json.loads(crudo.decode("ascii")).get("seq")
        except (ValueError, UnicodeDecodeError, AttributeError):
            invalidas += 1
            continue
        if not isinstance(seq, int) or isinstance(seq, bool):
            invalidas += 1
            continue
        if anterior is not None and seq != anterior + 1:
            problemas.append("secuencia_con_huecos")
        anterior = seq
    if invalidas:
        problemas.append("lineas_invalidas")
    ancla = {"bytes": len(prefijo), "seq": anterior or 0, "lineas": lineas, "sha256": hashlib.sha256(prefijo).hexdigest()}
    return ancla, sorted(set(problemas))


def verificar(path, previa):
    """Compara el registro actual con el ancla previa. Devuelve {'ok': bool, 'motivo': str|None, 'ancla': dict|None}.
    Si `ok`, `ancla` es la nueva ancla a guardar. Si no, NO debe sustituirse la ancla previa."""
    try:
        datos = safe_read_file(path, MAX_AUDIT_BYTES)
    except FileNotFoundError:
        return {"ok": previa is None, "motivo": None if previa is None else "registro_ausente", "ancla": None}
    except RutaNoPermitida:
        return {"ok": False, "motivo": "registro_no_verificable", "ancla": None}
    except OSError:
        return {"ok": False, "motivo": "registro_ilegible", "ancla": None}
    if previa is not None:
        if len(datos) < previa["bytes"]:
            return {"ok": False, "motivo": "registro_truncado", "ancla": None}
        if hashlib.sha256(datos[:previa["bytes"]]).hexdigest() != previa["sha256"]:
            return {"ok": False, "motivo": "historial_modificado", "ancla": None}
    nueva, problemas = _analizar(datos)
    if previa is not None and nueva["seq"] < previa["seq"]:
        problemas.append("secuencia_retrocede")
    if problemas:
        return {"ok": False, "motivo": problemas[0], "ancla": None}
    return {"ok": True, "motivo": None, "ancla": nueva}
