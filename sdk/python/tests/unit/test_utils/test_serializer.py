"""Unit tests for polos.utils.serializer module."""

import json

import pytest
from pydantic import BaseModel

from polos.types.types import AgentResult, ToolResult, Usage
from polos.utils.serializer import (
    deserialize,
    deserialize_agent_result,
    is_json_serializable,
    json_serialize,
    safe_serialize,
    serialize,
)


# Define test models at module level so they can be dynamically imported
# Note: Using a name that doesn't start with "Test" to avoid pytest collection issues
class SerializerTestModel(BaseModel):
    """Test model for deserialization tests."""

    name: str
    age: int


class TestIsJsonSerializable:
    """Tests for is_json_serializable function."""

    def test_serializable_dict(self):
        """Test that dicts are JSON serializable."""
        assert is_json_serializable({"key": "value"}) is True

    def test_serializable_list(self):
        """Test that lists are JSON serializable."""
        assert is_json_serializable([1, 2, 3]) is True

    def test_serializable_string(self):
        """Test that strings are JSON serializable."""
        assert is_json_serializable("test") is True

    def test_serializable_int(self):
        """Test that integers are JSON serializable."""
        assert is_json_serializable(42) is True

    def test_serializable_float(self):
        """Test that floats are JSON serializable."""
        assert is_json_serializable(3.14) is True

    def test_serializable_bool(self):
        """Test that booleans are JSON serializable."""
        assert is_json_serializable(True) is True
        assert is_json_serializable(False) is True

    def test_serializable_none(self):
        """Test that None is JSON serializable."""
        assert is_json_serializable(None) is True

    def test_not_serializable_object(self):
        """Test that arbitrary objects are not JSON serializable."""
        assert is_json_serializable(object()) is False

    def test_not_serializable_function(self):
        """Test that functions are not JSON serializable."""

        def test_func():
            pass

        assert is_json_serializable(test_func) is False

    def test_nested_serializable(self):
        """Test nested serializable structures."""
        data = {
            "list": [1, 2, {"nested": "value"}],
            "dict": {"key": "value"},
        }
        assert is_json_serializable(data) is True


class TestSerialize:
    """Tests for serialize function."""

    def test_serialize_pydantic_model(self):
        """Test serializing a Pydantic model."""

        class TestModel(BaseModel):
            name: str
            age: int

        model = TestModel(name="test", age=25)
        result = serialize(model)
        assert result == {"name": "test", "age": 25}
        assert isinstance(result, dict)

    def test_serialize_dict(self):
        """Test serializing a dict."""
        data = {"key": "value"}
        result = serialize(data)
        assert result == data

    def test_serialize_list(self):
        """Test serializing a list."""
        data = [1, 2, 3]
        result = serialize(data)
        assert result == data

    def test_serialize_primitive_types(self):
        """Test serializing primitive types."""
        assert serialize("string") == "string"
        assert serialize(42) == 42
        assert serialize(3.14) == 3.14
        assert serialize(True) is True
        assert serialize(None) is None

    def test_serialize_nested_dict(self):
        """Test serializing nested dicts."""
        data = {"outer": {"inner": "value"}}
        result = serialize(data)
        assert result == data

    def test_serialize_invalid_type(self):
        """Test that invalid types raise TypeError."""
        with pytest.raises(TypeError, match="not JSON serializable"):
            serialize(object())

    def test_serialize_function(self):
        """Test that functions raise TypeError."""

        def test_func():
            pass

        with pytest.raises(TypeError, match="not JSON serializable"):
            serialize(test_func)


class TestJsonSerialize:
    """Tests for json_serialize function."""

    def test_json_serialize_pydantic_model(self):
        """Test serializing a Pydantic model to JSON string."""

        class TestModel(BaseModel):
            name: str
            age: int

        model = TestModel(name="test", age=25)
        result = json_serialize(model)
        assert isinstance(result, str)
        parsed = json.loads(result)
        assert parsed == {"name": "test", "age": 25}

    def test_json_serialize_dict(self):
        """Test serializing a dict to JSON string."""
        data = {"key": "value"}
        result = json_serialize(data)
        assert isinstance(result, str)
        assert json.loads(result) == data

    def test_json_serialize_list(self):
        """Test serializing a list to JSON string."""
        data = [1, 2, 3]
        result = json_serialize(data)
        assert isinstance(result, str)
        assert json.loads(result) == data

    def test_json_serialize_primitive_types(self):
        """Test serializing primitive types to JSON string."""
        assert json_serialize("string") == '"string"'
        assert json_serialize(42) == "42"
        assert json_serialize(3.14) == "3.14"
        assert json_serialize(True) == "true"
        assert json_serialize(None) == "null"

    def test_json_serialize_invalid_type(self):
        """Test that invalid types raise TypeError."""
        with pytest.raises(TypeError, match="not JSON serializable"):
            json_serialize(object())

    def test_json_serialize_chains_exception(self):
        """Test that TypeError chains the original exception."""
        try:
            json_serialize(object())
        except TypeError as e:
            assert e.__cause__ is not None


