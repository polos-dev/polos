"""Tests for execution security utilities."""

import os
import tempfile

from polos.execution.security import assert_safe_path, evaluate_allowlist, match_glob


class TestMatchGlob:
    """Tests for match_glob."""

    def test_matches_exact_strings(self):
        """Exact string matches succeed."""
        assert match_glob("ls", "ls") is True
        assert match_glob("pwd", "pwd") is True

    def test_does_not_match_different_strings(self):
        """Different strings do not match."""
        assert match_glob("ls", "pwd") is False
        assert match_glob("rm", "ls") is False

    def test_matches_wildcard_at_end(self):
        """Trailing wildcard matches any suffix."""
        assert match_glob("node hello.js", "node *") is True
        assert match_glob("node server.js", "node *") is True
        assert match_glob("npm install", "npm *") is True

    def test_matches_full_wildcard(self):
        """Single wildcard matches anything."""
        assert match_glob("anything", "*") is True
        assert match_glob("ls -la", "*") is True
        assert match_glob("", "*") is True

    def test_matches_wildcard_in_middle(self):
        """Wildcard in the middle matches any infix."""
        assert match_glob("npm run test", "npm * test") is True
        assert match_glob("npm run build", "npm * build") is True
        assert match_glob("npm run build", "npm * test") is False

    def test_matches_multiple_wildcards(self):
        """Multiple wildcards match independently."""
        assert match_glob("npm run test", "npm * *") is True
        assert match_glob("a b c", "* * *") is True

    def test_handles_regex_special_characters_in_patterns(self):
        """Regex special characters in the pattern are escaped."""
        assert match_glob("cat file.txt", "cat file.txt") is True
        assert match_glob("cat file.txt", "cat filetxt") is False
        assert match_glob("echo (hello)", "echo (hello)") is True

    def test_does_not_match_partial_strings_without_wildcard(self):
        """Partial matches without wildcards fail."""
        assert match_glob("node hello.js", "node") is False
        assert match_glob("ls", "ls -la") is False


class TestEvaluateAllowlist:
    """Tests for evaluate_allowlist."""

    def test_matches_exact_command_in_allowlist(self):
        """Exact command in the list matches."""
        assert evaluate_allowlist("ls", ["ls", "pwd", "whoami"]) is True

    def test_matches_glob_pattern_in_allowlist(self):
        """Glob pattern in the list matches."""
        assert evaluate_allowlist("node server.js", ["node *", "npm *"]) is True

    def test_returns_false_when_no_pattern_matches(self):
        """Command matching no pattern returns False."""
        assert evaluate_allowlist("rm -rf /", ["ls", "node *", "npm *"]) is False

    def test_returns_false_for_empty_allowlist(self):
        """Empty allowlist always returns False."""
        assert evaluate_allowlist("ls", []) is False

    def test_matches_full_wildcard_pattern(self):
        """Full wildcard matches everything."""
        assert evaluate_allowlist("anything here", ["*"]) is True

    def test_trims_whitespace_from_command(self):
        """Leading/trailing whitespace on the command is trimmed."""
        assert evaluate_allowlist("  ls  ", ["ls"]) is True
        assert evaluate_allowlist("  node app.js  ", ["node *"]) is True

    def test_does_not_match_partial_commands_without_wildcard(self):
        """Partial commands without wildcard do not match."""
        assert evaluate_allowlist("npm install", ["npm"]) is False
        assert evaluate_allowlist("node", ["node *"]) is False


class TestAssertSafePath:
    """Tests for assert_safe_path."""

    def test_allows_paths_within_the_restriction_directory(self):
        """Relative paths within the restriction succeed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            assert_safe_path("foo/bar.txt", tmpdir)
            assert_safe_path("src/index.ts", tmpdir)
            assert_safe_path("a/b/c/d.txt", tmpdir)

    def test_allows_the_restriction_directory_itself(self):
        """Dot and empty string resolve to the restriction itself."""
        with tempfile.TemporaryDirectory() as tmpdir:
            assert_safe_path(".", tmpdir)
            assert_safe_path("", tmpdir)

    def test_allows_paths_with_safe_relative_segments(self):
        """Relative segments that stay inside are fine."""
        with tempfile.TemporaryDirectory() as tmpdir:
            assert_safe_path("foo/../bar.txt", tmpdir)
            assert_safe_path("./foo/bar.txt", tmpdir)

    def test_throws_on_directory_traversal(self):
        """Parent-directory traversal is blocked."""
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                assert_safe_path("../../etc/passwd", tmpdir)
                raise AssertionError("should have raised")
            except ValueError as e:
                assert "traversal" in str(e).lower()

            try:
                assert_safe_path("../outside.txt", tmpdir)
                raise AssertionError("should have raised")
            except ValueError as e:
                assert "traversal" in str(e).lower()

    def test_throws_on_absolute_paths_outside_restriction(self):
        """Absolute paths outside the restriction are blocked."""
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                assert_safe_path("/etc/passwd", tmpdir)
                raise AssertionError("should have raised")
            except ValueError as e:
                assert "traversal" in str(e).lower()

            try:
                assert_safe_path("/tmp/evil.sh", tmpdir)
                raise AssertionError("should have raised")
            except ValueError as e:
                assert "traversal" in str(e).lower()

    def test_allows_absolute_paths_within_restriction(self):
        """Absolute paths that resolve inside the restriction succeed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a path that is within the restriction
            inner = os.path.join(tmpdir, "foo.txt")
            assert_safe_path(inner, tmpdir)

    def test_blocks_traversal_that_escapes_via_deep_nesting(self):
        """Deep relative traversal that escapes is caught."""
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                assert_safe_path("a/b/c/../../../../etc/passwd", tmpdir)
                raise AssertionError("should have raised")
            except ValueError as e:
                assert "traversal" in str(e).lower()
