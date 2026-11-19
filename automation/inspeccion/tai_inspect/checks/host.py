# -*- coding: utf-8 -*-
"""Comprobaciones del host SIN privilegios (las ejecuta el propio gate)."""
from __future__ import annotations

import ipaddress
import re

from ..config import MAX_LIST_ITEMS


def _gib(b):
    return round(b / 1073741824.0, 1)


def recursos(ctx):
    datos, avisos = {"cpus": ctx.cpus()}, []
    la = ctx.read_text("loadavg")
    try:
        p = la.split()
        datos["carga"] = {"1m": float(p[0]), "5m": float(p[1]), "15m": float(p[2])}
    except (AttributeError, IndexError, ValueError):
        avisos.append("carga_no_disponible")
    mem = ctx.read_text("meminfo")
    try:
        kb = {}
        for linea in mem.splitlines():
            m = re.match(r"^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s*kB", linea)
            if m:
                kb[m.group(1)] = int(m.group(2))
        total, disp = kb["MemTotal"], kb["MemAvailable"]
        datos["memoria"] = {"total_gib": _gib(total * 1024), "disponible_gib": _gib(disp * 1024),
                            "usada_pct": round(100.0 * (total - disp) / total, 1)}
        st, sf = kb.get("SwapTotal", 0), kb.get("SwapFree", 0)
        datos["swap"] = {"total_gib": _gib(st * 1024), "usada_gib": _gib((st - sf) * 1024)}
    except (AttributeError, KeyError, ZeroDivisionError):
        avisos.append("memoria_no_disponible")
    up = ctx.read_text("uptime")
    try:
        datos["uptime_horas"] = round(float(up.split()[0]) / 3600.0, 1)
    except (AttributeError, IndexError, ValueError):
        avisos.append("uptime_no_disponible")
    discos = []
    for punto in ctx.ALLOWED_DISKS:
        sv = ctx.disk(punto)
        if sv is None:
            continue
        total = sv.f_blocks * sv.f_frsize
        libre = sv.f_bavail * sv.f_frsize
        if total <= 0:
            continue
        discos.append({"punto": punto, "total_gib": _gib(total), "libre_gib": _gib(libre),
                       "usado_pct": round(100.0 * (total - libre) / total, 1),
                       "inodos_usados_pct": round(100.0 * (sv.f_files - sv.f_ffree) / sv.f_files, 1) if sv.f_files else None})
    datos["discos"] = discos
    return datos, avisos


def _ambito(direccion):
    """Clasifica una dirección local de `ss` SIN conservarla."""
    d = direccion.strip("[]").split("%")[0]
    if d in ("*", "", "::", "0.0.0.0"):
        return "todas"
    try:
        ip = ipaddress.ip_address(d)
    except ValueError:
        return "otra"
    if ip.is_unspecified:
        return "todas"
    if ip.is_loopback:
        return "loopback"
    if ip.is_private or ip.is_link_local:
        return "privada"
    return "publica"


def red(ctx):
    r = ctx.runner.run("ss")
    if not r.ok:
        return {"puertos": []}, ["ss_no_disponible"]
    vistos = set()
    for linea in r.salida.splitlines():
        t = linea.split()
        if len(t) < 5:
            continue
        proto = t[0].lower()
        local = t[4]
        if ":" not in local or proto not in ("tcp", "udp"):
            continue
        direccion, puerto = local.rsplit(":", 1)
        if not puerto.isdigit():
            continue
        vistos.add((proto, int(puerto), _ambito(direccion)))
    lista = [{"proto": p, "puerto": n, "ambito": a} for (p, n, a) in sorted(vistos)]
    return {"puertos": lista[:MAX_LIST_ITEMS], "total": len(lista)}, ([] if len(lista) <= MAX_LIST_ITEMS else ["lista_truncada"])


def servicios(ctx):
    r = ctx.runner.run("systemctl_running")
    if not r.ok:
        return {"servicios": []}, ["systemctl_no_disponible"]
    nombres = []
    for linea in r.salida.splitlines():
        t = linea.split()
        if t and t[0].endswith(".service"):
            nombres.append(re.sub(r"[^A-Za-z0-9@_.:-]", "?", t[0][:-8])[:60])
    nombres = sorted(set(nombres))
    return {"activos": len(nombres), "servicios": nombres[:MAX_LIST_ITEMS * 2]}, ([] if len(nombres) <= MAX_LIST_ITEMS * 2 else ["lista_truncada"])


def actualizaciones(ctx):
    r = ctx.runner.run("apt_upgradable")
    datos, avisos = {}, []
    if r.ok:
        lineas = [l for l in r.salida.splitlines() if "[upgradable" in l]
        datos["actualizables"] = len(lineas)
        datos["de_seguridad"] = sum(1 for l in lineas if "-security" in l)
    else:
        avisos.append("apt_no_disponible")
    datos["reinicio_pendiente"] = bool(ctx.exists("reboot_required"))
    return datos, avisos


def tiempo(ctx):
    r = ctx.runner.run("timedatectl")
    if not r.ok:
        return {}, ["timedatectl_no_disponible"]
    kv = {}
    for linea in r.salida.splitlines():
        if "=" in linea:
            k, v = linea.split("=", 1)
            kv[k.strip()] = v.strip()
    return {"ntp_sincronizado": kv.get("NTPSynchronized") == "yes", "zona_horaria": re.sub(r"[^A-Za-z0-9_/+-]", "?", kv.get("Timezone", ""))[:40]}, []
