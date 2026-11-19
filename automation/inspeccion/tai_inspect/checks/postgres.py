# -*- coding: utf-8 -*-
"""n8n y PostgreSQL (solo lectura): estado de servicios, metadatos de Data Tables y estado de workflows.

Las consultas son FIJAS (ver `runner.QUERIES`), la sesión es de solo lectura y NO se leen columnas de contenido
(`payload`) ni de credenciales. Los nombres de servicio proceden de `ajustes.json` (propiedad de root) y se validan.
"""
from __future__ import annotations

import re

from ..config import MAX_LIST_ITEMS, valid_service_name
from ..redact import mask_text
from .docker import _imagen

_IDENT = re.compile(r"^[A-Za-z0-9_]{1,63}$")
_ID_TABLA = re.compile(r"^[A-Za-z0-9_]{1,40}$")
_TAG = re.compile(r":([0-9][0-9A-Za-z._-]{0,30})$")


def _contenedor(ctx, servicio):
    if not valid_service_name(servicio):
        return None
    r = ctx.runner.run("docker_ps_by_service", arg=servicio)
    if not r.ok:
        return None
    for nombre in r.salida.split():
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,120}", nombre):
            return nombre
    return None


def _filas(ctx, contenedor, qid, tabla=None):
    r = ctx.runner.run("pg_query", arg=contenedor, query_id=qid, tabla=tabla)
    if not r.ok:
        return None
    return [l.split("|") for l in r.salida.splitlines() if l.strip()]


def _servicio_info(ctx, nombre):
    if not nombre:
        return None
    r = ctx.runner.run("docker_service_ls")
    if not r.ok:
        return None
    for linea in r.salida.splitlines():
        c = linea.split("|")
        if len(c) == 5 and c[0] == nombre:
            m = _TAG.search(re.sub(r"@sha256:[0-9a-f]+", "", c[3]))
            return {"replicas": c[2][:20], "imagen": _imagen(c[3]), "version": m.group(1) if m else None}
    return None


def n8n_estado(ctx):
    s = ctx.settings
    datos, avisos = {}, []
    if not (s.get("servicio_n8n") or s.get("servicio_runner")):
        return {"estado": "no_configurado"}, ["servicios_no_configurados"]
    for clave in ("servicio_n8n", "servicio_runner"):
        info = _servicio_info(ctx, s.get(clave))
        datos[clave.replace("servicio_", "")] = info if info else {"estado": "no_encontrado"}
    if s.get("servicio_n8n"):
        r = ctx.runner.run("docker_service_logs", arg=s["servicio_n8n"])
        if r.ok:
            datos["runners_registrados_24h"] = sum(1 for l in r.salida.splitlines() if re.search(r"registered runner", l, re.IGNORECASE))
        else:
            avisos.append("registros_n8n_no_disponibles")
    return datos, avisos


def postgres_estado(ctx):
    srv = ctx.settings.get("servicio_postgres")
    if not srv:
        return {"estado": "no_configurado"}, ["servicio_postgres_no_configurado"]
    ctr = _contenedor(ctx, srv)
    if not ctr:
        return {"estado": "contenedor_no_encontrado"}, ["contenedor_no_encontrado"]
    datos, avisos = {"estado": "consultado"}, []
    for clave, qid in (("version", "version"), ("tamano_bytes", "tam_bd"), ("conexiones", "conexiones"), ("max_conexiones", "max_conexiones")):
        f = _filas(ctx, ctr, qid)
        if f and f[0]:
            v = f[0][0].strip()
            datos[clave] = int(v) if clave != "version" and v.isdigit() else re.sub(r"[^0-9A-Za-z._-]", "?", v)[:20]
        else:
            avisos.append("consulta_fallida:" + qid)
    f = _filas(ctx, ctr, "tablas_grandes")
    if f is not None:
        datos["tablas_mayores"] = [{"tabla": c[0], "bytes": int(c[1])} for c in f if len(c) == 2 and _IDENT.fullmatch(c[0]) and c[1].isdigit()][:10]
    else:
        avisos.append("consulta_fallida:tablas_grandes")
    return datos, avisos


def n8n_workflows_estado(ctx):
    srv = ctx.settings.get("servicio_postgres")
    if not srv:
        return {"estado": "no_configurado"}, ["servicio_postgres_no_configurado"]
    ctr = _contenedor(ctx, srv)
    if not ctr:
        return {"estado": "contenedor_no_encontrado"}, ["contenedor_no_encontrado"]
    f = _filas(ctx, ctr, "workflows")
    if f is None:
        return {"estado": "consulta_fallida"}, ["consulta_fallida:workflows"]
    lista = []
    for c in f:
        if len(c) == 2:
            lista.append({"nombre": mask_text(c[0])[:80], "activo": c[1].strip().lower() in ("t", "true", "1")})
    return {"total": len(lista), "activos": sum(1 for x in lista if x["activo"]), "workflows": lista[:MAX_LIST_ITEMS]}, []


def n8n_tablas_metadatos(ctx):
    srv = ctx.settings.get("servicio_postgres")
    if not srv:
        return {"estado": "no_configurado"}, ["servicio_postgres_no_configurado"]
    ctr = _contenedor(ctx, srv)
    if not ctr:
        return {"estado": "contenedor_no_encontrado"}, ["contenedor_no_encontrado"]
    f = _filas(ctx, ctr, "data_tables")
    if f is None:
        return {"estado": "consulta_fallida"}, ["consulta_fallida:data_tables"]
    agentes = set(ctx.settings.get("tablas_agentes") or [])
    lista, avisos = [], []
    for c in f[:10]:
        if len(c) != 2 or not _ID_TABLA.fullmatch(c[0]):
            continue
        item = {"nombre": mask_text(c[1])[:60]}
        fisica = "data_table_user_" + c[0]
        n = _filas(ctx, ctr, "filas_tabla", tabla=fisica)
        item["filas"] = int(n[0][0]) if n and n[0] and n[0][0].isdigit() else None
        if c[1] in agentes:      # solo las tablas de instantáneas de los agentes: id de ejecución y fecha de la última fila (sin payload)
            u = _filas(ctx, ctr, "ultima_fila_tabla", tabla=fisica)
            if u and u[0] and len(u[0]) == 2:
                item["ultima"] = {"idEjecucion": re.sub(r"[^A-Za-z0-9_-]", "?", u[0][0])[:30], "generadoEn": re.sub(r"[^0-9TZ:.+-]", "?", u[0][1])[:30]}
            else:
                avisos.append("sin_ultima_fila:" + c[1][:30])
        lista.append(item)
    return {"total": len(f), "tablas": lista}, avisos
