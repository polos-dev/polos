"""Tests for the local execution environment."""

import os
import tempfile

import pytest

from polos.execution.local import LocalEnvironment
from polos.execution.types import LocalEnvironmentConfig


@pytest.fixture
def tmp_dir():
    """Create and clean up a temporary directory."""
    with tempfile.TemporaryDirectory() as d:
        yield d


class TestLocalEnvironmentType:
    """Tests for the type property."""

    def test_has_type_local(self, tmp_dir):
        """Type is 'local'."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        assert env.type == "local"


class TestLocalEnvironmentGetCwd:
    """Tests for get_cwd."""

    def test_returns_configured_cwd(self, tmp_dir):
        """Configured cwd is returned."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        assert env.get_cwd() == os.path.abspath(tmp_dir)

    def test_defaults_to_process_cwd_when_no_cwd_given(self):
        """Without config, defaults to os.getcwd()."""
        env = LocalEnvironment()
        assert env.get_cwd() == os.path.abspath(os.getcwd())


class TestLocalEnvironmentGetInfo:
    """Tests for get_info."""

    def test_returns_local_environment_info(self, tmp_dir):
        """Info contains type and cwd."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        info = env.get_info()
        assert info.type == "local"
        assert info.cwd == os.path.abspath(tmp_dir)


class TestLocalEnvironmentInitialize:
    """Tests for initialize."""

    @pytest.mark.asyncio
    async def test_succeeds_for_existing_directory(self, tmp_dir):
        """Initialization succeeds for an existing directory."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

    @pytest.mark.asyncio
    async def test_throws_for_non_existent_directory(self, tmp_dir):
        """Initialization raises for a missing directory."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=os.path.join(tmp_dir, "nonexistent")))
        with pytest.raises(RuntimeError, match="does not exist"):
            await env.initialize()

    @pytest.mark.asyncio
    async def test_throws_if_cwd_is_a_file(self, tmp_dir):
        """Initialization raises when cwd is a file, not a directory."""
        file_path = os.path.join(tmp_dir, "afile.txt")
        with open(file_path, "w") as f:
            f.write("hello")
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=file_path))
        with pytest.raises(RuntimeError, match="not a directory"):
            await env.initialize()


class TestLocalEnvironmentDestroy:
    """Tests for destroy."""

    @pytest.mark.asyncio
    async def test_is_a_noop(self, tmp_dir):
        """Destroy is a no-op and does not raise."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.destroy()


class TestLocalEnvironmentExec:
    """Tests for exec."""

    @pytest.mark.asyncio
    async def test_runs_a_simple_command(self, tmp_dir):
        """A simple echo command succeeds."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        result = await env.exec("echo hello")
        assert result.exit_code == 0
        assert result.stdout.strip() == "hello"
        assert result.duration_ms >= 0
        assert result.truncated is False

    @pytest.mark.asyncio
    async def test_captures_stderr(self, tmp_dir):
        """Standard error is captured."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        result = await env.exec("echo err >&2")
        assert "err" in result.stderr

    @pytest.mark.asyncio
    async def test_returns_non_zero_exit_code_on_failure(self, tmp_dir):
        """Non-zero exit code is returned."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        result = await env.exec("exit 42")
        assert result.exit_code == 42

    @pytest.mark.asyncio
    async def test_respects_cwd_option(self, tmp_dir):
        """Custom cwd is used for the command."""
        sub_dir = os.path.join(tmp_dir, "sub")
        os.makedirs(sub_dir)

        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        from polos.execution.types import ExecOptions

        result = await env.exec("pwd", ExecOptions(cwd=sub_dir))
        # pwd returns the real path (resolving symlinks), e.g. /private/var on macOS
        assert result.stdout.strip() == os.path.realpath(sub_dir)

    @pytest.mark.asyncio
    async def test_respects_env_option(self, tmp_dir):
        """Custom environment variables are set."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        from polos.execution.types import ExecOptions

        result = await env.exec("echo $MY_VAR", ExecOptions(env={"MY_VAR": "test123"}))
        assert result.stdout.strip() == "test123"


