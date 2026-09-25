"""Exercise the authenticated route through the real relay to a loopback peer."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import pytest
from starlette.websockets import WebSocket
from websockets.asyncio.server import serve


class Client:
    def __init__(self, token):
        self.headers = {"host": "127.0.0.1", "origin": "http://127.0.0.1"}
        self.query_params = {"token": token}
        self.client = SimpleNamespace(host="127.0.0.1")
        self.url = SimpleNamespace(path="/api/ws")
        self._hermes_auth_identity: dict | None = None
        self.accepted = False
        self.closed = None
        self.sent = []
        self.received = asyncio.Event()
        self.first = True

    async def accept(self, subprotocol=None):
        self.accepted = True

    async def receive(self):
        if self.first:
            self.first = False
            return {"type": "websocket.receive", "text": "probe"}
        await self.received.wait()
        return {"type": "websocket.disconnect"}

    async def send_text(self, text):
        self.sent.append(text)
        self.received.set()

    async def send_bytes(self, data):
        self.sent.append(data)
        self.received.set()

    async def close(self, code=None, reason=None):
        self.closed = code


@pytest.mark.asyncio
async def test_gateway_route_identity_bearing_skips_relay(monkeypatch):
    """A server-minted identity must never be dropped by relaying to Desktop."""
    from hermes_cli import desktop_backend_attach as attach
    from hermes_cli import mcp_startup, web_server
    from hermes_cli.web_routers import chat_ws
    from tui_gateway import ws as tui_ws

    app = web_server.app
    client = Client("fixture-only-route-token")
    client._hermes_auth_identity = {"user_id": "fixture-user", "provider": "fixture-provider"}
    discoveries = []
    stock_calls = []

    async def stock(ws, **kwargs):
        stock_calls.append(kwargs)

    async def decline(*_args, **_kwargs):
        raise AssertionError("identity-bearing client must not be relayed")

    monkeypatch.setenv(attach.ATTACH_ENV_VAR, "1")
    monkeypatch.setattr(chat_ws, "_DASHBOARD_EMBEDDED_CHAT_ENABLED", True)
    monkeypatch.setattr(web_server, "_SESSION_TOKEN", "fixture-only-route-token")
    monkeypatch.setattr(app.state, "auth_required", False, raising=False)
    monkeypatch.setattr(app.state, "bound_host", "127.0.0.1", raising=False)
    monkeypatch.setattr(tui_ws, "handle_ws", stock)
    monkeypatch.setattr(attach, "proxy_sidecar_to_desktop", decline)
    monkeypatch.setattr(
        mcp_startup, "start_deferred_mcp_discovery_now", lambda: discoveries.append("mcp")
    )

    await asyncio.wait_for(chat_ws.gateway_ws(cast(WebSocket, client)), timeout=5)

    # Stock path ran (MCP discovery fires there) and identity was preserved.
    assert discoveries == ["mcp"]
    assert stock_calls == [
        {"auth_identity": {"user_id": "fixture-user", "provider": "fixture-provider"}, "subprotocol": None}
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("authorized", [True, False])
async def test_gateway_route_authenticates_before_real_desktop_relay(monkeypatch, authorized):
    from hermes_cli import desktop_backend_attach as attach
    from hermes_cli import mcp_startup, web_server
    from hermes_cli import web_server_chat
    from hermes_cli.web_routers import chat_ws
    from tui_gateway import ws as tui_ws

    # Resolve the lazy application before patching route-global collaborators.
    app = web_server.app
    seen = []
    discoveries = []
    stock_calls = []
    fixture_token = "fixture-only-route-token"
    client = Client(fixture_token if authorized else "invalid-fixture-token")

    async def peer(socket):
        text = await socket.recv()
        seen.append(text)
        await socket.send("reply:" + text)
        await socket.wait_closed()

    async def stock(*_args, **_kwargs):
        stock_calls.append("stock")

    monkeypatch.setenv(attach.ATTACH_ENV_VAR, "1")
    monkeypatch.setattr(chat_ws, "_DASHBOARD_EMBEDDED_CHAT_ENABLED", True)
    monkeypatch.setattr(web_server, "_SESSION_TOKEN", fixture_token)
    monkeypatch.setattr(app.state, "auth_required", False, raising=False)
    monkeypatch.setattr(app.state, "bound_host", "127.0.0.1", raising=False)
    assert web_server_chat._ws_auth_ok(cast(WebSocket, client)) is authorized
    assert web_server_chat._ws_request_is_allowed(cast(WebSocket, client))
    monkeypatch.setattr(tui_ws, "handle_ws", stock)
    monkeypatch.setattr(
        mcp_startup, "start_deferred_mcp_discovery_now", lambda: stock_calls.append("mcp")
    )

    async with serve(peer, "127.0.0.1", 0) as upstream:
        backend = attach.DesktopBackend(
            pid=0, port=next(iter(upstream.sockets)).getsockname()[1], token="fixture-upstream"
        )

        def discover():
            discoveries.append("discover")
            return backend

        monkeypatch.setattr(attach, "find_desktop_backend", discover)
        await asyncio.wait_for(chat_ws.gateway_ws(cast(WebSocket, client)), timeout=5)

    assert stock_calls == []
    if authorized:
        assert discoveries == ["discover"]
        assert seen == ["probe"]
        assert client.accepted is True
        assert client.sent == ["reply:probe"]
    else:
        assert discoveries == []
        assert seen == []
        assert client.accepted is False
        assert client.closed == 4401
