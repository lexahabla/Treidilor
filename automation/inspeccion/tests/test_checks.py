# -*- coding: utf-8 -*-
"""Analizadores de las comprobaciones con salidas SIMULADAS. Se verifica el contenido y que NADA sensible pasa al informe."""
import json
import os
import unittest
from collections import namedtuple

import helpers as H
from tai_inspect import informe, redact
from tai_inspect.checks import REGISTRY
from tai_inspect.config import CHECKS
from tai_inspect.ctx import Contexto
from tai_inspect.runner import Resultado

SV = namedtuple("SV", "f_blocks f_frsize f_bavail f_files f_ffree")


def ctx_con(canned=None, ajustes=None, ent=None):
    ent = ent or H.Entorno()
    base = {"loadavg": "0.52 0.40 0.31 1/300 1234\n", "meminfo": "MemTotal: 8179000 kB\nMemAvailable: 6606000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n", "uptime": "86400.5 1000.0\n"}
    for k, v in base.items():
        ruta = ent.raiz + Contexto.ALLOWED_FILES[k]
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        with open(ruta, "w") as f:
            f.write(v)
    ajustes_def = {"servicio_n8n": "practice_project_n8n_n8n", "servicio_runner": None, "servicio_postgres": "practice_project_n8n_postgres",
                   "servicios_registros": ["practice_project_n8n_n8n"], "tablas_agentes": ["calidad_catalogo_instantaneas"]}
    ajustes_def.update(ajustes or {})
    return Contexto(H.RunnerFalso(canned or {}), settings=ajustes_def, root=ent.raiz, now=H.Reloj().now, statvfs=lambda p: SV(25000000, 4096, 21000000, 6000000, 5500000),
                    cpu_count=2, install_dir=ent.raiz, manifest_path=os.path.join(ent.raiz, "MANIFEST.json")), ent


def ejecutar(nombre, ctx):
    datos, avisos = REGISTRY[nombre](ctx)
    cuerpo = informe.construir(nombre, datos, avisos, H.T0, 1)
    texto, estado = informe.finalizar(cuerpo, H.T0)
    return json.loads(texto), estado


class RegistroDeComprobaciones(unittest.TestCase):
    def test_el_registro_coincide_exactamente_con_la_lista_cerrada(self):
        self.assertEqual(set(REGISTRY), set(CHECKS))


class Host(unittest.TestCase):
    def test_recursos(self):
        ctx, ent = ctx_con()
        try:
            rep, estado = ejecutar("host-recursos", ctx)
            self.assertEqual(estado, "ok")
            d = rep["datos"]
            self.assertEqual(d["cpus"], 2)
            self.assertEqual(d["carga"]["1m"], 0.52)
            self.assertAlmostEqual(d["memoria"]["total_gib"], 7.8, delta=0.1)
            self.assertEqual(d["discos"][0]["punto"], "/")
            self.assertEqual(d["uptime_horas"], 24.0)
        finally:
            ent.limpiar()

    def test_recursos_con_datos_ausentes_o_corruptos_no_falla(self):
        ctx, ent = ctx_con()
        try:
            for k in ("loadavg", "meminfo", "uptime"):
                with open(ent.raiz + Contexto.ALLOWED_FILES[k], "w") as f:
                    f.write("basura\x00\xff no numerico")
            rep, estado = ejecutar("host-recursos", ctx)
            self.assertEqual(estado, "ok")
            self.assertIn("carga_no_disponible", rep["avisos"])
            self.assertIn("memoria_no_disponible", rep["avisos"])
        finally:
            ent.limpiar()

    def test_red_no_publica_direcciones_solo_el_ambito(self):
        ctx, ent = ctx_con({"ss": H.SS})
        try:
            rep, estado = ejecutar("host-red", ctx)
            self.assertEqual(estado, "ok")
            crudo = json.dumps(rep)
            for ip in ("8.8.4.4", "10.0.0.5", "127.0.0.53"):
                self.assertNotIn(ip, crudo)
            puertos = {(p["proto"], p["puerto"], p["ambito"]) for p in rep["datos"]["puertos"]}
            self.assertIn(("tcp", 22, "todas"), puertos)
            self.assertIn(("tcp", 443, "todas"), puertos)
            self.assertIn(("tcp", 53, "loopback"), puertos)
            self.assertIn(("udp", 4789, "privada"), puertos)
            self.assertIn(("tcp", 8080, "publica"), puertos)
        finally:
            ent.limpiar()

    def test_servicios_actualizaciones_y_tiempo(self):
        ctx, ent = ctx_con({"systemctl_running": H.SYSTEMCTL, "apt_upgradable": H.APT, "timedatectl": H.TIMEDATECTL})
        try:
            self.assertEqual(ejecutar("host-servicios", ctx)[0]["datos"]["activos"], 3)
            act = ejecutar("host-actualizaciones", ctx)[0]["datos"]
            self.assertEqual((act["actualizables"], act["de_seguridad"]), (2, 1))
            self.assertEqual(ejecutar("host-tiempo", ctx)[0]["datos"]["ntp_sincronizado"], True)
        finally:
            ent.limpiar()

    def test_comando_que_falla_da_aviso_no_error(self):
        ctx, ent = ctx_con({"ss": Resultado(rc=1, salida="")})
        try:
            rep, estado = ejecutar("host-red", ctx)
            self.assertEqual(estado, "ok")
            self.assertIn("ss_no_disponible", rep["avisos"])
        finally:
            ent.limpiar()