class TestLocalEnvironmentReadFile:
    """Tests for read_file."""

    @pytest.mark.asyncio
    async def test_reads_a_text_file(self, tmp_dir):
        """A text file is read correctly."""
        file_path = os.path.join(tmp_dir, "test.txt")
        with open(file_path, "w") as f:
            f.write("file content")

        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        content = await env.read_file("test.txt")
        assert content == "file content"

    @pytest.mark.asyncio
    async def test_reads_file_with_absolute_path(self, tmp_dir):
        """An absolute path is accepted."""
        file_path = os.path.join(tmp_dir, "abs.txt")
        with open(file_path, "w") as f:
            f.write("absolute")

        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        content = await env.read_file(file_path)
        assert content == "absolute"

    @pytest.mark.asyncio
    async def test_throws_for_non_existent_file(self, tmp_dir):
        """Reading a missing file raises."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        with pytest.raises(FileNotFoundError):
            await env.read_file("nonexistent.txt")


class TestLocalEnvironmentWriteFile:
    """Tests for write_file."""

    @pytest.mark.asyncio
    async def test_writes_a_file(self, tmp_dir):
        """Content is written to a file."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        await env.write_file("output.txt", "written content")

        with open(os.path.join(tmp_dir, "output.txt")) as f:
            assert f.read() == "written content"

    @pytest.mark.asyncio
    async def test_creates_parent_directories(self, tmp_dir):
        """Missing parent directories are created."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        await env.write_file("deep/nested/file.txt", "nested")

        with open(os.path.join(tmp_dir, "deep", "nested", "file.txt")) as f:
            assert f.read() == "nested"


class TestLocalEnvironmentFileExists:
    """Tests for file_exists."""

    @pytest.mark.asyncio
    async def test_returns_true_for_existing_file(self, tmp_dir):
        """Existing files return True."""
        with open(os.path.join(tmp_dir, "exists.txt"), "w") as f:
            f.write("")

        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()
        assert await env.file_exists("exists.txt") is True

    @pytest.mark.asyncio
    async def test_returns_false_for_non_existent_file(self, tmp_dir):
        """Missing files return False."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()
        assert await env.file_exists("nope.txt") is False


class TestLocalEnvironmentGlob:
    """Tests for glob."""

    @pytest.mark.asyncio
    async def test_finds_files_matching_pattern(self, tmp_dir):
        """Files matching the glob pattern are found."""
        for name in ["a.ts", "b.ts", "c.js"]:
            with open(os.path.join(tmp_dir, name), "w") as f:
                f.write("")

        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        results = await env.glob("*.ts")
        assert len(results) == 2
        assert any(r.endswith("a.ts") for r in results)
        assert any(r.endswith("b.ts") for r in results)

    @pytest.mark.asyncio
    async def test_returns_empty_list_when_no_matches(self, tmp_dir):
        """No matches yield an empty list."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        results = await env.glob("*.xyz")
        assert results == []


class TestLocalEnvironmentGrep:
    """Tests for grep."""

    @pytest.mark.asyncio
    async def test_finds_pattern_in_files(self, tmp_dir):
        """Lines matching the pattern are returned."""
        with open(os.path.join(tmp_dir, "search.txt"), "w") as f:
            f.write("hello world\nfoo bar\nhello again")

        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        results = await env.grep("hello")
        assert len(results) >= 2

    @pytest.mark.asyncio
    async def test_returns_empty_list_when_no_matches(self, tmp_dir):
        """No matches yield an empty list."""
        with open(os.path.join(tmp_dir, "search.txt"), "w") as f:
            f.write("nothing here")

        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        results = await env.grep("nonexistent_pattern_xyz")
        assert results == []


class TestLocalEnvironmentPathRestriction:
    """Tests for path restriction."""

    @pytest.mark.asyncio
    async def test_allows_file_reads_outside_restricted_path(self, tmp_dir):
        """read_file no longer enforces path restriction (tool layer does)."""
        outside_file = os.path.join(tempfile.gettempdir(), f"polos-outside-test-{os.getpid()}.txt")
        with open(outside_file, "w") as f:
            f.write("outside content")

        try:
            env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir, path_restriction=tmp_dir))
            await env.initialize()

            content = await env.read_file(outside_file)
            assert content == "outside content"
        finally:
            os.unlink(outside_file)

    @pytest.mark.asyncio
    async def test_blocks_file_writes_outside_restricted_path(self, tmp_dir):
        """Writes outside the restricted path are blocked."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir, path_restriction=tmp_dir))
        await env.initialize()

        with pytest.raises(ValueError, match="[Pp]ath traversal"):
            await env.write_file("/tmp/evil.txt", "bad")

    @pytest.mark.asyncio
    async def test_allows_file_operations_within_restricted_path(self, tmp_dir):
        """Operations within the restricted path succeed."""
        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir, path_restriction=tmp_dir))
        await env.initialize()

        await env.write_file("allowed.txt", "ok")
        content = await env.read_file("allowed.txt")
        assert content == "ok"

    @pytest.mark.asyncio
    async def test_blocks_symlinks_when_path_restriction_is_set(self, tmp_dir):
        """Symlinks are blocked when path restriction is active."""
        real_file = os.path.join(tmp_dir, "real.txt")
        link_file = os.path.join(tmp_dir, "link.txt")
        with open(real_file, "w") as f:
            f.write("real content")
        os.symlink(real_file, link_file)

        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir, path_restriction=tmp_dir))
        await env.initialize()

        with pytest.raises(ValueError, match="[Ss]ymbolic link"):
            await env.read_file("link.txt")

    @pytest.mark.asyncio
    async def test_allows_symlinks_when_path_restriction_is_not_set(self, tmp_dir):
        """Symlinks are followed when there is no path restriction."""
        real_file = os.path.join(tmp_dir, "real.txt")
        link_file = os.path.join(tmp_dir, "link.txt")
        with open(real_file, "w") as f:
            f.write("real content")
        os.symlink(real_file, link_file)

        env = LocalEnvironment(LocalEnvironmentConfig(cwd=tmp_dir))
        await env.initialize()

        content = await env.read_file("link.txt")
        assert content == "real content"