class TestDeserialize:
    """Tests for deserialize function."""

    @pytest.mark.asyncio
    async def test_deserialize_dict(self):
        """Test deserializing a dict without schema."""
        data = {"key": "value"}
        result = await deserialize(data)
        assert result == data

    @pytest.mark.asyncio
    async def test_deserialize_list(self):
        """Test deserializing a list."""
        data = [1, 2, 3]
        result = await deserialize(data)
        assert result == data

    @pytest.mark.asyncio
    async def test_deserialize_with_schema(self):
        """Test deserializing with a valid schema name."""
        # Create a dict that matches the model
        data = {"name": "test", "age": 25}
        # Use the full module path for the schema
        schema_name = f"{SerializerTestModel.__module__}.{SerializerTestModel.__name__}"
        result = await deserialize(data, schema_name)
        assert isinstance(result, SerializerTestModel)
        assert result.name == "test"
        assert result.age == 25

    @pytest.mark.asyncio
    async def test_deserialize_with_invalid_schema(self):
        """Test deserializing with an invalid schema name raises Exception."""
        data = {"key": "value"}
        with pytest.raises(Exception, match="Failed to reconstruct"):
            await deserialize(data, "nonexistent.module.NonExistentClass")

    @pytest.mark.asyncio
    async def test_deserialize_with_none_schema(self):
        """Test deserializing without schema returns original data."""
        data = {"key": "value"}
        result = await deserialize(data, None)
        assert result == data


class TestDeserializeAgentResult:
    """Tests for deserialize_agent_result function."""

    @pytest.mark.asyncio
    async def test_deserialize_agent_result_no_schema(self):
        """Test deserializing agent result without schema."""
        result = AgentResult(
            agent_run_id="test-run-123",
            total_steps=1,
            result={"key": "value"},
            tool_results=[],
            usage=Usage(input_tokens=10, output_tokens=20),
        )
        deserialized = await deserialize_agent_result(result)
        assert deserialized.result == {"key": "value"}

    @pytest.mark.asyncio
    async def test_deserialize_agent_result_with_tool_results(self):
        """Test deserializing agent result with tool results."""
        tool_result = ToolResult(
            tool_name="test_tool",
            status="completed",
            tool_call_id="call-123",
            tool_call_call_id="call-call-123",
            result={"tool_key": "tool_value"},
            result_schema=None,
        )
        result = AgentResult(
            agent_run_id="test-run-123",
            total_steps=1,
            result={"key": "value"},
            tool_results=[tool_result],
            usage=Usage(input_tokens=10, output_tokens=20),
        )
        deserialized = await deserialize_agent_result(result)
        assert len(deserialized.tool_results) == 1
        assert deserialized.tool_results[0].result == {"tool_key": "tool_value"}


class TestSafeSerialize:
    """Tests for safe_serialize function."""

    def test_safe_serialize_valid_object(self):
        """Test safe_serialize with a valid serializable object."""
        data = {"key": "value"}
        result = safe_serialize(data)
        assert result == data

    def test_safe_serialize_pydantic_model(self):
        """Test safe_serialize with a Pydantic model."""

        class TestModel(BaseModel):
            name: str

        model = TestModel(name="test")
        result = safe_serialize(model)
        assert result == {"name": "test"}

    def test_safe_serialize_invalid_object(self):
        """Test safe_serialize with an invalid object returns fallback."""
        obj = object()
        result = safe_serialize(obj)
        assert isinstance(result, str)
        assert "<object>" in result

    def test_safe_serialize_function(self):
        """Test safe_serialize with a function returns fallback."""

        def test_func():
            pass

        result = safe_serialize(test_func)
        assert isinstance(result, str)
        assert "test_func" in result or "<function" in result

    def test_safe_serialize_class(self):
        """Test safe_serialize with a class returns fallback."""

        class TestClass:
            pass

        result = safe_serialize(TestClass)
        assert isinstance(result, str)
        assert "TestClass" in result or "<class" in result
