# -*- coding: utf-8 -*-
"""Configuración FIJA de la inspección: lista cerrada de comprobaciones, rutas y límites.

Nada de esto se lee del entorno: el usuario SSH no puede cambiar rutas, límites ni la lista cerrada.
Los únicos ficheros de ajuste (`enabled.json`, `ajustes.json`) pertenecen a root, se validan estrictamente y,
si están dañados, el sistema falla CERRADO (no habilita nada).
"""
from __future__ import annotations

import json
import re

from .pathsafe import RutaNoPermitida, safe_read_file

VERSION = "0.1.0-etapa0"

# --- rutas (fijas; las pruebas las sustituyen mediante parámetros, nunca mediante el entorno) ---
INSTALL_DIR = "/opt/tai-inspect"
REQ_DIR = "/var/lib/tai-inspect/requests"
REP_DIR = "/var/lib/tai-inspect/reports"
STATE_DIR = "/var/lib/tai-inspect/state"
LOG_DIR = "/var/log/tai-inspect"
DISABLE_FILE = "/etc/tai-inspect/DISABLED"
ENABLED_FILE = INSTALL_DIR + "/enabled.json"
SETTINGS_FILE = INSTALL_DIR + "/ajustes.json"
MANIFEST_FILE = INSTALL_DIR + "/MANIFEST.json"
VALIDATIONS_FILE = INSTALL_DIR + "/validaciones.json"            # 2.º paso para habilitar comprobaciones SENSIBLES (ver load_enabled)
STAGING_DIR = "/var/lib/tai-inspect/staging"                      # root:tai-inspect 2700: el informe se prepara aquí, ilegible para el gate
COLLECTOR_STATE_DIR = "/var/lib/tai-inspect/collector-state"      # root:root 0700: cupo y anclas del colector (el usuario restringido no puede tocarlo)
GATE_AUDIT_FILE = LOG_DIR + "/gate-audit.log"

# --- límites (valores iniciales aprobados el 13/11/2026) ---
MAX_REPORT_BYTES = 64 * 1024        # tamaño máximo de un informe
MAX_DAILY_REQUESTS = 60             # peticiones por día UTC
MAX_CONCURRENT = 1                  # una petición simultánea
GATE_WAIT_SECONDS = 20              # espera máxima del gate por el informe del colector
GATE_POLL_SECONDS = 0.5
CHECK_TIMEOUT_SECONDS = 10          # tiempo máximo de un comando
MAX_PENDING_REQUESTS = 5            # peticiones procesadas por pasada del colector
MAX_REQUEST_FILE_BYTES = 512        # una petición es un JSON diminuto
MAX_OUTPUT_BYTES = 256 * 1024       # lectura máxima de la salida de un comando
MAX_LOG_LINES = 500
MAX_LINE_CHARS = 200
MAX_LIST_ITEMS = 50
MAX_COMMAND_CHARS = 64              # longitud máxima de la orden SSH aceptada
MAX_AUDIT_BYTES = 4 * 1024 * 1024   # tamaño máximo de un registro de auditoría que se verifica (más: rotarlo)
MAX_PENDING_TOTAL = 200             # peticiones pendientes toleradas; el exceso se descarta (el usuario restringido puede crearlas sin pasar por el gate)
PSQL_STATEMENT_TIMEOUT_MS = 5000

# --- lista cerrada de comprobaciones ---
# kind: 'host' → la ejecuta el propio gate sin privilegios; 'colector' → la ejecuta el colector (root, aislado).
CHECKS = {
    "host-recursos": {"kind": "host", "stage": 2, "interval": 30},
    "host-red": {"kind": "host", "stage": 2, "interval": 30},
    "host-servicios": {"kind": "host", "stage": 2, "interval": 30},
    "host-actualizaciones": {"kind": "host", "stage": 2, "interval": 300},
    "host-tiempo": {"kind": "host", "stage": 2, "interval": 30},
    "docker-nodos": {"kind": "colector", "stage": 3, "interval": 300},
    "docker-servicios": {"kind": "colector", "stage": 3, "interval": 300},
    "docker-recursos": {"kind": "colector", "stage": 3, "interval": 300},
    "docker-redes": {"kind": "colector", "stage": 3, "interval": 300},
    "docker-disco": {"kind": "colector", "stage": 3, "interval": 300},
    "seguridad-ssh": {"kind": "colector", "stage": 3, "interval": 300},
    "integridad-inspeccion": {"kind": "colector", "stage": 3, "interval": 300},
    "n8n-estado": {"kind": "colector", "stage": 4, "interval": 300},
    "postgres-estado": {"kind": "colector", "stage": 4, "interval": 300},
    "n8n-tablas-metadatos": {"kind": "colector", "stage": 4, "interval": 300},
    "n8n-workflows-estado": {"kind": "colector", "stage": 4, "interval": 300},
    "registros-resumen": {"kind": "colector", "stage": 5, "interval": 300},
    "auditoria-resumen": {"kind": "colector", "stage": 5, "interval": 300},
}

