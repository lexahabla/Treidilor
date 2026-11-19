# -*- coding: utf-8 -*-
"""Registro de comprobaciones: nombre → función. Debe coincidir exactamente con `config.CHECKS` (lo verifica una prueba)."""
from __future__ import annotations

from . import docker, host, logs, postgres, sistema

REGISTRY = {
    "host-recursos": host.recursos,
    "host-red": host.red,
    "host-servicios": host.servicios,
    "host-actualizaciones": host.actualizaciones,
    "host-tiempo": host.tiempo,
    "docker-nodos": docker.nodos,
    "docker-servicios": docker.servicios,
    "docker-recursos": docker.recursos,
    "docker-redes": docker.redes,
    "docker-disco": docker.disco,
    "seguridad-ssh": sistema.seguridad_ssh,
    "integridad-inspeccion": sistema.integridad,
    "n8n-estado": postgres.n8n_estado,
    "postgres-estado": postgres.postgres_estado,
    "n8n-tablas-metadatos": postgres.n8n_tablas_metadatos,
    "n8n-workflows-estado": postgres.n8n_workflows_estado,
    "registros-resumen": logs.registros_resumen,
    "auditoria-resumen": logs.auditoria_resumen,
}
