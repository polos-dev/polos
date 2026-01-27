"""Unit tests for polos.agents.stream module."""

import pytest
from pydantic import BaseModel

from polos.agents.stream import _parse_structured_output


class TestParseStructuredOutput:
    """Tests for _parse_structured_output function."""

    @pytest.mark.asyncio
    async def test_parse_structured_output_with_schema(self):
        """Test _parse_structured_output with Pydantic schema."""

        class OutputSchema(BaseModel):
            name: str
            age: int

        output_str = '{"name": "John", "age": 30}'
        parsed_output, success = await _parse_structured_output(output_str, OutputSchema)
        assert success is True
        assert isinstance(parsed_output, OutputSchema)
        assert parsed_output.name == "John"
        assert parsed_output.age == 30

    @pytest.mark.asyncio
    async def test_parse_structured_output_without_schema(self):
        """Test _parse_structured_output without schema returns original."""
        output_str = '{"name": "John", "age": 30}'
        parsed_output, success = await _parse_structured_output(output_str, None)
        assert success is True
        assert parsed_output == output_str  # Returns original string

    @pytest.mark.asyncio
    async def test_parse_structured_output_invalid_json(self):
        """Test _parse_structured_output with invalid JSON."""
        output_str = "not valid json"
        parsed_output, success = await _parse_structured_output(output_str, None)
        assert success is True
        # Should return the string as-is when no schema
        assert parsed_output == "not valid json"

    @pytest.mark.asyncio
    async def test_parse_structured_output_invalid_schema(self):
        """Test _parse_structured_output with invalid schema data."""

        class OutputSchema(BaseModel):
            name: str
            age: int

        output_str = '{"name": "John"}'  # Missing age field
        parsed_output, success = await _parse_structured_output(output_str, OutputSchema)
        # Should return False for success when parsing fails
        assert success is False
        # Should return original string when parsing fails
        assert parsed_output == output_str

    @pytest.mark.asyncio
    async def test_parse_structured_output_empty_string(self):
        """Test _parse_structured_output with empty string."""
        parsed_output, success = await _parse_structured_output("", None)
        assert success is True
        assert parsed_output == ""

    @pytest.mark.asyncio
    async def test_parse_structured_output_already_dict(self):
        """Test _parse_structured_output with dict input."""
        output_dict = {"name": "John", "age": 30}
        parsed_output, success = await _parse_structured_output(output_dict, None)
        assert success is True
        assert parsed_output == output_dict

    @pytest.mark.asyncio
    async def test_parse_structured_output_dict_with_schema(self):
        """Test _parse_structured_output with dict input and schema."""

        class OutputSchema(BaseModel):
            name: str
            age: int

        output_dict = {"name": "John", "age": 30}
        parsed_output, success = await _parse_structured_output(output_dict, OutputSchema)
        assert success is True
        assert isinstance(parsed_output, OutputSchema)
        assert parsed_output.name == "John"
        assert parsed_output.age == 30
