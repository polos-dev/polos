"""Tests for execution output utilities."""

from polos.execution.output import is_binary, parse_grep_output, strip_ansi, truncate_output


class TestTruncateOutput:
    """Tests for truncate_output."""

    def test_returns_original_text_when_under_limit(self):
        """Text below the limit is returned unchanged."""
        text, truncated = truncate_output("hello world", 100)
        assert text == "hello world"
        assert truncated is False

    def test_returns_original_text_when_exactly_at_limit(self):
        """Text exactly at the limit is returned unchanged."""
        text_in = "a" * 100
        text, truncated = truncate_output(text_in, 100)
        assert text == text_in
        assert truncated is False

    def test_truncates_text_exceeding_the_limit(self):
        """Text exceeding the limit is truncated with a marker."""
        text_in = "a" * 200
        text, truncated = truncate_output(text_in, 100)
        assert truncated is True
        assert "--- truncated" in text
        assert "100 characters" in text

    def test_preserves_head_and_tail_portions(self):
        """Head and tail are preserved; middle is dropped."""
        head = "H" * 20
        middle = "M" * 60
        tail = "T" * 20
        text_in = head + middle + tail  # 100 chars
        text, truncated = truncate_output(text_in, 50)
        assert truncated is True
        # Head = 50 * 0.2 = 10 chars, Tail = 40 chars
        assert text.startswith("H" * 10)
        assert text.endswith("T" * 20)

    def test_uses_default_max_when_not_specified(self):
        """Default max is 100,000 characters."""
        text_in = "a" * 99_999
        _, truncated = truncate_output(text_in)
        assert truncated is False

        long_text = "a" * 100_001
        _, truncated2 = truncate_output(long_text)
        assert truncated2 is True


class TestIsBinary:
    """Tests for is_binary."""

    def test_returns_false_for_plain_text(self):
        """Plain UTF-8 text is not binary."""
        data = b"Hello, world!\nThis is a text file.\n"
        assert is_binary(data) is False

    def test_returns_true_for_buffer_with_null_bytes(self):
        """Presence of null bytes means binary."""
        data = bytes([72, 101, 108, 0, 108, 111])
        assert is_binary(data) is True

    def test_returns_false_for_empty_buffer(self):
        """Empty data is not binary."""
        assert is_binary(b"") is False

    def test_only_checks_first_8kb(self):
        """Null byte past the 8KB check window is ignored."""
        data = bytearray(16384)
        for i in range(16384):
            data[i] = 65  # 'A'
        data[10000] = 0  # Null byte after 8KB
        assert is_binary(bytes(data)) is False

    def test_detects_null_byte_within_first_8kb(self):
        """Null byte within the 8KB window is detected."""
        data = bytearray(16384)
        for i in range(16384):
            data[i] = 65
        data[4000] = 0
        assert is_binary(bytes(data)) is True


class TestParseGrepOutput:
    """Tests for parse_grep_output."""

    def test_parses_standard_grep_output(self):
        """Standard grep -rn format is parsed correctly."""
        output = 'src/main.ts:10:const foo = "bar";\nsrc/utils.ts:25:function helper() {'
        matches = parse_grep_output(output)

        assert len(matches) == 2

        assert matches[0].path == "src/main.ts"
        assert matches[0].line == 10
        assert matches[0].text == 'const foo = "bar";'

        assert matches[1].path == "src/utils.ts"
        assert matches[1].line == 25
        assert matches[1].text == "function helper() {"

    def test_returns_empty_array_for_empty_output(self):
        """Empty or whitespace-only output yields no matches."""
        assert parse_grep_output("") == []
        assert parse_grep_output("  \n  ") == []

    def test_handles_paths_with_colons(self):
        """Absolute paths containing colons are handled."""
        output = "/home/user/project/file.ts:5:let x = 1;"
        matches = parse_grep_output(output)
        assert len(matches) == 1
        assert matches[0].path == "/home/user/project/file.ts"
        assert matches[0].line == 5
        assert matches[0].text == "let x = 1;"

    def test_handles_colons_in_matched_text(self):
        """Colons in the matched text do not break parsing."""
        output = 'config.ts:3:const url = "http://localhost:3000";'
        matches = parse_grep_output(output)
        assert len(matches) == 1
        assert matches[0].text == 'const url = "http://localhost:3000";'

    def test_skips_malformed_lines(self):
        """Lines not matching the grep format are silently skipped."""
        output = "valid.ts:1:match\nnot a match\nalso-valid.ts:2:another"
        matches = parse_grep_output(output)
        assert len(matches) == 2


class TestStripAnsi:
    """Tests for strip_ansi."""

    def test_removes_ansi_color_codes(self):
        """ANSI color escape sequences are removed."""
        text = "\x1b[31mRed text\x1b[0m and \x1b[32mgreen text\x1b[0m"
        assert strip_ansi(text) == "Red text and green text"

    def test_returns_plain_text_unchanged(self):
        """Text without ANSI codes passes through."""
        text = "Just plain text"
        assert strip_ansi(text) == text

    def test_handles_bold_and_underline_codes(self):
        """Bold and underline codes are removed."""
        text = "\x1b[1mBold\x1b[0m \x1b[4mUnderline\x1b[0m"
        assert strip_ansi(text) == "Bold Underline"

    def test_handles_empty_string(self):
        """Empty string passes through."""
        assert strip_ansi("") == ""
