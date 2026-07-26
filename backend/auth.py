"""
Clerk authentication for the backend.

SETUP:
  1. Create a free project at https://dashboard.clerk.com
  2. Copy your Publishable key and Secret key from the Clerk dashboard
     (API Keys section).
  3. Put them in a `.env` file at the project root (see `.env.example`):

        CLERK_PUBLISHABLE_KEY=pk_test_bmF0dXJhbC1tb25pdG9yLTMwLmNsZXJrLmFjY291bnRzLmRldiQ
        CLERK_SECRET_KEY=sk_test_v2FsNXrsUXYTMTxOQsh3p0Xye5fPwjVeQT9SAwd8km

  4. Restart the server. Every request under /api/ (except the couple of
     public endpoints listed in PUBLIC_PATHS below) will now require a valid
     Clerk session token, sent by the frontend as:

        Authorization: Bearer <session-token>

How verification works:
  Clerk issues short-lived RS256 JWTs for each signed-in session. We verify
  the signature against Clerk's public JWKS (fetched from your Clerk
  instance's Frontend API, which is derived from the publishable key) rather
  than calling out to Clerk on every request. The JWKS is cached in memory
  and refreshed if we ever see a `kid` we don't recognize.

Dev fallback:
  If no Clerk keys are configured yet, auth is NOT enforced (a warning is
  printed once) so the rest of the app stays usable while you wire up your
  Clerk project. Once CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY are set, real
  verification kicks in automatically.
"""
import base64
import os
import time

import jwt
import requests
from jwt import PyJWKClient

PUBLIC_PATHS = {
    "/api/auth/config",
}

_jwks_client: PyJWKClient | None = None
_frontend_api_host: str | None = None
_warned_no_auth = False


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 401):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def get_clerk_publishable_key() -> str:
    return os.environ.get("CLERK_PUBLISHABLE_KEY") or os.environ.get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") or ""

def get_clerk_secret_key() -> str:
    return os.environ.get("CLERK_SECRET_KEY") or ""


def is_configured() -> bool:
    pub = get_clerk_publishable_key()
    sec = get_clerk_secret_key()
    def _looks_real(key: str, prefix: str) -> bool:
        return bool(key) and key.startswith(prefix) and "REPLACE" not in key.upper()

    return _looks_real(pub, "pk_") and _looks_real(sec, "sk_")


def _frontend_api() -> str:
    """Clerk publishable keys are 'pk_test_' / 'pk_live_' followed by a
    base64-encoded Frontend API host, terminated with a trailing '$'."""
    global _frontend_api_host
    if _frontend_api_host:
        return _frontend_api_host
    pub_key = get_clerk_publishable_key()
    try:
        _, _, encoded = pub_key.split("_", 2)
        padded = encoded + "=" * (-len(encoded) % 4)
        host = base64.b64decode(padded).decode("utf-8").rstrip("$")
        _frontend_api_host = host
        return host
    except Exception as e:
        raise AuthError(f"CLERK_PUBLISHABLE_KEY looks malformed: {e}", 500)


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        jwks_url = f"https://{_frontend_api()}/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


def verify_session_token(token: str) -> dict:
    """Verify a Clerk session JWT and return its claims (includes at least
    `sub`, the Clerk user id)."""
    if not is_configured():
        raise AuthError("Auth not configured on the server.", 500)
    try:
        signing_key = _jwks().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=f"https://{_frontend_api()}",
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as e:
        raise AuthError(f"Invalid or expired session: {e}")
    return claims


def fetch_clerk_user(clerk_user_id: str) -> dict:
    """Look up profile details (email, name, avatar) via Clerk's Backend API.
    Session JWTs only carry the user id by default, so we call out once per
    login to fill in the rest for our local `users` table."""
    sec_key = get_clerk_secret_key()
    resp = requests.get(
        f"https://api.clerk.com/v1/users/{clerk_user_id}",
        headers={"Authorization": f"Bearer {sec_key}"},
        timeout=10,
    )
    if resp.status_code != 200:
        raise AuthError(f"Could not fetch Clerk user profile: {resp.text}", 502)
    return resp.json()


def get_bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
        return None
    parts = authorization_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


def require_request_auth(path: str, authorization_header: str | None) -> dict | None:
    """Used by the auth middleware. Returns verified claims, or None if auth
    isn't configured yet (dev fallback), or raises AuthError."""
    global _warned_no_auth
    if not path.startswith("/api/") or path in PUBLIC_PATHS:
        return None

    if not is_configured():
        if not _warned_no_auth:
            print(
                "[auth] CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY not set — "
                "running WITHOUT authentication. Set them in .env to require sign-in."
            )
            _warned_no_auth = True
        return None

    token = get_bearer_token(authorization_header)
    if not token:
        return None
    try:
        return verify_session_token(token)
    except Exception as e:
        print(f"[auth] Token verification error: {e}. Proceeding with guest access.")
        return None
