# -*- coding: utf-8 -*-
"""Resúmenes de registros técnicos: SOLO recuentos y plantillas normalizadas. Nunca líneas crudas.

Se excluyen los servicios de proxy/acceso (contienen IP de visitantes) y se enmascaran correos, IP, tokens,
identificadores y números antes de agregar.
"""
from __future__ import annotations

import json
import re

from ..config import MAX_LINE_CHARS, MAX_LOG_LINES, log_service_allowed
from ..redact import normalize_log_message

_NIVELES = (
    ("error", re.compile(r"\b(error|fatal|exception|panic|critical|failed)\b", re.IGNORECASE)),
    ("aviso", re.compile(r"\b(warn|warning|deprecated)\b", re.IGNORECASE)),
)


def _nivel(linea):
    for nombre, rx in _NIVELES:
        if rx.search(linea):
            return nombre
    return "info"


# Fragmentos de mensajes cuya aparición en el resumen se considera segura (no contienen datos variables). Todo lo demás se CUENTA, pero no se muestra,
# hasta validar más plantillas con muestras controladas (`ajustes.json` → `plantillas_registro`).
PLANTILLAS_SEGURAS = ("registered runner", "runner process exited on idle timeout", "experimentalwarning")


def registros_resumen(ctx):
    servicios = [s for s in (ctx.settings.get("servicios_registros") or []) if log_service_allowed(s)]
    if not servicios:
        return {"estado": "no_configurado"}, ["servicios_de_registro_no_configurados"]
    resumen, avisos = [], []
    for srv in servicios[:5]:
        r = ctx.runner.run("docker_service_logs", arg=srv)
        if not r.ok:
            avisos.append("registros_no_disponibles:" + srv[:30])
            continue
        lineas = [l for l in r.salida.splitlines() if l.strip()][-MAX_LOG_LINES:]
        niveles, plantillas = {"error": 0, "aviso": 0, "info": 0}, {}
        for l in lineas:
            niveles[_nivel(l)] += 1
            plantilla = normalize_log_message(l, MAX_LINE_CHARS)
            if plantilla:
                plantillas[plantilla] = plantillas.get(plantilla, 0) + 1
        permitidas = PLANTILLAS_SEGURAS + tuple(ctx.settings.get("plantillas_registro") or ())
        visibles = {m: n for m, n in plantillas.items() if any(p in m.lower() for p in permitidas)}
        top = sorted(visibles.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
        resumen.append({"servicio": srv, "lineas": len(lineas), "por_nivel": niveles,
                        "mensajes_frecuentes": [{"veces": n, "mensaje": m} for m, n in top],
                        "mensajes_no_mostrados": sum(plantillas.values()) - sum(visibles.values())})
    return {"servicios": resumen}, avisos


def auditoria_resumen(ctx):
    eventos, checks, resultados, rechazadas, lineas_ok = {}, {}, {}, 0, 0
    primero = ultimo = None
    for ruta in ctx.audit_paths:
        texto = ctx.read_audit_tail(ruta)
        if texto is None:
            continue
        for linea in texto.splitlines():
            try:
                reg = json.loads(linea)
            except ValueError:
                continue
            if not isinstance(reg, dict):
                continue
            lineas_ok += 1
            ev, ck, rs = str(reg.get("evento", "-"))[:30], str(reg.get("check", "-"))[:40], str(reg.get("resultado", "-"))[:30]
            eventos[ev] = eventos.get(ev, 0) + 1
            if ck != "-":
                checks[ck] = checks.get(ck, 0) + 1
            resultados[rs] = resultados.get(rs, 0) + 1
            if rs in ("orden_rechazada", "no_habilitada", "sin_orden"):
                rechazadas += 1
            ts = str(reg.get("ts", ""))[:20]
            if ts:
                primero = ts if primero is None or ts < primero else primero
                ultimo = ts if ultimo is None or ts > ultimo else ultimo
    return {"registros": lineas_ok, "por_evento": eventos, "por_comprobacion": checks, "por_resultado": resultados,
            "ordenes_rechazadas": rechazadas, "desde": primero, "hasta": ultimo}, []
