# -*- coding: utf-8 -*-
"""Manifiesto de integridad del propio sistema de inspección."""
from __future__ import annotations

import hashlib
import json
import os
import stat

from .pathsafe import RutaNoPermitida, safe_read_file

EXCLUIR = ("MANIFEST.json", "__pycache__")


def _hash_fichero(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(65536), b""):
            h.update(trozo)
    return h.hexdigest()


def construir(raiz, comprobar_permisos=True):
    """Devuelve (manifiesto, problemas). `problemas` = enlaces simbólicos o ficheros escribibles por otros."""
    manifiesto, problemas = {}, []
    for dirpath, dirnames, filenames in os.walk(raiz, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUIR)
        for nombre in sorted(filenames):
            if nombre in EXCLUIR:
                continue
            ruta = os.path.join(dirpath, nombre)
            rel = os.path.relpath(ruta, raiz).replace(os.sep, "/")
            st = os.lstat(ruta)
            if stat.S_ISLNK(st.st_mode):
                problemas.append("enlace_simbolico:" + rel)
                continue
            if comprobar_permisos and (st.st_mode & 0o022):
                problemas.append("escribible_por_otros:" + rel)
            manifiesto[rel] = _hash_fichero(ruta)
        for d in dirnames:
            ruta = os.path.join(dirpath, d)
            if os.path.islink(ruta):
                problemas.append("enlace_simbolico:" + os.path.relpath(ruta, raiz).replace(os.sep, "/"))
    return manifiesto, problemas


def guardar(raiz, destino, comprobar_permisos=True):
    man, problemas = construir(raiz, comprobar_permisos)
    datos = json.dumps({"archivos": man}, sort_keys=True, indent=1).encode("ascii")
    with open(destino, "wb") as f:
        f.write(datos)
    return man, problemas


def verificar(raiz, ruta_manifiesto, comprobar_permisos=True):
    """Compara el estado actual con el manifiesto. Devuelve un dict SIN contenido de archivos."""
    try:
        esperado = json.loads(safe_read_file(ruta_manifiesto, 1024 * 1024).decode("utf-8"))["archivos"]
    except (OSError, RutaNoPermitida, ValueError, KeyError):
        return {"ok": False, "motivo": "manifiesto_no_disponible"}
    actual, problemas = construir(raiz, comprobar_permisos)
    faltan = sorted(set(esperado) - set(actual))
    sobran = sorted(set(actual) - set(esperado))
    distintos = sorted(k for k in set(actual) & set(esperado) if actual[k] != esperado[k])
    return {
        "ok": not (faltan or sobran or distintos or problemas),
        "archivos": len(actual), "faltan": len(faltan), "sobran": len(sobran), "distintos": len(distintos),
        "problemas": len(problemas),
        "nombres": (faltan + sobran + distintos + problemas)[:10],
    }
