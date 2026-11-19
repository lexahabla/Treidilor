# -*- coding: utf-8 -*-
"""Comprobaciones de Docker/Swarm de SOLO LECTURA (las ejecuta el colector). Todas usan plantillas --format fijas."""
from __future__ import annotations

import re

from ..config import MAX_LIST_ITEMS

_DIGEST = re.compile(r"@sha256:[0-9a-f]+")
_SEGURO = re.compile(r"[^A-Za-z0-9_.:/@+-]")


def _imagen(s):
    return _SEGURO.sub("?", _DIGEST.sub("", s))[:80]


def _campos(linea, n):
    partes = linea.split("|")
    return partes if len(partes) == n else None


def nodos(ctx):
    r = ctx.runner.run("docker_node_ls")
    if not r.ok:
        return {"nodos": []}, ["docker_node_ls_no_disponible"]
    lista = []
    for linea in r.salida.splitlines():
        c = _campos(linea, 4)
        if c:
            lista.append({"estado": c[0][:20], "disponibilidad": c[1][:20], "rol": (c[2] or "worker")[:20], "version_motor": re.sub(r"[^0-9A-Za-z._+-]", "?", c[3])[:20]})
    return {"total": len(lista), "un_solo_nodo": len(lista) == 1, "nodos": lista[:10]}, []


def servicios(ctx):
    r = ctx.runner.run("docker_service_ls")
    if not r.ok:
        return {"servicios": []}, ["docker_service_ls_no_disponible"]
    avisos, lista = [], []
    for linea in r.salida.splitlines():
        c = _campos(linea, 5)
        if not c:
            continue
        m = re.match(r"^(\d+)/(\d+)", c[2])
        item = {"nombre": re.sub(r"[^A-Za-z0-9_.-]", "?", c[0])[:80], "modo": c[1][:20], "replicas": c[2][:20],
                "degradado": bool(m and m.group(1) != m.group(2)), "imagen": _imagen(c[3]),
                "puertos": _SEGURO.sub("?", c[4]).replace("?", " ")[:80]}
        lista.append(item)
    for item in lista[:20]:
        pr = ctx.runner.run("docker_service_ps", arg=item["nombre"]) if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,80}", item["nombre"]) else None
        if pr is not None and pr.ok:
            estados = {"running": 0, "failed": 0, "shutdown": 0, "rejected": 0, "con_error": 0}
            for l2 in pr.salida.splitlines():
                p = l2.split("|")
                est = p[0].split()[0].lower() if p and p[0].split() else ""
                if est in estados:
                    estados[est] += 1
                if len(p) > 1 and p[1] == "error":
                    estados["con_error"] += 1
            item["tareas"] = estados
    return {"total": len(lista), "servicios": lista[:MAX_LIST_ITEMS]}, avisos + ([] if len(lista) <= MAX_LIST_ITEMS else ["lista_truncada"])


def recursos(ctx):
    r = ctx.runner.run("docker_stats")
    if not r.ok:
        return {"contenedores": []}, ["docker_stats_no_disponible"]
    lista = []
    for linea in r.salida.splitlines():
        c = _campos(linea, 5)
        if not c or not re.match(r"^[0-9.]+%$", c[1]) or not re.match(r"^[0-9.]+%$", c[3]):
            continue
        lista.append({"nombre": re.sub(r"[^A-Za-z0-9_.-]", "?", c[0])[:80], "cpu_pct": float(c[1][:-1]),
                      "memoria": re.sub(r"[^0-9A-Za-z. /]", "?", c[2])[:30], "mem_pct": float(c[3][:-1]),
                      "procesos": int(c[4]) if c[4].isdigit() else None})
    lista.sort(key=lambda x: -x["mem_pct"])
    return {"total": len(lista), "contenedores": lista[:MAX_LIST_ITEMS]}, []


def redes(ctx):
    r = ctx.runner.run("docker_network_ls")
    if not r.ok:
        return {"redes": []}, ["docker_network_ls_no_disponible"]
    lista = []
    for nombre in r.salida.split():
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,80}", nombre):
            continue
        ri = ctx.runner.run("docker_network_inspect", arg=nombre)
        if not ri.ok:
            continue
        c = _campos(ri.salida.strip(), 6)
        if c:
            lista.append({"nombre": nombre, "driver": c[1][:20], "ambito": c[2][:20], "interna": c[3] == "true",
                          "adjuntable": c[4] == "true", "contenedores": int(c[5]) if c[5].isdigit() else None})
        if len(lista) >= 30:
            break
    return {"total": len(lista), "redes": lista}, []


def disco(ctx):
    r = ctx.runner.run("docker_system_df")
    if not r.ok:
        return {}, ["docker_system_df_no_disponible"]
    tipos = []
    for linea in r.salida.splitlines():
        c = _campos(linea, 5)
        if c:
            tipos.append({"tipo": c[0][:30], "total": c[1][:10], "activos": c[2][:10], "tamano": re.sub(r"[^0-9A-Za-z. ()%]", "?", c[3])[:20], "recuperable": re.sub(r"[^0-9A-Za-z. ()%]", "?", c[4])[:30]})
    vol = ctx.runner.run("docker_volume_count")
    datos = {"tipos": tipos[:10]}
    if vol.ok:
        datos["volumenes"] = len([l for l in vol.salida.splitlines() if l.strip()])
    return datos, []
