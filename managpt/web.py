"""Local-first browser interface. No CDN or third-party analytics."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from .config import Config
from .core import Agent
from .store import Store


class ChatRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1, max_length=20000)


class SettingsRequest(BaseModel):
    model: str | None = Field(default=None, min_length=1, max_length=180)
    thinking: bool | None = None
    role: str | None = Field(default=None, min_length=1, max_length=2000)
    project_context: str | None = Field(default=None, max_length=30000)


def create_app(config: Config | None = None, agent: Agent | None = None) -> FastAPI:
    config = config or Config.from_env()
    if agent is None:
        agent = Agent(config, Store(config.database_path))
    app = FastAPI(title="manaGPT", docs_url=None, redoc_url=None)

    def check(sid: str):
        try:
            return agent.store.session(sid)
        except KeyError:
            raise HTTPException(status_code=404, detail="Unknown session") from None

    @app.get("/")
    def index():
        return FileResponse(Path(__file__).parent / "static" / "index.html")

    @app.post("/api/sessions")
    def create_session():
        return agent.store.new_session(config.model)

    @app.get("/api/sessions/{sid}")
    def get_session(sid: str):
        return {"session": check(sid), "messages": agent.store.messages(sid)}

    @app.patch("/api/sessions/{sid}")
    def update_session(sid: str, settings: SettingsRequest):
        check(sid)
        updates = settings.model_dump(exclude_none=True)
        if not updates:
            raise HTTPException(status_code=400, detail="No settings provided")
        if "model" in updates and updates["model"] != config.model:
            raise HTTPException(status_code=400, detail="Only Huihui-Qwen3-Coder-Next-abliterated is supported")
        return agent.store.update(sid, **updates)

    @app.delete("/api/sessions/{sid}/messages")
    def clear_session(sid: str):
        check(sid)
        agent.store.clear(sid)
        return {"ok": True}

    @app.get("/api/sessions/{sid}/export")
    def export_session(sid: str):
        check(sid)
        return agent.handoff(sid)

    @app.post("/api/chat")
    def chat(request: ChatRequest):
        check(request.session_id)
        if not request.message.strip():
            raise HTTPException(status_code=400, detail="Empty message")

        def generate():
            try:
                for part in agent.stream(request.session_id, request.message):
                    yield json.dumps({"type": part.kind, "text": part.text}, ensure_ascii=False) + "\n"
                yield '{"type":"done"}\n'
            except Exception as e:
                # Errors are reported within the stream; failed exchanges are not saved.
                yield json.dumps({"type": "error", "text": str(e)}, ensure_ascii=False) + "\n"

        return StreamingResponse(generate(), media_type="application/x-ndjson",
                                 headers={"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"})

    return app
