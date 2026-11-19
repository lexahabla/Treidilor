# -*- coding: utf-8 -*-
"""Construcción y cierre de informes: esquema, huella, filtro de secretos y límite de tamaño."""
from __future__ import annotations

import hashlib
import json
import time

from .config import CHECKS, MAX_REPORT_BYTES, VERSION
from .redact import scan

ESQUEMA = "tai-informe/1"


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def construir(check, datos, avisos, ahora, duracion_ms, peticion=None):
    cuerpo = {
        "esquema": ESQUEMA, "check": check, "generadoEn": iso(ahora), "version": VERSION,
        "etapa": CHECKS[check]["stage"], "duracionMs": int(duracion_ms),
        "datos": datos, "avisos": [str(a)[:120] for a in (avisos or [])][:20],
    }
    if peticion is not None:
        cuerpo["peticion"] = peticion          # identificador ÚNICO de la petición que originó este informe (lo asigna el nombre del archivo de petición)
    return cuerpo


def informe_error(check, motivo, ahora, ids=None, peticion=None):
    """Informe de error MÍNIMO: solo el motivo y, si procede, los identificadores de patrón (jamás el texto detectado)."""
    cuerpo = {"esquema": ESQUEMA, "check": check, "generadoEn": iso(ahora), "version": VERSION, "error": motivo}
    if peticion is not None:
        cuerpo["peticion"] = peticion
    if ids:
        cuerpo["patrones"] = sorted(set(ids))[:10]
    cuerpo["meta"] = {"sha256": hashlib.sha256(canonical(cuerpo).encode("ascii")).hexdigest()}
    return json.dumps(cuerpo, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def finalizar(cuerpo, ahora, max_bytes=MAX_REPORT_BYTES):
    """Devuelve (bytes, estado). estado ∈ {'ok','secreto_detectado','informe_demasiado_grande'}.
    Un informe con cualquier hallazgo del filtro se DESCARTA entero y se sustituye por un informe de error."""
    check = cuerpo.get("check", "desconocido")
    hallazgos = scan(cuerpo)
    if hallazgos:
        return informe_error(check, "secreto_detectado", ahora, [h[0] for h in hallazgos], cuerpo.get("peticion")), "secreto_detectado"
    cuerpo = dict(cuerpo)
    cuerpo["meta"] = {"sha256": hashlib.sha256(canonical(cuerpo).encode("ascii")).hexdigest()}
    datos = json.dumps(cuerpo, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    if len(datos) > max_bytes:
        return informe_error(check, "informe_demasiado_grande", ahora, None, cuerpo.get("peticion")), "informe_demasiado_grande"
    return datos, "ok"


def sha256_de(datos):
    return hashlib.sha256(datos).hexdigest()
