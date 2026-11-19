# -*- coding: utf-8 -*-
"""Seguridad de SSH (directivas permitidas y RECUENTOS de intentos) e integridad del propio sistema de inspección."""
from __future__ import annotations

import os
import re

from .. import ancla, fsattr, manifest
from ..config import MANIFEST_FILE

# Directivas de sshd que se publican; el resto de `sshd -T` se IGNORA (rutas, claves de host, listas de usuarios…).
_DIRECTIVAS = {
    "permitrootlogin", "passwordauthentication", "pubkeyauthentication", "kbdinteractiveauthentication",
    "permitemptypasswords", "port", "maxauthtries", "logingracetime", "x11forwarding", "allowtcpforwarding",
    "allowagentforwarding", "loglevel", "authenticationmethods", "maxsessions", "clientaliveinterval",
    "clientalivecountmax", "usepam", "permituserenvironment",
}
# Listas de nombres: solo se publica CUÁNTOS hay.
_LISTAS = {"allowusers", "allowgroups", "denyusers", "denygroups"}
_FALLO = re.compile(r"Failed password|Invalid user|authentication failure|Failed publickey|Connection closed by authenticating user", re.IGNORECASE)
_DIA_ISO = re.compile(r"^(\d{4}-\d{2}-\d{2})")
_DIA_SYSLOG = re.compile(r"^([A-Z][a-z]{2}\s+\d{1,2})\s")


def seguridad_ssh(ctx):
    datos, avisos = {}, []
    r = ctx.runner.run("sshd_t")
    if r.ok:
        conf, listas = {}, {}
        for linea in r.salida.splitlines():
            p = linea.split(None, 1)
            if len(p) != 2:
                continue
            k, v = p[0].lower(), p[1].strip()
            if k in _DIRECTIVAS:
                conf[k] = re.sub(r"[^A-Za-z0-9_,.: -]", "?", v)[:40]
            elif k in _LISTAS:
                listas[k] = len(v.split())
        datos["directivas"] = conf
        datos["listas"] = listas
    else:
        avisos.append("sshd_t_no_disponible")
    texto = ctx.read_tail("auth_log")
    por_dia, total = {}, 0
    if texto is not None:
        for linea in texto.splitlines():
            if _FALLO.search(linea):
                m = _DIA_ISO.match(linea) or _DIA_SYSLOG.match(linea)
                dia = m.group(1) if m else "sin_fecha"
                por_dia[dia] = por_dia.get(dia, 0) + 1
                total += 1
        origen = "auth.log"
    else:
        j = ctx.runner.run("journal_ssh")
        origen = "journald"
        if j.ok:
            total = sum(1 for l in j.salida.splitlines() if _FALLO.search(l))
            por_dia = {"ultimas_24h": total}
        else:
            avisos.append("registro_ssh_no_disponible")
            origen = None
    if origen:
        dias = sorted(por_dia)[-7:]
        datos["intentos_fallidos"] = {"origen": origen, "total": total, "por_dia": {d: por_dia[d] for d in dias}}
    return datos, avisos


def integridad(ctx):
    ruta_man = ctx.manifest_path or MANIFEST_FILE
    res = manifest.verificar(ctx.install_dir, ruta_man)
    avisos = [] if res.get("ok") else ["integridad_no_verificada" if res.get("motivo") else "deriva_detectada"]
    datos = {"integridad": res}
    if ctx.gate_audit_path and ctx.collector_state_dir:
        previa = ancla.leer(os.path.join(ctx.collector_state_dir, "ancla-gate.json"))
        v = ancla.verificar(ctx.gate_audit_path, previa)
        datos["registro_gate"] = {
            "ok": bool(v["ok"]), "motivo": v["motivo"], "anclado": previa is not None,
            "seq_anclado": previa["seq"] if previa else None,
            "solo_anadir": fsattr.solo_anadir(ctx.gate_audit_path),     # True/False/None (None = no se puede saber en este sistema)
        }
        if not v["ok"]:
            avisos.append("registro_gate_alterado")
        if datos["registro_gate"]["solo_anadir"] is not True:
            avisos.append("registro_gate_sin_solo_anadir")
    return datos, avisos
