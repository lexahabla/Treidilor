# -*- coding: utf-8 -*-
"""Contexto de ejecución de una comprobación: acceso controlado al sistema.

Solo se pueden leer los ficheros de `ALLOWED_FILES` y consultar los discos de `ALLOWED_DISKS`; no existe
ninguna función que reciba una ruta arbitraria.
"""
from __future__ import annotations

import os
import time

from .config import INSTALL_DIR, LOG_DIR, MAX_REPORT_BYTES, load_settings
from .pathsafe import RutaNoPermitida, safe_read_file, safe_read_tail


class Contexto(object):
    ALLOWED_FILES = {
        "loadavg": "/proc/loadavg",
        "meminfo": "/proc/meminfo",
        "uptime": "/proc/uptime",
        "reboot_required": "/var/run/reboot-required",
        "auth_log": "/var/log/auth.log",
    }
    ALLOWED_DISKS = ("/", "/var/lib/docker")

    def __init__(self, runner, settings=None, root="", now=time.time, install_dir=INSTALL_DIR,
                 audit_paths=None, statvfs=None, cpu_count=None, manifest_path=None, gate_audit_path=None, collector_state_dir=None):
        self.runner = runner
        self.settings = settings if settings is not None else load_settings()
        self.root = root
        self.now = now
        self.install_dir = install_dir
        self.audit_paths = list(audit_paths or [LOG_DIR + "/gate-audit.log", LOG_DIR + "/collector-audit.log"])
        self._statvfs = statvfs if statvfs is not None else getattr(os, "statvfs", None)
        self._cpu_count = cpu_count
        self.manifest_path = manifest_path
        self.gate_audit_path = gate_audit_path          # registro del gate (para verificar su integridad frente a las anclas)
        self.collector_state_dir = collector_state_dir  # donde el colector guarda su cupo y sus anclas (root)

    def _path(self, key):
        return self.root + self.ALLOWED_FILES[key]   # KeyError si la clave no está en la lista

    def read_text(self, key, max_bytes=MAX_REPORT_BYTES):
        try:
            return safe_read_file(self._path(key), max_bytes).decode("utf-8", "replace")
        except (OSError, RutaNoPermitida):
            return None

    def read_tail(self, key, max_bytes=512 * 1024):
        try:
            return safe_read_tail(self._path(key), max_bytes).decode("utf-8", "replace")
        except (OSError, RutaNoPermitida):
            return None

    def exists(self, key):
        return os.path.exists(self._path(key))

    def disk(self, mount):
        if mount not in self.ALLOWED_DISKS or self._statvfs is None:
            return None
        try:
            return self._statvfs(self.root + mount)
        except OSError:
            return None

    def cpus(self):
        return self._cpu_count if self._cpu_count is not None else (os.cpu_count() or 0)

    def read_audit_tail(self, path, max_bytes=256 * 1024):
        if path not in self.audit_paths:
            return None
        try:
            return safe_read_tail(path, max_bytes).decode("utf-8", "replace")
        except (OSError, RutaNoPermitida):
            return None