class Docker(unittest.TestCase):
    CANNED = {"docker_node_ls": H.NODE_LS, "docker_service_ls": H.SERVICE_LS, "docker_service_ps": H.SERVICE_PS, "docker_stats": H.STATS,
              "docker_network_ls": H.NET_LS, "docker_network_inspect": H.NET_INSPECT, "docker_system_df": H.DF, "docker_volume_count": "v1\nv2\nv3\n"}

    def test_nodos_servicios_recursos_redes_y_disco(self):
        ctx, ent = ctx_con(self.CANNED)
        try:
            nodos = ejecutar("docker-nodos", ctx)[0]["datos"]
            self.assertTrue(nodos["un_solo_nodo"])
            sv = ejecutar("docker-servicios", ctx)[0]["datos"]
            self.assertEqual(sv["total"], 3)
            web = [s for s in sv["servicios"] if s["nombre"] == "treidilor_web"][0]
            self.assertTrue(web["degradado"])
            self.assertEqual(web["tareas"]["failed"], 1)
            n8n = [s for s in sv["servicios"] if s["nombre"].endswith("_n8n")][0]
            self.assertNotIn("sha256", n8n["imagen"], "el digest de la imagen no debe publicarse")
            self.assertEqual(n8n["imagen"], "n8nio/n8n:2.38.6")
            self.assertEqual(ejecutar("docker-recursos", ctx)[0]["datos"]["contenedores"][0]["mem_pct"], 6.58)
            self.assertEqual(ejecutar("docker-redes", ctx)[0]["datos"]["redes"][0]["driver"], "overlay")
            self.assertEqual(ejecutar("docker-disco", ctx)[0]["datos"]["volumenes"], 3)
        finally:
            ent.limpiar()

    def test_lineas_con_secretos_en_la_salida_de_docker_no_llegan_al_informe(self):
        """Aunque un comando devolviera variables de entorno por error, los analizadores solo conservan campos con formato."""
        sucio = dict(self.CANNED)
        sucio["docker_stats"] = H.STATS + "POSTGRES_PASSWORD=" + "s3cr3t0-canario-largo\nN8N_ENCRYPTION_KEY=" + "Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm\n"
        sucio["docker_service_ls"] = H.SERVICE_LS + "APIKEY=" + "canario-" + "A1b2C3d4E5f6G7h8I9\n"
        ctx, ent = ctx_con(sucio)
        try:
            for nombre in ("docker-recursos", "docker-servicios"):
                rep, estado = ejecutar(nombre, ctx)
                self.assertEqual(estado, "ok", nombre)
                crudo = json.dumps(rep)
                for canario in ("s3cr3t0-canario", "Zx9Qw8Er7Ty6", "canario-A1b2"):
                    self.assertNotIn(canario, crudo)
        finally:
            ent.limpiar()

    def test_un_secreto_dentro_de_un_campo_valido_descarta_el_informe(self):
        sucio = dict(self.CANNED)
        sucio["docker_service_ls"] = "svc|replicated|1/1|registro.interno/app:" + "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8" + "|\n"
        ctx, ent = ctx_con(sucio)
        try:
            rep, estado = ejecutar("docker-servicios", ctx)
            self.assertEqual(estado, "secreto_detectado")
            self.assertNotIn("ghp_", json.dumps(rep))
        finally:
            ent.limpiar()

    def test_formato_inesperado_se_ignora(self):
        ctx, ent = ctx_con({"docker_node_ls": "esto no tiene el formato\n|||||\n", "docker_stats": "a|b\n"})
        try:
            self.assertEqual(ejecutar("docker-nodos", ctx)[0]["datos"]["total"], 0)
            self.assertEqual(ejecutar("docker-recursos", ctx)[0]["datos"]["total"], 0)
        finally:
            ent.limpiar()


