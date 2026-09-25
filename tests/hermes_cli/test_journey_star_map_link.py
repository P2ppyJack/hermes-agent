"""Behavior contracts for the /journey dashboard star-map link.

When the TUI runs inside the web dashboard's embedded terminal, the PTY
child env carries ``HERMES_DASHBOARD_ORIGIN`` (injected by
``hermes_cli/web_server_chat.py``). The journey renderer then prints one
clickable ``Star map: <origin>/starjourney`` line so the user can jump to
the rich web page; plain terminal sessions (env var absent) must never see
that line.
"""

from __future__ import annotations

import argparse
import contextlib
import io
from pathlib import Path


def _capture_show(monkeypatch, origin: str | None) -> str:
    """Run the /journey default view with the env var set (or absent)."""
    from hermes_cli.journey import register_cli

    if origin is None:
        monkeypatch.delenv("HERMES_DASHBOARD_ORIGIN", raising=False)
    else:
        monkeypatch.setenv("HERMES_DASHBOARD_ORIGIN", origin)

    parser = argparse.ArgumentParser(add_help=False)
    register_cli(parser)
    args = parser.parse_args([])

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        args.func(args)
    return buf.getvalue()


def test_prints_star_map_link_under_dashboard(monkeypatch):
    out = _capture_show(monkeypatch, "http://127.0.0.1:9119")
    assert "Star map: http://127.0.0.1:9119/starjourney" in out


def test_strips_trailing_slash_from_origin(monkeypatch):
    out = _capture_show(monkeypatch, "http://127.0.0.1:9119/")
    # No double slash: the link must stay matchable by the terminal scanner.
    assert "http://127.0.0.1:9119/starjourney" in out
    assert "9119//starjourney" not in out


def test_dashboard_link_preserves_validated_proxy_prefix():
    from starlette.websockets import WebSocket
    from hermes_cli.web_server_chat import _dashboard_browser_url

    async def no_io(*_args):
        raise AssertionError("URL resolution must not perform WebSocket IO")

    def socket(headers):
        return WebSocket({"type": "websocket", "path": "/api/pty", "headers": headers}, receive=no_io, send=no_io)

    ws = socket([(b"origin", b"https://example.test"), (b"x-forwarded-prefix", b"/tools/")])
    assert _dashboard_browser_url(ws) == "https://example.test/tools"
    malformed = socket([(b"origin", b"https://example.test"), (b"x-forwarded-prefix", b"/../outside")])
    assert _dashboard_browser_url(malformed) == "https://example.test"
    native = socket([(b"origin", b"null")])
    assert _dashboard_browser_url(native) is None


def test_no_link_outside_dashboard(monkeypatch):
    assert "starjourney" not in _capture_show(monkeypatch, None)


def test_blank_origin_is_treated_as_absent(monkeypatch):
    # A set-but-empty env var (shell quirk) must not print a broken link.
    assert "starjourney" not in _capture_show(monkeypatch, "   ")


def test_resolve_chat_argv_injects_dashboard_origin(monkeypatch):
    """The PTY spawn env carries the browser origin end to end."""
    import hermes_cli.main_tui_launch as tui_launch
    import hermes_cli.web_server as web_server
    import hermes_cli.web_server_chat as ws

    # web_server_chat imports _make_tui_argv from main_tui_launch at call time,
    # and reads the bound host/port off the facade's ``app.state``.
    monkeypatch.setattr(
        tui_launch,
        "_make_tui_argv",
        lambda *_args, **_kwargs: (["node", "fake-tui.js"], Path("/tmp")),
    )
    monkeypatch.setattr(web_server.app.state, "bound_host", "127.0.0.1", raising=False)
    monkeypatch.setattr(web_server.app.state, "bound_port", 9119, raising=False)

    # Browser Origin threaded from the WS handshake wins (proxy/LAN aware).
    _argv, _cwd, env = ws._resolve_chat_argv(
        dashboard_origin="http://hermes.lan:9119/"
    )
    assert env is not None
    assert env.get("HERMES_DASHBOARD_ORIGIN") == "http://hermes.lan:9119"

    # No Origin header → fall back to the bound host/port.
    _argv, _cwd, env = ws._resolve_chat_argv()
    assert env is not None
    assert env.get("HERMES_DASHBOARD_ORIGIN") == "http://127.0.0.1:9119"
