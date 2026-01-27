def is_localhost_url(url: str) -> bool:
    """Check if URL is a localhost address."""
    try:
        if url:
            from urllib.parse import urlparse

            parsed = urlparse(url)
            hostname = parsed.hostname or ""
            return hostname in ("localhost", "127.0.0.1", "::1") or hostname.startswith("127.")
        return False
    except Exception:
        return False
