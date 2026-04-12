"""Foundation Model API client for vision analysis - uses HTTP requests directly."""

import os
import json
import base64
import logging
import re
import urllib.request
import urllib.error
from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)

MODEL = os.environ.get("FMAPI_MODEL", "databricks-llama-4-maverick")


def _get_auth():
    """Get host and token for HTTP calls."""
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
    """Call serving endpoint via HTTP."""
    host, token = _get_auth()
    url = f"{host}/serving-endpoints/{MODEL}/invocations"

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"FMAPI HTTP {e.code}: {body[:300]}")


def analyze_frame(frame_b64: str, prompt: str, categories: list[str]) -> dict:
    """Send a single frame to the vision model and get structured analysis.

    Returns dict like: {"fadiga": 3, "distracao": 7, "description": "...", "confidence": 0.85}
    """
    categories_str = ", ".join(categories)
    system_prompt = (
        "You are a safety analysis AI. Analyze the image and return ONLY valid JSON. "
        "No markdown, no code fences, no explanation, just the raw JSON object."
    )
    user_prompt = (
        f"{prompt}\n\n"
        f"Categories to score (1-10 scale, 1=normal, 10=severe): {categories_str}\n\n"
        "Return JSON with:\n"
        f"- A numeric score (1-10) for each category: {categories_str}\n"
        '- "description": brief description of what you observe (in Portuguese)\n'
        '- "confidence": your confidence level 0.0-1.0\n'
        "Example: {" + ", ".join(f'"{c}": 3' for c in categories) + ', "description": "...", "confidence": 0.85}'
    )

    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"},
                    },
                    {"type": "text", "text": user_prompt},
                ],
            },
        ],
        "max_tokens": 500,
        "temperature": 0.1,
    }

    try:
        response = _call_serving(payload)
        raw = response["choices"][0]["message"]["content"].strip()
        logger.info(f"FMAPI response: {raw[:200]}")

        # Try to extract JSON from the response
        json_match = re.search(r'\{[^{}]*\}', raw, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
        else:
            result = json.loads(raw)

        # Ensure all categories have scores
        for cat in categories:
            if cat not in result:
                result[cat] = 1
            else:
                try:
                    result[cat] = max(1, min(10, int(float(result[cat]))))
                except (ValueError, TypeError):
                    result[cat] = 1

        if "description" not in result:
            result["description"] = "Analise nao disponivel"
        if "confidence" not in result:
            result["confidence"] = 0.5

        return result

    except Exception as e:
        logger.error(f"FMAPI analysis failed: {e}")
        fallback = {cat: 1 for cat in categories}
        fallback["description"] = f"Erro na analise: {str(e)[:200]}"
        fallback["confidence"] = 0.0
        return fallback


def analyze_frames_batch(frames_b64: list[str], prompt: str, categories: list[str]) -> list[dict]:
    """Analyze multiple frames sequentially."""
    results = []
    for frame in frames_b64:
        result = analyze_frame(frame, prompt, categories)
        results.append(result)
    return results
