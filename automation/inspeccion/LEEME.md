# Inspección automática del VPS — ETAPA 0 (solo desarrollo y pruebas locales)

**Nada de esto está instalado ni ejecutado en producción.** Es el código de la arquitectura D (gate + colector + comprobaciones de
solo lectura) escrito y probado en local con datos simulados. Diseño: `../docs/INSPECCION-AUTOMATICA-VPS-DISENO.md`; informe de la
etapa 0: `../docs/INSPECCION-ETAPA-0-INFORME.md`.

## Contenido
| Ruta | Qué es |
|---|---|
| `tai_inspect/` | Paquete Python (solo biblioteca estándar, 3.8+): `gate`, `collector`, `runner` (comandos fijos), `redact` (filtro de secretos), `audit` (con `seq` correlativo), `ancla` (anclas de integridad del registro del gate), `fsattr` (lectura del atributo de solo-añadir), `limits`, `pathsafe`, `manifest`, `informe`, `ctx` y `checks/` |
| `bin/` | Lanzadores (`tai-gate`, `tai-collector`, `tai-manifest`), con `#!/usr/bin/python3 -I` y finales de línea LF |
| `deploy/` | **Plantillas** de `sshd` (`sshd_config.d/00-tai-inspect.conf`, `Match User`), `authorized_keys` (clave marcador; se instala en un archivo de ROOT), unidades `systemd` y `LEEME-DESPLIEGUE.md` (usuario con shell `/bin/sh`, contraseña `*`, home `root:root` 0555). No se instalan en esta etapa |
| `tests/` | 190 pruebas (`unittest`): datos simulados, regresión de H1/H4/H5, regresión de la revisión independiente R1–R5 (`test_revision_independiente.py`) y 27 de Linux real (`test_linux_real.py`, solo en Linux; ver `../docs/INSPECCION-ETAPA-0-VALIDACION-LINUX.md` para repetirlas en contenedores aislados). `tests/ssh/prueba_ssh.sh` (64 comprobaciones) levanta un `sshd` temporal en un contenedor aislado (solo 127.0.0.1, usuarios y claves ficticios) para probar el bloque `Match`; no es producto |

## Cómo se prueba (sin Docker, sin red, sin instalar nada)
```bash
cd automation/inspeccion
python -W error::SyntaxWarning -m unittest discover -s tests
```
Las pruebas no se conectan a ningún sitio, no usan credenciales reales y solo escriben en directorios temporales que borran.

## Reglas que no deben romperse
- La lista de comprobaciones (`config.CHECKS`) es **cerrada**; no hay argumentos libres.
- Todo comando está en `runner.SPECS` (rutas absolutas, `shell=False`, entorno mínimo, `--format` fijo; nunca `docker inspect`).
- Un informe con **cualquier** hallazgo del filtro de secretos se **descarta entero**.
- Un cambio en estos archivos exige regenerar el manifiesto y revisión del propietario.
- El gate **audita antes de ejecutar**: sin poder registrar la intención no ejecuta nada (código 9). Ante cualquier fallo interno el cliente solo ve `error interno` (códigos 8 o 9), sin trazas ni rutas.
- El colector **aísla cada petición**: una petición hostil o defectuosa se descarta y no detiene a las demás.
- **Un informe solo se publica si su resultado quedó registrado**: se prepara en `staging` (ilegible para el gate), se audita el resultado y solo entonces se publica con un renombrado atómico. Si el resultado no se puede registrar (disco lleno, permisos…) no se publica nada y la petición se conserva.
- **Correspondencia por identificador**: el informe lleva el identificador único de la petición (el nombre de su archivo, 32 hexadecimales aleatorios) y el gate solo entrega el informe con SU identificador y SU comprobación. No se empareja por fecha.
- El colector aplica **sus propios límites** (cupo diario, intervalo mínimo, máximo de peticiones pendientes) con estado de root: el usuario restringido puede crear peticiones sin pasar por el gate.
- El historial del gate lleva `seq` correlativo; el colector guarda **anclas** (tamaño, último `seq`, SHA-256 del prefijo verificado) en un directorio que el usuario restringido no ve. `chattr +a` es **complementario y se prueba, no se presupone**.
- Las comprobaciones **sensibles** (Docker, PostgreSQL, registros, SSH) siguen **deshabilitadas** aunque estén en `enabled.json` hasta que exista su entrada en `validaciones.json` (dos pasos, ambos de root, tras validar con muestras controladas). Los resúmenes de registros solo muestran plantillas de mensaje de la lista permitida.

## Requisitos de instalación que introduce la revisión independiente (NO se instala nada en esta etapa)
| Ruta | Propietario y modo | Motivo |
|---|---|---|
| `/var/lib/tai-inspect/staging` | `root:tai-inspect` `2700` | El gate no puede leerlo ni listarlo: no ve informes sin publicar |
| `/var/lib/tai-inspect/collector-state` | `root:root` `0700` | Cupo del colector y anclas: el usuario restringido no puede leerlos ni escribirlos |
| `/etc/ssh/authorized_keys.tai-inspect` | `root:root` `0644` | La clave del usuario restringido vive aquí, no en su `~/.ssh`: no puede cambiarla ni añadir otras |
| `/var/lib/tai-inspect/home` | `root:root` `0555` | Directorio de inicio sin nada escribible por `tai-inspect` |
| `/var/log/tai-inspect/gate-audit.log` | `tai-inspect:tai-inspect` `0640`, creado de antemano | Solo-añadir por diseño; `chattr +a` solo si se prueba en el VPS con un archivo de muestra |
| `/opt/tai-inspect/validaciones.json` | `root:root` `0644` | Segundo paso para habilitar una comprobación sensible; sin él siguen cerradas |
| `deploy/systemd/tai-collector.timer` | plantilla | Pase periódico (15 min) que ancla el historial aunque no haya peticiones |