class SeguridadSsh(unittest.TestCase):
    def test_solo_directivas_permitidas_y_solo_recuentos_de_intentos(self):
        ctx, ent = ctx_con({"sshd_t": H.SSHD_T})
        try:
            ruta = ent.raiz + Contexto.ALLOWED_FILES["auth_log"]
            os.makedirs(os.path.dirname(ruta), exist_ok=True)
            with open(ruta, "w") as f:
                f.write(H.AUTH_LOG)
            rep, estado = ejecutar("seguridad-ssh", ctx)
            self.assertEqual(estado, "ok")
            crudo = json.dumps(rep)
            for no_debe in ("alicia", "bruno", "ssh_host_ed25519_key", "authorized_keys", "198.51.100", "203.0.113", "usuario", "admin", "test"):
                self.assertNotIn(no_debe, crudo, no_debe)
            self.assertEqual(rep["datos"]["listas"]["allowusers"], 2)
            self.assertEqual(rep["datos"]["directivas"]["permitrootlogin"], "without-password")
            self.assertEqual(rep["datos"]["intentos_fallidos"]["total"], 3)
            self.assertEqual(rep["datos"]["intentos_fallidos"]["por_dia"], {"Nov 13": 2, "Nov 14": 1})
        finally:
            ent.limpiar()

    def test_sin_auth_log_usa_journald(self):
        ctx, ent = ctx_con({"sshd_t": H.SSHD_T, "journal_ssh": "Failed password for x\nAccepted publickey\nInvalid user y\n"})
        try:
            rep, _ = ejecutar("seguridad-ssh", ctx)
            self.assertEqual(rep["datos"]["intentos_fallidos"]["origen"], "journald")
            self.assertEqual(rep["datos"]["intentos_fallidos"]["total"], 2)
        finally:
            ent.limpiar()


class PostgresYN8n(unittest.TestCase):
    def canned(self):
        return {
            "docker_ps_by_service": "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "version"): "17.2\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "tam_bd"): "123456789\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "conexiones"): "7\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "max_conexiones"): "100\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "tablas_grandes"): "execution_entity|50000000\nworkflow_entity|1048576\nmala tabla; DROP|5\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "workflows"): "Calidad del catalogo|t\nAuditor|f\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "data_tables"): "abc123|calidad_catalogo_instantaneas\nxyz789|otra_tabla\nmal id;|x\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "filas_tabla", "data_table_user_abc123"): "1\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "filas_tabla", "data_table_user_xyz789"): "12\n",
            ("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "ultima_fila_tabla", "data_table_user_abc123"): "ex-16|2026-11-13T13:00:00Z\n",
            "docker_service_ls": H.SERVICE_LS,
            ("docker_service_logs", "practice_project_n8n_n8n"): "Registered runner JS\nlinea\nRegistered runner JS\n",
        }

    def test_estado_de_postgres_y_nombres_peligrosos_descartados(self):
        ctx, ent = ctx_con(self.canned())
        try:
            rep, estado = ejecutar("postgres-estado", ctx)
            self.assertEqual(estado, "ok")
            self.assertEqual(rep["datos"]["version"], "17.2")
            self.assertEqual([t["tabla"] for t in rep["datos"]["tablas_mayores"]], ["execution_entity", "workflow_entity"])
            self.assertNotIn("DROP", json.dumps(rep))
        finally:
            ent.limpiar()

    def test_tablas_de_datos_solo_metadatos_y_sin_payload(self):
        ctx, ent = ctx_con(self.canned())
        try:
            rep, estado = ejecutar("n8n-tablas-metadatos", ctx)
            self.assertEqual(estado, "ok")
            t = {x["nombre"]: x for x in rep["datos"]["tablas"]}
            self.assertEqual(t["calidad_catalogo_instantaneas"]["ultima"]["idEjecucion"], "ex-16")
            self.assertNotIn("ultima", t["otra_tabla"], "solo las tablas de los agentes configuradas")
            self.assertNotIn("payload", json.dumps(rep).lower())
            llamadas = [c for c in ctx.runner.llamadas if c[0] == "pg_query"]
            self.assertTrue(all(c[2] in ("data_tables", "filas_tabla", "ultima_fila_tabla", "version") or c[2] for c in llamadas))
            self.assertFalse(any(c[3] and not c[3].startswith("data_table_user_") for c in llamadas))
            self.assertFalse(any("mal" in str(c[3]) for c in llamadas), "un identificador mal formado no debe llegar a una consulta")
        finally:
            ent.limpiar()

    def test_workflows_y_estado_de_n8n(self):
        ctx, ent = ctx_con(self.canned())
        try:
            wf = ejecutar("n8n-workflows-estado", ctx)[0]["datos"]
            self.assertEqual((wf["total"], wf["activos"]), (2, 1))
            n8n = ejecutar("n8n-estado", ctx)[0]["datos"]
            self.assertEqual(n8n["n8n"]["version"], "2.38.6")
            self.assertEqual(n8n["runners_registrados_24h"], 2)
        finally:
            ent.limpiar()

    def test_sin_configuracion_o_sin_contenedor_no_consulta_nada(self):
        ctx, ent = ctx_con({}, ajustes={"servicio_postgres": None})
        try:
            self.assertEqual(ejecutar("postgres-estado", ctx)[0]["datos"]["estado"], "no_configurado")
            self.assertEqual([c for c in ctx.runner.llamadas if c[0] == "pg_query"], [])
        finally:
            ent.limpiar()
        ctx, ent = ctx_con({"docker_ps_by_service": ""})
        try:
            self.assertEqual(ejecutar("n8n-workflows-estado", ctx)[0]["datos"]["estado"], "contenedor_no_encontrado")
        finally:
            ent.limpiar()

    def test_consulta_que_falla_da_aviso(self):
        c = self.canned()
        c[("pg_query", "practice_project_n8n_postgres.1.abcdefghijklmnopqrstuvwxy", "workflows")] = Resultado(rc=1, salida="")
        ctx, ent = ctx_con(c)
        try:
            rep, estado = ejecutar("n8n-workflows-estado", ctx)
            self.assertEqual(rep["datos"]["estado"], "consulta_fallida")
        finally:
            ent.limpiar()


