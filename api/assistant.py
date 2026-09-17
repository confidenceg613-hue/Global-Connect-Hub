"""
Falcon AI — production assistant endpoint (file-based function).

Routes (exact-path routing on this platform):
  POST /api/assistant          → { reply, command }
  GET  /api/assistant          → { messages: [] }  (history stub, no DB yet)

Mirrors the Express /api/assistant contract the widget expects. Uses the
Mistral key (server-side only, never exposed to the browser). Models are
free-tier compatible: nemo → ministral-8b → pixtral-12b fallback chain.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
import urllib.error

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="Falcon AI", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MISTRAL_BASE = "https://api.mistral.ai/v1/chat/completions"
# Free tier allows nemo/ministral/pixtral; mistral-large is paywalled (403).
MODELS = ["open-mistral-nemo", "ministral-8b-latest", "pixtral-12b-2409"]


def _mistral_key() -> str:
    for name in ("MISTRAL_API_KEY", "Mistral_API_KEY", "mistral_api_key"):
        raw = (os.environ.get(name) or "").strip()
        if raw:
            # Keep only the first line — malformed .env entries can glue lines.
            return raw.splitlines()[0].strip()
    return ""


SYSTEM_PROMPT = (
    "You are Falcon AI, the witty falcon-hearted assistant inside the DeepFalcon "
    "location platform. Be warm, brief and helpful (max ~120 words). "
    "You can control the map by returning a command. "
    "Respond with STRICT JSON only: "
    '{"reply": "<your answer>", "command": null} '
    "or a command object: "
    '{"reply":"...", "command":{"type":"flyTo","lat":6.5244,"lng":3.3792}} | '
    '{"type":"geocode","place":"Lagos"} | {"type":"zoomIn"} | {"type":"zoomOut"} | '
    '{"type":"fitAll"} | {"type":"goBack"} | {"type":"showImages","place":"Lagos"} | '
    '{"type":"openInviteForm","phone":"+234...","name":"..."} | '
    '{"type":"navigate","path":"/live-map"}. '
    "Use a command when the user clearly wants a map/place/navigate action; "
    "otherwise null. No markdown, no code fences, JSON only."
)


def _call_mistral(message: str, model: str) -> str:
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": message},
        ],
        "max_tokens": 500,
        "temperature": 0.6,
    }).encode("utf-8")
    req = urllib.request.Request(
        MISTRAL_BASE,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_mistral_key()}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=55) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"] or ""


def _extract_json(text: str) -> dict:
    """Parse model output as JSON; tolerate fences/prose around it."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, flags=re.S)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    return {"reply": text, "command": None}


@app.post("/api/assistant")
async def assistant(request: Request):
    if not _mistral_key():
        return JSONResponse(
            {"reply": "Falcon AI is warming up — the Mistral key is not configured on the server yet.", "command": None},
            status_code=200,
        )
    try:
        raw = await request.body()
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        payload = {}
    message = (payload.get("message") or "").strip()
    if not message:
        return JSONResponse({"error": "message required"}, status_code=400)

    image = payload.get("image")
    if image:
        # Vision-capable path via pixtral (data URL image input)
        try:
            content = [
                {"type": "text", "text": message},
                {"type": "image_url", "image_url": image},
            ]
            body = json.dumps({
                "model": "pixtral-12b-2409",
                "messages": [{"role": "user", "content": content}],
                "max_tokens": 600,
            }).encode("utf-8")
            req = urllib.request.Request(
                MISTRAL_BASE,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {_mistral_key()}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=55) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            text = data["choices"][0]["message"]["content"] or ""
            obj = _extract_json(text)
            return {"reply": obj.get("reply", text), "command": obj.get("command")}
        except Exception:
            return JSONResponse(
                {"reply": "I couldn't analyze that image — please try again.", "command": None},
                status_code=200,
            )

    last_err = None
    for model in MODELS:
        try:
            text = _call_mistral(message, model)
            obj = _extract_json(text)
            return {"reply": obj.get("reply", text), "command": obj.get("command")}
        except urllib.error.HTTPError as e:
            last_err = e
            continue  # tier/rate issues → next model
        except Exception as e:  # network etc.
            last_err = e
            continue

    return JSONResponse(
        {"reply": "I ran into a hiccup reaching the falcon nest — please try again in a moment.", "command": None},
        status_code=200,
    )


@app.get("/api/assistant")
def history_stub():
    # No database in this environment — history is intentionally empty.
    return {"messages": []}
