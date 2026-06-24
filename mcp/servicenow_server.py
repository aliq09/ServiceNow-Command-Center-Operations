"""Repo-local launcher for mcp-server-servicenow.

Credentials are loaded from the ignored environment file assigned to the
selected instance profile. The optional TLS workaround is applied only inside
this MCP process.
"""

from __future__ import annotations

import os
import ssl
import sys
import json
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_FILE = PROJECT_ROOT / "servicenow-instances.json"


def _selected_profile() -> str:
    if "--profile" in sys.argv:
        index = sys.argv.index("--profile")
        try:
            profile = sys.argv[index + 1]
        except IndexError as exc:
            raise ValueError("--profile requires an instance profile ID") from exc
        del sys.argv[index:index + 2]
        return profile
    return os.environ.get("SERVICENOW_PROFILE", "").strip()


def _profile_env_file(profile_id: str) -> Path:
    if not REGISTRY_FILE.is_file():
        raise FileNotFoundError(f"ServiceNow instance registry not found: {REGISTRY_FILE}")

    registry = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    selected = profile_id or registry.get("defaultInstance", "")
    profile = next(
        (item for item in registry.get("instances", []) if item.get("id") == selected),
        None,
    )
    if not profile:
        raise ValueError(f"Unknown ServiceNow instance profile: {selected}")

    override = os.environ.get("SERVICENOW_ENV_FILE", "").strip()
    return Path(override or PROJECT_ROOT / profile["envFile"]).expanduser()


def _load_configuration() -> str:
    profile = _selected_profile()
    env_file = _profile_env_file(profile)
    if not env_file.is_file():
        raise FileNotFoundError(
            f"ServiceNow environment file not found: {env_file}. "
            "Copy the matching example file and fill in its credentials."
        )
    load_dotenv(env_file, override=True)
    return profile or "default"


def _tls_verification_enabled() -> bool:
    value = os.environ.get("SERVICENOW_TLS_VERIFY", "true")
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _apply_development_tls_workaround() -> None:
    """Disable verification for this process when explicitly configured."""
    ssl._create_default_https_context = ssl._create_unverified_context

    import httpx
    import requests

    original_client_init = httpx.Client.__init__
    original_async_client_init = httpx.AsyncClient.__init__
    original_session_send = requests.Session.send

    def client_init(self, *args, **kwargs):
        kwargs["verify"] = False
        original_client_init(self, *args, **kwargs)

    def async_client_init(self, *args, **kwargs):
        kwargs["verify"] = False
        original_async_client_init(self, *args, **kwargs)

    def session_send(self, request, **kwargs):
        kwargs["verify"] = False
        return original_session_send(self, request, **kwargs)

    httpx.Client.__init__ = client_init
    httpx.AsyncClient.__init__ = async_client_init
    requests.Session.send = session_send


def main() -> None:
    profile = _load_configuration()
    print(f"Starting ServiceNow MCP profile: {profile}", file=sys.stderr)

    if not _tls_verification_enabled():
        print(
            "WARNING: ServiceNow TLS certificate verification is disabled "
            "for this development MCP process.",
            file=sys.stderr,
        )
        _apply_development_tls_workaround()

    from servicenow_mcp.cli import main as servicenow_main

    servicenow_main()


if __name__ == "__main__":
    main()
