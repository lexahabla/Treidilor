# -*- coding: utf-8 -*-
"""Ejecución de comandos FIJOS de solo lectura.

· Una tabla cerrada de comandos (`SPECS`); no existe ninguna vía para ejecutar texto arbitrario.
· Nunca se usa un intérprete de órdenes (`shell=False`); los argumentos variables se validan con una expresión
  regular estricta y se pasan como UN elemento de argv.
· Entorno mínimo (no se hereda nada: ni variables con secretos ni rutas), sin entrada estándar y sin salida de error.
· Tiempo máximo y tamaño máximo de salida por comando.
"""
from __future__ import annotations

import re
import subprocess
import threading

from .config import CHECK_TIMEOUT_SECONDS, MAX_OUTPUT_BYTES, PSQL_STATEMENT_TIMEOUT_MS

DOCKER = "/usr/bin/docker"
_SVC = r"[A-Za-z0-9][A-Za-z0-9_.-]{0,80}"
_CTR = r"[A-Za-z0-9][A-Za-z0-9_.-]{0,120}"
_TABLA = r"data_table_user_[A-Za-z0-9_]{1,40}"

# Consultas SQL FIJAS (solo lectura, sin `SELECT *`, sin columnas de contenido ni de credenciales).
QUERIES = {
    "version": "SELECT split_part(version(), ' ', 2)",
    "tam_bd": "SELECT pg_database_size(current_database())",
    "conexiones": "SELECT count(*) FROM pg_stat_activity",
    "max_conexiones": "SHOW max_connections",
    "tablas_grandes": "SELECT relname, pg_total_relation_size(oid) FROM pg_class WHERE relkind = 'r' ORDER BY 2 DESC LIMIT 10",
    "workflows": "SELECT name, active FROM workflow_entity ORDER BY name LIMIT 50",
    "data_tables": "SELECT id, name FROM data_table ORDER BY name LIMIT 50",
    "ejecuciones_24h": "SELECT status, count(*) FROM execution_entity WHERE \"startedAt\" > now() - interval '24 hours' GROUP BY status",
}
# Plantillas con UN identificador validado (derivado de la propia base de datos y comprobado con regex estricta).
QUERY_TEMPLATES = {
    "filas_tabla": ('SELECT count(*) FROM "{t}"', _TABLA),
    "ultima_fila_tabla": ('SELECT "idEjecucion", "generadoEn" FROM "{t}" ORDER BY id DESC LIMIT 1', _TABLA),
}

_PG_SH = 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "$1"'
_PG_OPTS = "-c default_transaction_read_only=on -c statement_timeout=%d" % PSQL_STATEMENT_TIMEOUT_MS

SPECS = {
    # --- host (sin privilegios) ---
    "ss": {"argv": ["/usr/bin/ss", "-H", "-tuln"]},
    "systemctl_running": {"argv": ["/usr/bin/systemctl", "list-units", "--type=service", "--state=running", "--no-pager", "--no-legend", "--plain"]},
    "apt_upgradable": {"argv": ["/usr/bin/apt", "list", "--upgradable"]},
    "timedatectl": {"argv": ["/usr/bin/timedatectl", "show", "--property=NTPSynchronized,Timezone"]},
    # --- docker (solo lectura; todas con --format de plantilla fija; nunca `inspect` completo) ---
    "docker_node_ls": {"argv": [DOCKER, "node", "ls", "--format", "{{.Status}}|{{.Availability}}|{{.ManagerStatus}}|{{.EngineVersion}}"]},
    "docker_service_ls": {"argv": [DOCKER, "service", "ls", "--format", "{{.Name}}|{{.Mode}}|{{.Replicas}}|{{.Image}}|{{.Ports}}"]},
    "docker_service_ps": {"argv": [DOCKER, "service", "ps", "--no-trunc", "--format", "{{.CurrentState}}|{{if .Error}}error{{end}}", "{arg}"], "arg_re": _SVC},
    "docker_stats": {"argv": [DOCKER, "stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.PIDs}}"]},
    "docker_network_ls": {"argv": [DOCKER, "network", "ls", "--format", "{{.Name}}"]},
    "docker_network_inspect": {"argv": [DOCKER, "network", "inspect", "--format", "{{.Name}}|{{.Driver}}|{{.Scope}}|{{.Internal}}|{{.Attachable}}|{{len .Containers}}", "{arg}"], "arg_re": _SVC},
    "docker_system_df": {"argv": [DOCKER, "system", "df", "--format", "{{.Type}}|{{.TotalCount}}|{{.Active}}|{{.Size}}|{{.Reclaimable}}"]},
    "docker_volume_count": {"argv": [DOCKER, "volume", "ls", "-q"]},
    "docker_service_logs": {"argv": [DOCKER, "service", "logs", "--raw", "--since", "24h", "--tail", "500", "{arg}"], "arg_re": _SVC},
    "docker_ps_by_service": {"argv": [DOCKER, "ps", "--filter", "name={arg}", "--format", "{{.Names}}"], "arg_re": _SVC},
    # --- sistema (root, aislado) ---
    "sshd_t": {"argv": ["/usr/sbin/sshd", "-T"]},
    "journal_ssh": {"argv": ["/usr/bin/journalctl", "-u", "ssh", "-u", "sshd", "--since", "-24h", "--no-pager", "-o", "cat", "-n", "2000"]},
    # --- PostgreSQL: `docker exec` con sesión de SOLO LECTURA y consulta fija ---
    "pg_query": {
        "argv": [DOCKER, "exec", "-e", "PGOPTIONS=" + _PG_OPTS, "{arg}", "sh", "-c", _PG_SH, "_", "{query}"],
        "arg_re": _CTR, "kind": "pg",
    },
}


