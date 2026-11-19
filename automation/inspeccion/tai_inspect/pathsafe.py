# -*- coding: utf-8 -*-
"""Rutas seguras: nada se lee ni escribe fuera de las rutas autorizadas."""
from __future__ import annotations

import os
import re
import stat

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REQ_RE = re.compile(r"^[0-9a-f]{32}\.req$")


class RutaNoPermitida(Exception):
    """Ruta fuera de lo autorizado, enlace simbólico, fichero no regular o demasiado grande."""


def valid_check_name(s):
    return isinstance(s, str) and 1 <= len(s) <= 40 and s.isascii() and NAME_RE.fullmatch(s) is not None


def safe_join(base, name, pattern):
    """Une `base` y `name` solo si `name` cumple `pattern` y el resultado queda dentro de `base`."""
    if not isinstance(name, str) or "\x00" in name or pattern.fullmatch(name) is None:
        raise RutaNoPermitida("nombre no permitido")
    ruta = os.path.join(base, name)
    base_real = os.path.realpath(base)
    ruta_real = os.path.realpath(ruta)
    if os.path.commonpath([base_real, ruta_real]) != base_real or os.path.dirname(ruta_real) != base_real:
        raise RutaNoPermitida("fuera de la ruta autorizada")
    return ruta


def safe_read_file(path, max_bytes):
    """Lee un fichero regular, sin seguir enlaces, con tamaño máximo. Devuelve bytes."""
    if not isinstance(path, str) or "\x00" in path:
        raise RutaNoPermitida("ruta no válida")
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
        raise RutaNoPermitida("no es un fichero regular")
    if st.st_size > max_bytes:
        raise RutaNoPermitida("fichero demasiado grande")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    fd = os.open(path, flags)
    try:
        st2 = os.fstat(fd)
        if st.st_ino and st2.st_ino and (st.st_ino != st2.st_ino or st.st_dev != st2.st_dev):
            raise RutaNoPermitida("el fichero cambió durante la lectura")
        datos = os.read(fd, max_bytes + 1)
    finally:
        os.close(fd)
    if len(datos) > max_bytes:
        raise RutaNoPermitida("fichero demasiado grande")
    return datos


def safe_read_tail(path, max_bytes):
    """Lee los ÚLTIMOS `max_bytes` de un fichero regular (registros), sin seguir enlaces."""
    if not isinstance(path, str) or "\x00" in path:
        raise RutaNoPermitida("ruta no válida")
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
        raise RutaNoPermitida("no es un fichero regular")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    fd = os.open(path, flags)
    try:
        tam = os.fstat(fd).st_size
        os.lseek(fd, max(0, tam - max_bytes), os.SEEK_SET)
        return os.read(fd, max_bytes)
    finally:
        os.close(fd)


def write_exclusive(path, datos, mode=0o640):
    """Crea un fichero NUEVO (falla si ya existe, no sigue enlaces) y lo sincroniza a disco. Lanza OSError ante disco lleno u otro fallo."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    fd = os.open(path, flags, mode)
    try:
        total = 0
        while total < len(datos):
            total += os.write(fd, datos[total:])
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write(path, datos, mode=0o640):
    """Escritura atómica (temporal + renombrado) en el mismo directorio."""
    directorio = os.path.dirname(path)
    tmp = os.path.join(directorio, ".tmp-%d-%s" % (os.getpid(), os.urandom(6).hex()))
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    fd = os.open(tmp, flags, mode)
    try:
        os.write(fd, datos)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)
