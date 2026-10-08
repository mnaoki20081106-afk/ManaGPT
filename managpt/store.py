"""SQLite storage; all data stays on the host running manaGPT."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).expanduser().parent.mkdir(parents=True, exist_ok=True)
        # One connection shared by sync + StreamingResponse iterators; SQLite operations
        # are short, and an RLock serializes them across web worker threads.
        from threading import RLock
        self._lock = RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        with self._lock, self.db:
            self.db.execute("PRAGMA foreign_keys = ON")
            self.db.execute("""CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, model TEXT NOT NULL,
                thinking INTEGER NOT NULL DEFAULT 0,
                role TEXT NOT NULL DEFAULT 'expert AI assistant',
                project_context TEXT NOT NULL DEFAULT ''
            )""")
            self.db.execute("""CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('user','assistant')),
                content TEXT NOT NULL, created_at TEXT NOT NULL
            )""")
            self.db.execute("CREATE INDEX IF NOT EXISTS msg_session_idx ON messages(session_id,id)")

    def close(self) -> None:
        with self._lock:
            self.db.close()

    def new_session(self, model: str) -> dict:
        sid = str(uuid4())
        with self._lock, self.db:
            self.db.execute("INSERT INTO sessions(id,created_at,model) VALUES(?,?,?)", (sid, timestamp(), model))
        return self.session(sid)

    def session(self, sid: str) -> dict:
        with self._lock:
            row = self.db.execute(
                "SELECT id,created_at,model,thinking,role,project_context FROM sessions WHERE id=?", (sid,)
            ).fetchone()
        if row is None:
            raise KeyError("Unknown session")
        return dict(zip(("id", "created_at", "model", "thinking", "role", "project_context"),
                        (row[0], row[1], row[2], bool(row[3]), row[4], row[5])))

    def update(self, sid: str, **fields) -> dict:
        allowed = {"model", "thinking", "role", "project_context"}
        if not fields or set(fields) - allowed:
            raise ValueError("Invalid session settings")
        self.session(sid)
        if "thinking" in fields:
            fields["thinking"] = int(fields["thinking"])
        with self._lock, self.db:
            self.db.execute(
                "UPDATE sessions SET " + ",".join(f"{k}=?" for k in fields) + " WHERE id=?",
                (*fields.values(), sid),
            )
        return self.session(sid)

    def messages(self, sid: str, limit: int | None = None) -> list[dict]:
        self.session(sid)
        with self._lock:
            if limit is None:
                rows = self.db.execute(
                    "SELECT role,content FROM messages WHERE session_id=? ORDER BY id", (sid,)
                ).fetchall()
            else:
                rows = self.db.execute(
                    "SELECT role,content FROM (SELECT id,role,content FROM messages "
                    "WHERE session_id=? ORDER BY id DESC LIMIT ?) ORDER BY id", (sid, limit)
                ).fetchall()
        return [{"role": role, "content": content} for role, content in rows]

    def save_turn(self, sid: str, user: str, assistant: str) -> None:
        self.session(sid)
        with self._lock, self.db:
            self.db.executemany(
                "INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)",
                ((sid, "user", user, timestamp()), (sid, "assistant", assistant, timestamp())),
            )

    def clear(self, sid: str) -> None:
        self.session(sid)
        with self._lock, self.db:
            self.db.execute("DELETE FROM messages WHERE session_id=?", (sid,))
