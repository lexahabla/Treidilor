# -*- coding: utf-8 -*-
"""Filtro de secretos y datos personales.

Política: un informe con CUALQUIER hallazgo se DESCARTA entero (no se «maquilla»). Los hallazgos devuelven solo
el identificador del patrón y la ruta del campo, NUNCA el texto detectado.
`mask_text` y `normalize_log_message` se usan para registros y resúmenes de logs (enmascaran antes de agregar).
"""
from __future__ import annotations

import ipaddress
import math
import re

# (id, regex). El orden importa solo para mask_text.
_PATTERNS = [
    ("bearer", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}")),
    ("tai_token", re.compile(r"\btai_[0-9a-f]{8,}_[A-Za-z0-9_-]{20,}")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
    ("token_github", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})")),
    ("clave_api_sk", re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}")),
    ("clave_aws", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("token_slack", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("clave_privada", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("url_credenciales", re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@")),
    ("asignacion_secreto", re.compile(
        r"(?i)\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|credentials?)s?\b[\"']?\s*[:=]\s*[\"']?[^\s\"',;]{6,}")),
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
]
_HEX_LARGO = re.compile(r"\b[0-9a-fA-F]{40,}\b")
_BASE64ISH = re.compile(r"[A-Za-z0-9+/_=-]{32,}")
_IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_IPV6 = re.compile(r"\b(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}\b")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")

SENSITIVE_KEYS = {"password", "passwd", "secret", "token", "apikey", "api_key", "authorization", "credential", "credentials", "privatekey", "private_key"}
SAFE_VALUES = {"", "no", "yes", "true", "false", "none", "null", "<oculto>"}
HASH_KEYS = {"sha256", "huella"}   # campos cuyo valor legítimo es un hash hexadecimal de 64 caracteres


def _entropy(s):
    if not s:
        return 0.0
    n = float(len(s))
    freq = {}
    for ch in s:
        freq[ch] = freq.get(ch, 0) + 1
    return -sum((c / n) * math.log(c / n, 2) for c in freq.values())


def _ip_global(texto):
    try:
        ip = ipaddress.ip_address(texto)
    except ValueError:
        return False
    return ip.is_global


def _scan_str(s, path, salida, hash_permitido):
    for pid, rx in _PATTERNS:
        if rx.search(s):
            salida.append((pid, path))
    if not hash_permitido and _HEX_LARGO.search(s):
        salida.append(("hex_largo", path))
    for m in _BASE64ISH.finditer(s):
        tok = m.group(0)
        if len(tok) >= 32 and _entropy(tok) >= 4.3 and not (hash_permitido and _HEX64.fullmatch(tok)):
            salida.append(("alta_entropia", path))
            break
    for m in _IPV4.finditer(s):
        if _ip_global(m.group(0)):
            salida.append(("ip_publica", path))
            break
    for m in _IPV6.finditer(s):
        if _ip_global(m.group(0)):
            salida.append(("ip_publica", path))
            break


def _walk(obj, path, salida, hash_permitido):
    if isinstance(obj, dict):
        for k, v in obj.items():
            ks = str(k)
            kp = (path + "." + ks) if path else ks
            _scan_str(ks, kp + "#clave", salida, False)
            if ks.lower().replace("-", "_") in SENSITIVE_KEYS and isinstance(v, str) and v.strip().lower() not in SAFE_VALUES:
                salida.append(("clave_sensible", kp))
            _walk(v, kp, salida, ks.lower() in HASH_KEYS)
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            _walk(v, "%s[%d]" % (path, i), salida, hash_permitido)
    elif isinstance(obj, str):
        _scan_str(obj, path, salida, bool(hash_permitido) and _HEX64.fullmatch(obj) is not None)


def scan(obj):
    """Devuelve una lista de (id_patrón, ruta). Vacía = limpio. NUNCA incluye el texto detectado."""
    salida = []
    _walk(obj, "", salida, False)
    vistos, limpio = set(), []
    for h in salida:
        if h not in vistos:
            vistos.add(h)
            limpio.append(h)
    return limpio[:20]


def mask_text(s):
    """Enmascara patrones sensibles de un texto (para auditoría y resúmenes de logs)."""
    if not isinstance(s, str):
        return ""
    for pid, rx in _PATTERNS:
        s = rx.sub("<oculto:%s>" % pid, s)
    s = _IPV4.sub("<ip>", s)
    s = _IPV6.sub("<ip>", s)
    s = _HEX_LARGO.sub("<oculto:hex>", s)
    s = _BASE64ISH.sub(lambda m: "<oculto:token>" if (len(m.group(0)) >= 32 and _entropy(m.group(0)) >= 4.3) else m.group(0), s)
    return s


_UUID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
_HEX_CORTO = re.compile(r"\b[0-9a-fA-F]{8,39}\b")
_NUM = re.compile(r"\d+")
_COMILLAS = re.compile(r"\"[^\"]{1,120}\"|'[^']{1,120}'")
_ESPACIOS = re.compile(r"\s+")
_RUTA_URL = re.compile(r"\bhttps?://\S+")


def normalize_log_message(s, max_chars=200):
    """Convierte una línea de registro en una PLANTILLA sin datos variables (para contar tipos de mensaje)."""
    if not isinstance(s, str):
        return ""
    s = mask_text(s)
    s = _RUTA_URL.sub("<url>", s)
    s = _UUID.sub("<uuid>", s)
    s = _HEX_CORTO.sub("<hex>", s)
    s = _COMILLAS.sub("<texto>", s)
    s = _NUM.sub("<n>", s)
    s = _ESPACIOS.sub(" ", s).strip()
    s = "".join(ch if (32 <= ord(ch) < 127) else "?" for ch in s)
    return s[:max_chars]