class ArgumentoNoPermitido(ValueError):
    pass


class Resultado(object):
    __slots__ = ("rc", "salida", "truncada", "tiempo_agotado", "error")

    def __init__(self, rc=None, salida="", truncada=False, tiempo_agotado=False, error=None):
        self.rc = rc
        self.salida = salida
        self.truncada = truncada
        self.tiempo_agotado = tiempo_agotado
        self.error = error

    @property
    def ok(self):
        return self.rc == 0 and not self.tiempo_agotado and self.error is None


def minimal_env():
    return {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C", "HOME": "/nonexistent", "DOCKER_CONFIG": "/nonexistent"}


class Runner(object):
    def __init__(self, specs=None, env=None, cwd=None, timeout=CHECK_TIMEOUT_SECONDS, max_bytes=MAX_OUTPUT_BYTES):
        self.specs = SPECS if specs is None else specs
        self.env = minimal_env() if env is None else env
        self.cwd = cwd
        self.timeout = timeout
        self.max_bytes = max_bytes

    def _argv(self, spec, arg, query_id, tabla):
        argv = []
        for el in spec["argv"]:
            if "{arg}" in el:
                if arg is None or not isinstance(arg, str) or re.fullmatch(spec.get("arg_re", "(?!)"), arg) is None:
                    raise ArgumentoNoPermitido("argumento no permitido")
                argv.append(el.replace("{arg}", arg))
            elif el == "{query}":
                if query_id in QUERIES:
                    argv.append(QUERIES[query_id])
                elif query_id in QUERY_TEMPLATES:
                    plantilla, rx = QUERY_TEMPLATES[query_id]
                    if not isinstance(tabla, str) or re.fullmatch(rx, tabla) is None:
                        raise ArgumentoNoPermitido("identificador no permitido")
                    argv.append(plantilla.replace("{t}", tabla))
                else:
                    raise ArgumentoNoPermitido("consulta no permitida")
            else:
                argv.append(el)
        return argv

    def run(self, spec_id, arg=None, query_id=None, tabla=None):
        spec = self.specs.get(spec_id)
        if spec is None:
            raise ArgumentoNoPermitido("comando no permitido")
        argv = self._argv(spec, arg, query_id, tabla)
        try:
            proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    shell=False, env=self.env, cwd=self.cwd, close_fds=True)
        except OSError:
            return Resultado(error="no_ejecutable")
        bufer, estado = [], {"n": 0, "trunc": False}

        def leer():
            while True:
                trozo = proc.stdout.read(4096)
                if not trozo:
                    break
                resto = self.max_bytes - estado["n"]
                if len(trozo) > resto:
                    bufer.append(trozo[:max(resto, 0)])
                    estado["trunc"] = True
                    try:
                        proc.kill()
                    except OSError:
                        pass
                    break
                bufer.append(trozo)
                estado["n"] += len(trozo)

        hilo = threading.Thread(target=leer, daemon=True)
        hilo.start()
        agotado = False
        try:
            proc.wait(timeout=self.timeout)
        except subprocess.TimeoutExpired:
            agotado = True
            try:
                proc.kill()
            except OSError:
                pass
            proc.wait()
        hilo.join(2)
        salida = b"".join(bufer).decode("utf-8", "replace")
        return Resultado(rc=proc.returncode, salida=salida, truncada=estado["trunc"], tiempo_agotado=agotado)