class Registros(unittest.TestCase):
    LOGS = ("2026-11-13 21:00:01 ERROR failed login persona@ejemplo.com from 198.51.100.7 password=Zx9-secreto-largo-1\n"
            "2026-11-13 21:00:02 ERROR failed login otra@ejemplo.com from 198.51.100.8 password=Yy8-secreto-largo-2\n"
            "2026-11-13 21:00:03 WARN slow query 1500 ms\n2026-11-13 21:00:04 INFO Registered runner id 5f3a9c2e-1111-2222-3333-444455556666\n")

    def test_solo_plantillas_y_recuentos_sin_datos_personales(self):
        ctx, ent = ctx_con({("docker_service_logs", "practice_project_n8n_n8n"): self.LOGS})
        try:
            rep, estado = ejecutar("registros-resumen", ctx)
            self.assertEqual(estado, "ok")
            crudo = json.dumps(rep)
            for no_debe in ("persona@", "otra@", "198.51.100", "Zx9-secreto", "Yy8-secreto", "5f3a9c2e", "1500"):
                self.assertNotIn(no_debe, crudo, no_debe)
            s = rep["datos"]["servicios"][0]
            self.assertEqual(s["por_nivel"], {"error": 2, "aviso": 1, "info": 1})
            self.assertEqual(len(s["mensajes_frecuentes"]), 1, "solo se muestran las plantillas validadas")
            self.assertIn("registered runner", s["mensajes_frecuentes"][0]["mensaje"].lower())
            self.assertEqual(s["mensajes_no_mostrados"], 3, "el resto se CUENTA pero no se muestra")
        finally:
            ent.limpiar()

    def test_los_servicios_de_proxy_o_acceso_nunca_se_resumen(self):
        ctx, ent = ctx_con({}, ajustes={"servicios_registros": ["traefik", "mi_proxy_acceso"]})
        try:
            rep, _ = ejecutar("registros-resumen", ctx)
            self.assertEqual(rep["datos"]["estado"], "no_configurado")
            self.assertEqual(ctx.runner.llamadas, [])
        finally:
            ent.limpiar()

    def test_resumen_de_auditoria_solo_recuentos(self):
        ctx, ent = ctx_con()
        try:
            ctx.audit_paths = [ent.gate_log]
            with open(ent.gate_log, "w") as f:
                f.write(json.dumps({"ts": "2026-11-13T21:00:00Z", "evento": "gate", "check": "host-recursos", "resultado": "ok", "origen": "198.51.100.x", "detalle": "texto"}) + "\n")
                f.write(json.dumps({"ts": "2026-11-13T21:01:00Z", "evento": "gate", "resultado": "orden_rechazada", "detalle": "x"}) + "\nbasura no json\n")
            rep, estado = ejecutar("auditoria-resumen", ctx)
            self.assertEqual(estado, "ok")
            self.assertEqual(rep["datos"]["ordenes_rechazadas"], 1)
            self.assertNotIn("198.51.100", json.dumps(rep))
            self.assertNotIn("texto", json.dumps(rep))
        finally:
            ent.limpiar()


if __name__ == "__main__":
    unittest.main()
