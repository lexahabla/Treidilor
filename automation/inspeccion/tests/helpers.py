# -*- coding: utf-8 -*-
"""Utilidades de prueba: reloj simulado, ejecutor falso con salidas simuladas y directorios temporales."""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if RAIZ not in sys.path:
    sys.path.insert(0, RAIZ)

from tai_inspect.audit import Audit  # noqa: E402
from tai_inspect.runner import Resultado  # noqa: E402

T0 = 1794000000   # instante simulado


class Reloj(object):
    def __init__(self, t=T0):
        self.t = t

    def now(self):
        return self.t

    def sleep(self, s):
        self.t += s


class RunnerFalso(object):
    """Sustituye al ejecutor real: devuelve salidas SIMULADAS y registra qué se pidió (nunca ejecuta nada)."""

    def __init__(self, canned=None):
        self.canned = canned or {}
        self.llamadas = []

    def run(self, spec_id, arg=None, query_id=None, tabla=None):
        self.llamadas.append((spec_id, arg, query_id, tabla))
        for clave in ((spec_id, arg, query_id, tabla), (spec_id, arg, query_id), (spec_id, arg), spec_id):
            if clave in self.canned:
                v = self.canned[clave]
                return v if isinstance(v, Resultado) else Resultado(rc=0, salida=v)
        return Resultado(error="no_ejecutable")


class Entorno(object):
    """Directorios temporales equivalentes a /var/lib/tai-inspect, /var/log/tai-inspect, etc."""

    def __init__(self):
        self.raiz = tempfile.mkdtemp(prefix="tai-prueba-")
        self.req = self._d("requests")
        self.rep = self._d("reports")
        self.state = self._d("state")
        self.staging = self._d("staging")
        self.cstate = self._d("collector-state")
        self.log = self._d("log")
        self.disable = os.path.join(self.raiz, "DISABLED")
        self.gate_log = os.path.join(self.log, "gate-audit.log")
        self.col_log = os.path.join(self.log, "collector-audit.log")

    def _d(self, n):
        p = os.path.join(self.raiz, n)
        os.makedirs(p)
        return p

    def lineas_auditoria(self, ruta):
        if not os.path.exists(ruta):
            return []
        with open(ruta, encoding="ascii") as f:
            return [json.loads(l) for l in f if l.strip()]

    def limpiar(self):
        shutil.rmtree(self.raiz, ignore_errors=True)


def audit_de(entorno, ruta, reloj):
    return Audit(ruta, now=reloj.now)


# ------------------------- salidas SIMULADAS de comandos (formato esperado) -------------------------
SS = ("tcp   LISTEN 0 4096   0.0.0.0:22     0.0.0.0:*\n"
      "tcp   LISTEN 0 4096   0.0.0.0:80     0.0.0.0:*\n"
      "tcp   LISTEN 0 4096      [::]:443       [::]:*\n"
      "tcp   LISTEN 0 4096 127.0.0.53%lo:53  0.0.0.0:*\n"
      "udp   UNCONN 0 0      10.0.0.5:4789   0.0.0.0:*\n"
      "tcp   LISTEN 0 4096 8.8.4.4:8080    0.0.0.0:*\n")
SYSTEMCTL = ("docker.service loaded active running Docker Application Container Engine\n"
             "ssh.service loaded active running OpenBSD Secure Shell server\n"
             "cron.service loaded active running Regular background program processing daemon\n")
APT = ("Listing...\nlibssl3/jammy-security 3.0.2-0ubuntu1.15 amd64 [upgradable from: 3.0.2-0ubuntu1.14]\n"
       "curl/jammy-updates 7.81.0-1ubuntu1.16 amd64 [upgradable from: 7.81.0-1ubuntu1.15]\n")
TIMEDATECTL = "Timezone=Europe/Madrid\nNTPSynchronized=yes\n"
NODE_LS = "Ready|Active|Leader|27.3.1\n"
SERVICE_LS = ("practice_project_n8n_n8n|replicated|1/1|n8nio/n8n:2.38.6@sha256:" + "ab" * 32 + "|\n"
              "practice_project_n8n_postgres|replicated|1/1|postgres:17|\n"
              "treidilor_web|replicated|0/1|ghcr.io/ejemplo/web:latest|*:4321->4321/tcp\n")
SERVICE_PS = "Running 3 hours ago|\nShutdown 3 hours ago|\nFailed 1 day ago|error\n"
STATS = ("practice_project_n8n_n8n.1.abcdefghijklmnopqrstuvwxy|1.50%|512MiB / 7.6GiB|6.58%|23\n"
         "treidilor_web.1.zyxwvutsrqponmlkjihgfedcb|0.20%|180MiB / 7.6GiB|2.31%|11\n")
NET_LS = "ingress\npractice_project_n8n\n"
NET_INSPECT = "practice_project_n8n|overlay|swarm|false|true|3\n"
DF = "Images|5|3|1.2GB|400MB (33%)\nContainers|3|3|10MB|0B (0%)\n"
SSHD_T = ("port 22\npermitrootlogin without-password\npasswordauthentication yes\npubkeyauthentication yes\n"
          "allowusers alicia bruno\nhostkey /etc/ssh/ssh_host_ed25519_key\nauthorizedkeysfile .ssh/authorized_keys\n"
          "loglevel INFO\nmaxauthtries 6\n")
AUTH_LOG = ("Nov 13 03:11:09 vps sshd[111]: Failed password for root from 198.51.100.7 port 4422 ssh2\n"
            "Nov 13 03:11:12 vps sshd[111]: Invalid user admin from 198.51.100.8 port 4423\n"
            "Nov 13 21:00:00 vps sshd[222]: Accepted publickey for usuario from 203.0.113.50 port 5522 ssh2\n"
            "Nov 14 00:01:01 vps sshd[333]: Failed password for invalid user test from 198.51.100.9 port 4999 ssh2\n")
