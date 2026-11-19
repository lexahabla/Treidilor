# -*- coding: utf-8 -*-
"""Lectura (SOLO lectura) del atributo de solo-añadir (`chattr +a`) de un archivo, para informar de si el registro está protegido.

Este módulo NUNCA fija atributos: activar `chattr +a` es un paso de instalación que hace root a mano. Si el sistema de archivos o el
sistema operativo no lo permiten, devuelve None («no se sabe»), no False.
"""
from __future__ import annotations

import os
import struct
import sys

try:
    import fcntl
except ImportError:  # pragma: no cover (Windows)
    fcntl = None

FS_IOC_GETFLAGS = 0x80086601      # _IOR('f', 1, long) en Linux de 64 bits
FS_APPEND_FL = 0x00000020


def solo_anadir(path):
    """True si el archivo tiene el atributo de solo-añadir; False si no lo tiene; None si no se puede saber."""
    if fcntl is None or not sys.platform.startswith("linux") or struct.calcsize("l") != 8:
        return None
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    except OSError:
        return None
    try:
        buf = fcntl.ioctl(fd, FS_IOC_GETFLAGS, struct.pack("l", 0))
        return bool(struct.unpack("l", buf)[0] & FS_APPEND_FL)
    except OSError:
        return None
    finally:
        os.close(fd)
