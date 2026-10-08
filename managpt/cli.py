"""Terminal UX, with the commands from the original attached Qwen agent."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import Config
from .core import Agent
from .store import Store

HELP = """Commands:
  /help              show commands
  /think             toggle reasoning
  /model <model>     set chat model (e.g. cooperleong00/Qwen3-8B-Jailbroken)
  /context <text>    set project context
  /role <text>       set assistant role
  /history           print conversation so far
  /clear             clear this session's messages
  /save [file]       export session log to JSON
  /load <file>       import a compatible saved session log
  /export [file]     save an OpenAI messages handoff JSON
  /exit              quit
"""


def run_cli(agent: Agent, sid: str) -> None:
    print(f"manaGPT | model: {agent.store.session(sid)['model']} | /help for commands")
    while True:
        try:
            raw = input("\nyou> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nbye")
            break
        if not raw:
            continue
        cmd, _, arg = raw.partition(" ")
        try:
            if cmd in ("/exit", "/quit"):
                break
            if cmd == "/help":
                print(HELP)
            elif cmd == "/think":
                old = agent.store.session(sid)["thinking"]
                print("thinking:", "ON" if agent.store.update(sid, thinking=not old)["thinking"] else "OFF")
            elif cmd == "/model":
                if not arg.strip():
                    print("model:", agent.store.session(sid)["model"])
                else:
                    print("model:", agent.store.update(sid, model=arg.strip())["model"])
            elif cmd in ("/role", "/context"):
                key = "role" if cmd == "/role" else "project_context"
                if arg.strip():
                    agent.store.update(sid, **{key: arg.strip()})
                print(key + ":", agent.store.session(sid)[key])
            elif cmd == "/history":
                for msg in agent.store.messages(sid):
                    print(f"{msg['role']}: {msg['content']}")
            elif cmd == "/clear":
                agent.store.clear(sid)
                print("history cleared")
            elif cmd == "/save":
                p = Path(arg.strip() or "session_log.json")
                p.write_text(json.dumps({"session": agent.store.session(sid),
                                         "history": agent.store.messages(sid)},
                                        ensure_ascii=False, indent=2), encoding="utf-8")
                print("saved:", p)
            elif cmd == "/load":
                p = Path(arg.strip() or "session_log.json")
                data = json.loads(p.read_text(encoding="utf-8"))
                history = data.get("history", [])
                if not isinstance(history, list) or any(
                    m.get("role") not in {"user", "assistant"} or not isinstance(m.get("content"), str)
                    for m in history if isinstance(m, dict)
                ) or any(not isinstance(m, dict) for m in history):
                    raise ValueError("Unsupported history format")
                if len(history) % 2 or any(
                    history[i]["role"] != "user" or history[i+1]["role"] != "assistant"
                    for i in range(0, len(history), 2)
                ):
                    raise ValueError("History must contain completed user/assistant pairs")
                agent.store.clear(sid)
                for i in range(0, len(history), 2):
                    agent.store.save_turn(sid, history[i]["content"], history[i+1]["content"])
                settings = data.get("session", {})
                for key in ("model", "role", "project_context", "thinking"):
                    if key in settings:
                        agent.store.update(sid, **{key: settings[key]})
                print("loaded:", len(history), "messages")
            elif cmd == "/export":
                p = Path(arg.strip() or "handoff_packet.json")
                p.write_text(json.dumps(agent.handoff(sid), ensure_ascii=False, indent=2), encoding="utf-8")
                print("handoff:", p)
            elif raw.startswith("/"):
                print("Unknown command; /help")
            else:
                print("manaGPT> ", end="", flush=True)
                for part in agent.stream(sid, raw):
                    if part.kind == "content":
                        print(part.text, end="", flush=True)
                print()
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="manaGPT: Qwen3-8B-Jailbroken assistant")
    subs = parser.add_subparsers(dest="command")
    subs.add_parser("cli")
    web = subs.add_parser("web", help="launch browser chat (localhost only by default)")
    web.add_argument("--host", default=None)
    web.add_argument("--port", type=int, default=None)
    args = parser.parse_args(argv)
    config = Config.from_env()
    if args.command == "web":
        import os
        import uvicorn
        from .web import create_app
        uvicorn.run(create_app(config), host=args.host or os.getenv("MANAGPT_WEB_HOST", "127.0.0.1"),
                    port=args.port or int(os.getenv("MANAGPT_WEB_PORT", "8000")))
        return
    store = Store(config.database_path)
    try:
        sid = store.new_session(config.model)["id"]
        run_cli(Agent(config, store), sid)
    finally:
        store.close()


if __name__ == "__main__":
    main()
