"""Tests for the sandbox_tools factory."""

import pytest

from polos.execution.sandbox_tools import sandbox_tools
from polos.execution.types import ExecToolConfig, SandboxToolsConfig


class TestSandboxToolsFactory:
    """Tests for the sandboxTools() factory function."""

    def test_returns_all_6_tools_by_default(self):
        """Default config creates all 6 tools."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker"))

        assert len(tools) == 6

        ids = [t.id for t in tools]
        assert "exec" in ids
        assert "read" in ids
        assert "write" in ids
        assert "edit" in ids
        assert "glob" in ids
        assert "grep" in ids

    def test_returns_subset_when_tools_option_is_specified(self):
        """Only requested tools are created."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker", tools=["read", "glob"]))

        assert len(tools) == 2
        assert tools[0].id == "read"
        assert tools[1].id == "glob"

    def test_returns_single_tool_when_specified(self):
        """A single tool can be requested."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker", tools=["exec"]))

        assert len(tools) == 1
        assert tools[0].id == "exec"

    def test_each_tool_has_valid_llm_definition(self):
        """Each tool produces a valid LLM tool definition."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker"))

        for tool in tools:
            defn = tool.to_llm_tool_definition()

            assert defn["type"] == "function"
            assert defn["function"]["name"]
            assert defn["function"]["description"]
            assert isinstance(defn["function"]["parameters"], dict)
            assert "properties" in defn["function"]["parameters"]

    def test_exec_tool_definition_includes_command_parameter(self):
        """Exec tool definition contains a 'command' property."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker", tools=["exec"]))
        exec_def = tools[0].to_llm_tool_definition()
        props = exec_def["function"]["parameters"]["properties"]
        assert "command" in props

    def test_read_tool_definition_includes_path_parameter(self):
        """Read tool definition contains a 'path' property."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker", tools=["read"]))
        read_def = tools[0].to_llm_tool_definition()
        props = read_def["function"]["parameters"]["properties"]
        assert "path" in props

    def test_write_tool_definition_includes_path_and_content_parameters(self):
        """Write tool definition contains 'path' and 'content' properties."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker", tools=["write"]))
        write_def = tools[0].to_llm_tool_definition()
        props = write_def["function"]["parameters"]["properties"]
        assert "path" in props
        assert "content" in props

    def test_edit_tool_definition_includes_required_parameters(self):
        """Edit tool definition contains path, old_text, new_text properties."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker", tools=["edit"]))
        edit_def = tools[0].to_llm_tool_definition()
        props = edit_def["function"]["parameters"]["properties"]
        assert "path" in props
        assert "old_text" in props
        assert "new_text" in props

    def test_glob_tool_definition_includes_pattern_parameter(self):
        """Glob tool definition contains a 'pattern' property."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker", tools=["glob"]))
        glob_def = tools[0].to_llm_tool_definition()
        props = glob_def["function"]["parameters"]["properties"]
        assert "pattern" in props

    def test_grep_tool_definition_includes_pattern_parameter(self):
        """Grep tool definition contains a 'pattern' property."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker", tools=["grep"]))
        grep_def = tools[0].to_llm_tool_definition()
        props = grep_def["function"]["parameters"]["properties"]
        assert "pattern" in props

    def test_has_a_cleanup_method(self):
        """Result has a cleanup method."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker"))
        assert callable(tools.cleanup)

    @pytest.mark.asyncio
    async def test_cleanup_is_safe_without_initialization(self):
        """Cleanup before any tool use does not raise."""
        tools = sandbox_tools(SandboxToolsConfig(env="docker"))
        await tools.cleanup()

    def test_throws_for_e2b_environment(self):
        """E2B environment raises NotImplementedError."""
        with pytest.raises(NotImplementedError, match="not yet implemented"):
            sandbox_tools(SandboxToolsConfig(env="e2b"))

    def test_creates_tools_for_local_environment(self):
        """Local environment creates all 6 tools."""
        tools = sandbox_tools(SandboxToolsConfig(env="local"))

        assert len(tools) == 6
        ids = [t.id for t in tools]
        assert "exec" in ids
        assert "read" in ids
        assert "write" in ids
        assert "edit" in ids
        assert "glob" in ids
        assert "grep" in ids

    def test_local_environment_defaults_exec_security(self):
        """Local env defaults exec security to approval-always."""
        tools = sandbox_tools(SandboxToolsConfig(env="local"))
        assert len(tools) == 6

    def test_local_environment_respects_explicit_exec_security(self):
        """Explicit exec security override is accepted."""
        tools = sandbox_tools(
            SandboxToolsConfig(
                env="local",
                exec=ExecToolConfig(security="allow-always"),
            )
        )
        assert len(tools) == 6
