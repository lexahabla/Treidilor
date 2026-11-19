# -*- coding: utf-8 -*-
"""Límites de frecuencia, cupo diario y concurrencia."""
import os
import threading
import unittest

import helpers as H
from tai_inspect.limits import Bloqueo, Cuota


class Limites(unittest.TestCase):
    def setUp(self):
        self.ent = H.Entorno()
        self.reloj = H.Reloj()

    def tearDown(self):
        self.ent.limpiar()

    def cuota(self, max_daily=60):
        return Cuota(os.path.join(self.ent.state, "cuota.json"), max_daily, now=self.reloj.now)

    def test_cupo_diario_exacto(self):
        c = self.cuota(60)
        for i in range(60):
            self.assertEqual(c.consumir("x", 0), (True, "ok"), i)
        self.assertEqual(c.consumir("x", 0), (False, "limite_diario"))

    def test_renovacion_a_medianoche_utc(self):
        c = self.cuota(2)
        c.consumir("x", 0), c.consumir("x", 0)
        self.assertFalse(c.consumir("x", 0)[0])
        self.reloj.t += 86400
        self.assertTrue(c.consumir("x", 0)[0])

    def test_intervalo_minimo_por_comprobacion_independiente(self):
        c = self.cuota()
        self.assertTrue(c.consumir("a", 300)[0])
        self.assertEqual(c.consumir("a", 300), (False, "intervalo_minimo"))
        self.assertTrue(c.consumir("b", 300)[0], "otra comprobación no se ve afectada")
        self.reloj.t += 301
        self.assertTrue(c.consumir("a", 300)[0])

    def test_las_rechazadas_no_consumen_cupo(self):
        c = self.cuota(3)
        self.assertTrue(c.consumir("a", 300)[0])
        for _ in range(20):
            self.assertFalse(c.consumir("a", 300)[0])
        self.assertTrue(c.consumir("b", 300)[0])
        self.assertTrue(c.consumir("c", 300)[0])
        self.assertEqual(c.consumir("d", 300), (False, "limite_diario"))

    def test_estado_corrupto_no_rompe(self):
        c = self.cuota(5)
        with open(c.state_path, "w") as f:
            f.write("{no es json")
        self.assertTrue(c.consumir("a", 0)[0])
        with open(c.state_path, "w") as f:
            f.write('{"day": 5, "count": "x"}')
        self.assertTrue(c.consumir("a", 0)[0])

    def test_concurrencia_de_hilos_respeta_el_cupo(self):
        c = self.cuota(5)
        ok, lock = [], threading.Lock()

        def tarea(i):
            r = c.consumir("c%d" % i, 0)
            with lock:
                ok.append(r[0])
        hilos = [threading.Thread(target=tarea, args=(i,)) for i in range(15)]
        [h.start() for h in hilos]
        [h.join() for h in hilos]
        self.assertEqual(sum(ok), 5)

    def test_bloqueo_exclusivo_y_huerfano(self):
        ruta = os.path.join(self.ent.state, "x.lock")
        a, b = Bloqueo(ruta, 10, now=self.reloj.now), Bloqueo(ruta, 10, now=self.reloj.now)
        self.assertTrue(a.acquire())
        self.assertFalse(b.acquire())
        a.release()
        self.assertTrue(b.acquire())
        b.release()
        open(ruta, "w").close()
        os.utime(ruta, (self.reloj.t - 100, self.reloj.t - 100))
        self.assertTrue(Bloqueo(ruta, 10, now=self.reloj.now).acquire(), "un bloqueo huérfano caduca")

    def test_valores_iniciales_aprobados(self):
        from tai_inspect import config
        self.assertEqual((config.MAX_REPORT_BYTES, config.MAX_DAILY_REQUESTS, config.MAX_CONCURRENT), (65536, 60, 1))
        self.assertEqual((config.GATE_WAIT_SECONDS, config.CHECK_TIMEOUT_SECONDS, config.PSQL_STATEMENT_TIMEOUT_MS), (20, 10, 5000))
        self.assertEqual((config.MAX_LOG_LINES, config.MAX_LINE_CHARS), (500, 200))
        for nombre, meta in config.CHECKS.items():
            self.assertGreaterEqual(meta["interval"], 30, nombre)
            if nombre.startswith(("docker-", "n8n-", "postgres-", "registros-", "auditoria-", "seguridad-", "integridad-")):
                self.assertGreaterEqual(meta["interval"], 300, nombre)


if __name__ == "__main__":
    unittest.main()
