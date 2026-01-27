"""Unit tests for polos.utils.config module."""

from polos.utils.config import is_localhost_url


class TestIsLocalhostUrl:
    """Tests for is_localhost_url function."""

    def test_localhost_http(self):
        """Test that http://localhost is recognized."""
        assert is_localhost_url("http://localhost:8080") is True

    def test_localhost_https(self):
        """Test that https://localhost is recognized."""
        assert is_localhost_url("https://localhost:8080") is True

    def test_127_0_0_1(self):
        """Test that 127.0.0.1 is recognized."""
        assert is_localhost_url("http://127.0.0.1:8080") is True

    def test_127_subnet(self):
        """Test that 127.x.x.x addresses are recognized."""
        assert is_localhost_url("http://127.1.2.3:8080") is True

    def test_ipv6_localhost(self):
        """Test that IPv6 localhost is recognized."""
        assert is_localhost_url("http://[::1]:8080") is True

    def test_non_localhost(self):
        """Test that non-localhost URLs are not recognized."""
        assert is_localhost_url("http://example.com:8080") is False
        assert is_localhost_url("https://api.example.com") is False

    def test_empty_string(self):
        """Test that empty string returns False."""
        assert is_localhost_url("") is False

    def test_none(self):
        """Test that None returns False."""
        assert is_localhost_url(None) is False

    def test_invalid_url(self):
        """Test that invalid URLs return False."""
        assert is_localhost_url("not-a-url") is False
        assert is_localhost_url("://invalid") is False

    def test_localhost_with_path(self):
        """Test that localhost with path is still recognized."""
        assert is_localhost_url("http://localhost:8080/api/v1") is True

    def test_localhost_without_port(self):
        """Test that localhost without port is recognized."""
        assert is_localhost_url("http://localhost") is True