# Comprobaciones SENSIBLES: su salida procede de Docker, PostgreSQL, registros o de datos de autenticación. Permanecen DESHABILITADAS
# aunque figuren en `enabled.json` hasta que exista una validación con muestras controladas (`validaciones.json`).
SENSIBLES = (
    "docker-nodos", "docker-servicios", "docker-recursos", "docker-redes", "docker-disco", "seguridad-ssh",
    "n8n-estado", "postgres-estado", "n8n-tablas-metadatos", "n8n-workflows-estado", "registros-resumen",
)
for _n in SENSIBLES:
    CHECKS[_n]["sensible"] = True


def es_sensible(nombre):
    return bool(CHECKS.get(nombre, {}).get("sensible"))


_SERVICE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$")
# Servicios cuyos registros NUNCA se resumen (contienen IP de visitantes u otros datos personales).
_LOG_DENY_RE = re.compile(r"(traefik|proxy|access|nginx|caddy)", re.IGNORECASE)


def valid_service_name(name):
    return isinstance(name, str) and _SERVICE_RE.fullmatch(name) is not None and name.isascii()


def log_service_allowed(name):
    return valid_service_name(name) and _LOG_DENY_RE.search(name) is None


def _load_json_file(path, max_bytes=16 * 1024):
    try:
        raw = safe_read_file(path, max_bytes)
        return json.loads(raw.decode("utf-8"))
    except (OSError, RutaNoPermitida, ValueError, UnicodeDecodeError):
        return None


_HEX64 = re.compile(r"[0-9a-f]{64}")


def load_validated(path=VALIDATIONS_FILE):
    """Comprobaciones sensibles con una validación registrada: {"<check>": {"muestra_sha256": "<64 hex>"}}. Falla CERRADO."""
    data = _load_json_file(path)
    if not isinstance(data, dict):
        return set()
    validas = set()
    for nombre, reg in data.items():
        if nombre in CHECKS and isinstance(reg, dict) and isinstance(reg.get("muestra_sha256"), str) and _HEX64.fullmatch(reg["muestra_sha256"]):
            validas.add(nombre)
    return validas


def load_enabled(path=ENABLED_FILE, validations=VALIDATIONS_FILE):
    """Comprobaciones habilitadas. Falla CERRADO: archivo ausente/dañado → ninguna.
    Las SENSIBLES exigen además una entrada en `validaciones.json` (dos pasos, ambos de root); sin ella siguen deshabilitadas."""
    data = _load_json_file(path)
    if not isinstance(data, list):
        return set()
    pedidas = {n for n in data if isinstance(n, str) and n in CHECKS}
    validadas = load_validated(validations)
    return {n for n in pedidas if not es_sensible(n) or n in validadas}


def load_settings(path=SETTINGS_FILE):
    """Ajustes de servicios (nombres de servicios de Swarm). Valores inválidos se ignoran (no se confía en el archivo)."""
    data = _load_json_file(path)
    ajustes = {"servicio_n8n": None, "servicio_runner": None, "servicio_postgres": None, "servicios_registros": [], "tablas_agentes": [], "plantillas_registro": []}
    if not isinstance(data, dict):
        return ajustes
    for clave in ("servicio_n8n", "servicio_runner", "servicio_postgres"):
        v = data.get(clave)
        if valid_service_name(v):
            ajustes[clave] = v
    regs = data.get("servicios_registros")
    if isinstance(regs, list):
        ajustes["servicios_registros"] = [s for s in regs if log_service_allowed(s)][:10]
    plantillas = data.get("plantillas_registro")
    if isinstance(plantillas, list):          # fragmentos (minúsculas) de mensajes de registro que SÍ pueden mostrarse, validados con una muestra controlada
        ajustes["plantillas_registro"] = [t for t in plantillas if isinstance(t, str) and re.fullmatch(r"[a-z0-9 ._:/-]{3,60}", t)][:20]
    tabs = data.get("tablas_agentes")
    if isinstance(tabs, list):
        ajustes["tablas_agentes"] = [t for t in tabs if isinstance(t, str) and re.fullmatch(r"[a-z][a-z0-9_]{2,60}", t)][:5]
    return ajustes
