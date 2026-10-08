import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from managpt.config import Config
from managpt.core import Agent
from managpt.ollama_api import OllamaError, OllamaProvider, Part
from managpt.store import Store
from managpt.web import create_app


class FakeProvider:
    def __init__(self, fail=False, empty=False):
        self.calls = []
        self.fail, self.empty = fail, empty

    def stream(self, model, messages, thinking):
        self.calls.append((model, messages, thinking))
        yield Part('thinking', 'step')
        if not self.empty:
            yield Part('content', 'こんにちは')
            yield Part('content', '、世界！')
        if self.fail:
            raise OllamaError('network interrupted')


@pytest.fixture
def world(tmp_path):
    config = Config(database_path=str(tmp_path / 'data' / 'chat.db'))
    store = Store(config.database_path)
    provider = FakeProvider()
    agent = Agent(config, store, provider)
    yield agent, store, provider
    store.close()


def test_chat_persists_2_messages_and_handoff(world):
    agent, store, provider = world
    sid = store.new_session(agent.config.model)['id']
    store.update(sid, thinking=True, role='coding expert', project_context='project X')
    parts = list(agent.stream(sid, 'テスト'))
    assert [(x.kind, x.text) for x in parts] == [
        ('thinking', 'step'), ('content', 'こんにちは'), ('content', '、世界！')]
    assert store.messages(sid) == [
        {'role': 'user', 'content': 'テスト'},
        {'role': 'assistant', 'content': 'こんにちは、世界！'},
    ]
    model, messages, thinking = provider.calls[0]
    assert (model, thinking) == ('qwen3.8:27b', True)
    assert 'project X' in messages[0]['content']
    assert agent.handoff(sid)['messages'][-1]['content'] == 'こんにちは、世界！'


def test_failed_or_empty_turn_is_not_committed(world):
    agent, store, provider = world
    sid = store.new_session(agent.config.model)['id']
    provider.fail = True
    with pytest.raises(OllamaError):
        list(agent.stream(sid, 'hello'))
    assert store.messages(sid) == []
    provider.fail = False
    provider.empty = True
    with pytest.raises(RuntimeError, match='no answer'):
        list(agent.stream(sid, 'hello'))
    assert store.messages(sid) == []


def test_store_clear_and_reopen(tmp_path):
    path = str(tmp_path / 'db.sqlite3')
    store = Store(path)
    sid = store.new_session('qwen3:8b')['id']
    store.save_turn(sid, 'A', 'B')
    store.close()
    store = Store(path)
    assert store.messages(sid)[1]['content'] == 'B'
    store.clear(sid)
    assert store.messages(sid) == []
    with pytest.raises(KeyError):
        store.session('bad-id')
    with pytest.raises(ValueError):
        store.update(sid, not_allowed='hi')
    store.close()


def test_history_limit_and_model_switch(world):
    agent, store, provider = world
    sid = store.new_session('qwen3:8b')['id']
    for i in range(25):
        store.save_turn(sid, f'Q{i}', f'A{i}')
    history = agent.messages_for(sid, 'latest')
    assert len(history) == 42  # 40 prior + system + new
    assert history[1]['content'] == 'Q5'
    assert history[-1]['content'] == 'latest'
    store.update(sid, model='qwen3.8:27b')
    list(agent.stream(sid, 'now'))
    assert provider.calls[-1][0] == 'qwen3.8:27b'


def test_web_api_and_static_html(world):
    agent, store, provider = world
    client = TestClient(create_app(agent.config, agent))
    r = client.get('/')
    assert r.status_code == 200 and 'manaGPT' in r.text
    session = client.post('/api/sessions').json()
    sid = session['id']
    assert client.patch(f'/api/sessions/{sid}', json={'model': 'qwen3:8b', 'thinking': True}).status_code == 200
    r = client.post('/api/chat', json={'session_id': sid, 'message': 'hola'})
    assert r.status_code == 200
    lines = [json.loads(line) for line in r.text.strip().splitlines()]
    assert lines[-1]['type'] == 'done'
    assert ''.join(x['text'] for x in lines if x['type'] == 'content') == 'こんにちは、世界！'
    assert client.get(f'/api/sessions/{sid}').json()['messages'][0]['content'] == 'hola'
    assert len(client.get(f'/api/sessions/{sid}/export').json()['messages']) == 3
    assert client.delete(f'/api/sessions/{sid}/messages').status_code == 200
    assert client.get(f'/api/sessions/{sid}').json()['messages'] == []
    assert client.get('/api/sessions/nope').status_code == 404
    assert client.post('/api/chat', json={'session_id': sid, 'message': '  '}).status_code == 400


def test_web_stream_error_does_not_save(world):
    agent, store, provider = world
    sid = store.new_session('qwen3:8b')['id']
    provider.fail = True
    r = TestClient(create_app(agent.config, agent)).post('/api/chat',
                                       json={'session_id': sid, 'message': 'test'})
    assert '"type": "error"' in r.text
    assert store.messages(sid) == []


def test_ollama_http_protocol():
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers['Content-Length'])
            self.server.request_body = json.loads(self.rfile.read(n))
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson')
            self.end_headers()
            for part in ({'message': {'thinking': 'why', 'content': 'answer'}, 'done': False},
                         {'done': True}):
                self.wfile.write((json.dumps(part)+'\n').encode())
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        provider = OllamaProvider(f'http://127.0.0.1:{server.server_port}')
        assert list(provider.stream('qwen3.8:27b', [{'role':'user','content':'hi'}], True)) == [
            Part('thinking','why'), Part('content','answer')]
        assert server.request_body['think'] is True
        assert server.request_body['model'] == 'qwen3.8:27b'
        assert server.request_body['options']['num_ctx'] == 8192
    finally:
        server.shutdown()
        server.server_close()
