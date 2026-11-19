# -*- coding: utf-8 -*-
"""Límites de frecuencia, cupo diario y concurrencia (portables: bloqueos con O_EXCL y caducidad)."""
from __future__ import annotations

import json
import os
import time

from .pathsafe import RutaNoPermitida, atomic_write, safe_read_file


class Bloqueo:
    """Bloqueo exclusivo NO bloqueante basado en la creación atómica de un fichero, con caducidad."""

    def __init__(self, path, ttl, now=time.time):
        self.path = path
        self.ttl = ttl
        self.now = now
        self._mio = False

    def acquire(self):
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
        for _ in range(2):
            try:
                fd = os.open(self.path, flags, 0o640)
            except FileExistsError:
                try:
                    edad = self.now() - os.stat(self.path).st_mtime
                except OSError:
                    continue
                if edad > self.ttl:   # bloqueo huérfano (proceso muerto)
                    try:
                        os.unlink(self.path)
                    except OSError:
                        return False
                    continue
                return False
            try:
                os.write(fd, str(os.getpid()).encode("ascii"))
            finally:
                os.close(fd)
            self._mio = True
            return True
        return False

    def release(self):
        if self._mio:
            try:
                os.unlink(self.path)
            except OSError:
                pass
            self._mio = False

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *a):
        self.release()


class Cuota:
    """Cupo diario (UTC) e intervalo mínimo por comprobación. Las peticiones rechazadas NO consumen cupo."""

    def __init__(self, state_path, max_daily, now=time.time):
        self.state_path = state_path
        self.lock_path = state_path + ".lock"
        self.max_daily = max_daily
        self.now = now

    def _dia(self):
        return time.strftime("%Y-%m-%d", time.gmtime(self.now()))

    def _leer(self):
        try:
            # lectura segura: sin seguir enlaces simbólicos, solo ficheros regulares y con tamaño máximo (el estado es del usuario restringido)
            est = json.loads(safe_read_file(self.state_path, 8192).decode("utf-8"))
            if (isinstance(est, dict) and isinstance(est.get("count"), int) and not isinstance(est.get("count"), bool)
                    and est["count"] >= 0 and isinstance(est.get("last"), dict) and len(est["last"]) <= 64):
                return est
        except (OSError, RutaNoPermitida, ValueError, UnicodeDecodeError):
            pass
        return {"day": self._dia(), "count": 0, "last": {}}

    def consumir(self, check, intervalo):
        """Devuelve (True, 'ok') o (False, motivo)."""
        lock = Bloqueo(self.lock_path, ttl=5, now=self.now)
        for _ in range(40):          # hasta ~2 s esperando el bloqueo de estado
            if lock.acquire():
                break
            time.sleep(0.05)
        else:
            return False, "ocupado"
        try:
            est = self._leer()
            hoy = self._dia()
            if est.get("day") != hoy:
                est = {"day": hoy, "count": 0, "last": {}}
            ahora = self.now()
            if est["count"] >= self.max_daily:
                return False, "limite_diario"
            ultimo = est["last"].get(check)
            if isinstance(ultimo, (int, float)) and intervalo and ahora - ultimo < intervalo:
                return False, "intervalo_minimo"
            est["count"] += 1
            est["last"][check] = ahora
            atomic_write(self.state_path, json.dumps(est, separators=(",", ":")).encode("utf-8"))
            return True, "ok"
        finally:
            lock.release()
