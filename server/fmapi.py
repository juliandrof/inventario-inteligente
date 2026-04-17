"""Foundation Model API client for retail fixture detection."""

import os
import json
import logging
import re
import urllib.request
import urllib.error
from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = os.environ.get("FMAPI_MODEL", "databricks-llama-4-maverick")

FIXTURE_TYPES = [
    "ARARA", "GONDOLA", "CESTAO", "PRATELEIRA", "BALCAO",
    "DISPLAY", "CHECKOUT", "MANEQUIM", "MESA", "CABIDEIRO_PAREDE",
]


def _get_model() -> str:
    try:
        from server.database import get_config
        val = get_config("fmapi_model")
        if val:
            return val
    except Exception:
        pass
    return _DEFAULT_MODEL


def _get_auth():
    is_app = bool(os.environ.get("DATABRICKS_APP_NAME"))
    if is_app:
        w = WorkspaceClient()
    else:
        profile = os.environ.get("DATABRICKS_PROFILE")
        w = WorkspaceClient(profile=profile) if profile else WorkspaceClient()

    host = w.config.host.rstrip("/")
    headers = w.config.authenticate()
    token = headers.get("Authorization", "").replace("Bearer ", "") if headers else ""
    if not token and w.config.token:
        token = w.config.token
    return host, token


def _call_serving(payload: dict, timeout: int = 120) -> dict:
    host, token = _get_auth()
    model = _get_model()
    url = f"{host}/serving-endpoints/{model}/invocations"

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"FMAPI HTTP {e.code}: {body[:300]}")


def analyze_frame_fixtures(frame_b64: str) -> list[dict]:
    """Analyze a frame and detect retail fixtures.

    Returns list of dicts:
    [{"type": "GONDOLA", "position": {"x": 30, "y": 50}, "zone": "MIDDLE",
      "occupancy": "FULL", "occupancy_pct": 85, "confidence": 0.9,
      "description": "Gondola de produtos de limpeza"}]
    """
    types_str = ", ".join(FIXTURE_TYPES)

    system_prompt = (
        "Voce e um especialista em analise de layout de lojas de varejo. "
        "Sua tarefa e identificar TODOS os expositores visiveis na imagem de uma loja. "
        "Retorne APENAS JSON valido. Sem markdown, sem explicacao, apenas o array JSON."
    )

    user_prompt = f"""Analise esta imagem de uma loja de varejo e identifique TODOS os expositores/mobiliarios visiveis.

Tipos validos: {types_str}

Descricao dos tipos:
- ARARA: Arara de roupas (cabideiro circular ou reto para pendurar pecas)
- GONDOLA: Gondola/estante expositora com multiplas prateleiras (modulo independente)
- CESTAO: Cestao/cesto grande aberto para produtos a granel ou promocoes
- PRATELEIRA: Prateleira de parede (modulo fixo na parede)
- BALCAO: Balcao de atendimento ou vitrine de vidro
- DISPLAY: Display promocional, ponta de gondola, ilha promocional
- CHECKOUT: Caixa registradora / checkout
- MANEQUIM: Manequim de vitrine ou exposicao
- MESA: Mesa para exposicao de produtos dobrados
- CABIDEIRO_PAREDE: Cabideiro fixo na parede com ganchos/barras

Para CADA expositor encontrado, retorne:
- "type": tipo do expositor (da lista acima)
- "position": posicao aproximada como percentual do frame {{"x": 0-100, "y": 0-100}} (0,0 = canto superior esquerdo)
- "zone": zona da loja onde esta (FRENTE, MEIO, FUNDO, ESQUERDA, DIREITA)
- "occupancy": nivel de ocupacao (VAZIO, PARCIAL, CHEIO)
- "occupancy_pct": percentual estimado de ocupacao 0-100
- "confidence": confianca na deteccao 0.0-1.0
- "description": descricao breve em portugues

IMPORTANTE:
- Conte CADA expositor individualmente, mesmo que sejam do mesmo tipo
- Se houver 3 gondolas, retorne 3 objetos separados com posicoes diferentes
- Se nao encontrar nenhum expositor, retorne []

Retorne um array JSON. Exemplo:
[{{"type": "GONDOLA", "position": {{"x": 30, "y": 50}}, "zone": "MEIO", "occupancy": "CHEIO", "occupancy_pct": 85, "confidence": 0.9, "description": "Gondola de produtos de limpeza bem abastecida"}}]"""

    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
                    {"type": "text", "text": user_prompt},
                ],
            },
        ],
        "max_tokens": 2000,
        "temperature": 0.1,
    }

    try:
        response = _call_serving(payload)
        raw = response["choices"][0]["message"]["content"].strip()
        logger.info(f"FMAPI response: {raw[:300]}")

        # Extract JSON array
        json_match = re.search(r'\[.*\]', raw, re.DOTALL)
        if json_match:
            fixtures = json.loads(json_match.group())
        else:
            fixtures = json.loads(raw)

        if not isinstance(fixtures, list):
            fixtures = [fixtures] if isinstance(fixtures, dict) else []

        # Validate and normalize
        valid = []
        for f in fixtures:
            if not isinstance(f, dict):
                continue
            ftype = str(f.get("type", "")).upper().strip()
            if ftype not in FIXTURE_TYPES:
                continue

            pos = f.get("position", {})
            if not isinstance(pos, dict):
                pos = {"x": 50, "y": 50}

            valid.append({
                "type": ftype,
                "position": {
                    "x": max(0, min(100, float(pos.get("x", 50)))),
                    "y": max(0, min(100, float(pos.get("y", 50)))),
                },
                "zone": str(f.get("zone", "MEIO")).upper(),
                "occupancy": _normalize_occupancy(f.get("occupancy", "PARCIAL")),
                "occupancy_pct": max(0, min(100, float(f.get("occupancy_pct", 50)))),
                "confidence": max(0, min(1, float(f.get("confidence", 0.7)))),
                "description": str(f.get("description", "")),
            })

        return valid

    except Exception as e:
        logger.error(f"FMAPI fixture analysis failed: {e}")
        return []


def _normalize_occupancy(val) -> str:
    val = str(val).upper().strip()
    mapping = {
        "VAZIO": "VAZIO", "EMPTY": "VAZIO",
        "PARCIAL": "PARCIAL", "PARTIAL": "PARCIAL",
        "CHEIO": "CHEIO", "FULL": "CHEIO",
    }
    return mapping.get(val, "PARCIAL")
