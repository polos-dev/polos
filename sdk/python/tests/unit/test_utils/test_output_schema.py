"""Unit tests for polos.utils.output_schema module."""

import pytest
from pydantic import BaseModel

from polos.utils.output_schema import (
    _ensure_additional_properties_false,
    _ensure_required_for_all_properties,
    _inline_refs,
    _validate_output_schema_v2,
    convert_output_schema,
)


class TestConvertOutputSchema:
    """Tests for convert_output_schema function."""

    def test_none_schema(self):
        """Test that None schema returns None, None."""
        schema_dict, schema_name = convert_output_schema(None)
        assert schema_dict is None
        assert schema_name is None

    def test_valid_pydantic_v2_model(self):
        """Test converting a valid Pydantic v2 model."""

        class TestModel(BaseModel):
            name: str
            age: int

        schema_dict, schema_name = convert_output_schema(TestModel)
        assert schema_name == "TestModel"
        assert isinstance(schema_dict, dict)
        assert "properties" in schema_dict
        assert "name" in schema_dict["properties"]
        assert "age" in schema_dict["properties"]
        assert schema_dict["additionalProperties"] is False
        assert "required" in schema_dict
        assert "name" in schema_dict["required"]
        assert "age" in schema_dict["required"]

    def test_pydantic_v2_model_with_optional_default(self):
        """Test model with optional field that has default value."""

        class TestModel(BaseModel):
            name: str
            age: int | None = None

        schema_dict, schema_name = convert_output_schema(TestModel)
        assert schema_name == "TestModel"
        assert isinstance(schema_dict, dict)

    def test_pydantic_v2_model_with_optional_no_default(self):
        """Test model with optional field without default raises ValueError."""

        class TestModel(BaseModel):
            name: str
            age: int | None  # No default value

        with pytest.raises(ValueError, match="Optional fields must have default values"):
            convert_output_schema(TestModel)

    def test_invalid_type(self):
        """Test that non-Pydantic class raises ValueError."""

        class NotAPydanticModel:
            pass

        with pytest.raises(ValueError, match="must be a Pydantic model class"):
            convert_output_schema(NotAPydanticModel)

    def test_with_context_id(self):
        """Test that context_id is included in error messages."""

        class NotAPydanticModel:
            pass

        with pytest.raises(ValueError, match="for test-agent"):
            convert_output_schema(NotAPydanticModel, context_id="test-agent")

    def test_nested_model(self):
        """Test converting a model with nested objects."""

        class NestedModel(BaseModel):
            value: str

        class TestModel(BaseModel):
            name: str
            nested: NestedModel

        schema_dict, schema_name = convert_output_schema(TestModel)
        assert schema_name == "TestModel"
        assert "nested" in schema_dict["properties"]
        nested_schema = schema_dict["properties"]["nested"]
        assert nested_schema.get("additionalProperties") is False


class TestValidateOutputSchemaV2:
    """Tests for _validate_output_schema_v2 function."""

    def test_valid_model_all_required(self):
        """Test model with all required fields passes validation."""

        class TestModel(BaseModel):
            name: str
            age: int

        # Should not raise
        _validate_output_schema_v2(TestModel)

    def test_valid_model_optional_with_default(self):
        """Test model with optional field that has default passes."""

        class TestModel(BaseModel):
            name: str
            age: int | None = None

        # Should not raise
        _validate_output_schema_v2(TestModel)

    def test_invalid_model_optional_no_default(self):
        """Test model with optional field without default raises ValueError."""

        class TestModel(BaseModel):
            name: str
            age: int | None  # No default

        with pytest.raises(ValueError, match="Optional fields must have default values"):
            _validate_output_schema_v2(TestModel)

    def test_invalid_model_multiple_optional_no_default(self):
        """Test model with multiple optional fields without defaults."""

        class TestModel(BaseModel):
            name: str
            age: int | None  # No default
            email: str | None  # No default

        with pytest.raises(ValueError, match="age, email"):
            _validate_output_schema_v2(TestModel)

    def test_with_context_id(self):
        """Test that context_id is included in error message."""

        class TestModel(BaseModel):
            name: str
            age: int | None  # No default

        with pytest.raises(ValueError, match="for test-agent"):
            _validate_output_schema_v2(TestModel, context_id="test-agent")


class TestEnsureAdditionalPropertiesFalse:
    """Tests for _ensure_additional_properties_false function."""

    def test_simple_object(self):
        """Test that simple object gets additionalProperties: false."""
        schema = {"type": "object", "properties": {"name": {"type": "string"}}}
        _ensure_additional_properties_false(schema)
        assert schema["additionalProperties"] is False

    def test_nested_objects(self):
        """Test that nested objects get additionalProperties: false."""
        schema = {
            "type": "object",
            "properties": {
                "nested": {
                    "type": "object",
                    "properties": {"value": {"type": "string"}},
                },
            },
        }
        _ensure_additional_properties_false(schema)
        assert schema["additionalProperties"] is False
        assert schema["properties"]["nested"]["additionalProperties"] is False

    def test_array_items(self):
        """Test that array items get processed."""
        schema = {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"value": {"type": "string"}},
            },
        }
        _ensure_additional_properties_false(schema)
        assert schema["items"]["additionalProperties"] is False

    def test_defs_processing(self):
        """Test that $defs are processed."""
        schema = {
            "type": "object",
            "$defs": {
                "Nested": {
                    "type": "object",
                    "properties": {"value": {"type": "string"}},
                },
            },
        }
        _ensure_additional_properties_false(schema)
        assert schema["$defs"]["Nested"]["additionalProperties"] is False

    def test_definitions_processing(self):
        """Test that definitions (v1) are processed."""
        schema = {
            "type": "object",
            "definitions": {
                "Nested": {
                    "type": "object",
                    "properties": {"value": {"type": "string"}},
                },
            },
        }
        _ensure_additional_properties_false(schema)
        assert schema["definitions"]["Nested"]["additionalProperties"] is False


class TestEnsureRequiredForAllProperties:
    """Tests for _ensure_required_for_all_properties function."""

    def test_adds_missing_properties_to_required(self):
        """Test that missing properties are added to required array."""
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer"},
            },
            "required": ["name"],  # age is missing
        }
        _ensure_required_for_all_properties(schema)
        assert "age" in schema["required"]
        assert len(schema["required"]) == 2

    def test_all_properties_already_required(self):
        """Test that schema with all properties required is unchanged."""
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer"},
            },
            "required": ["name", "age"],
        }
        original_required = schema["required"].copy()
        _ensure_required_for_all_properties(schema)
        assert set(schema["required"]) == set(original_required)

    def test_no_required_array_creates_one(self):
        """Test that missing required array is created with all properties."""
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer"},
            },
        }
        _ensure_required_for_all_properties(schema)
        assert "required" in schema
        assert set(schema["required"]) == {"name", "age"}

    def test_nested_objects(self):
        """Test that nested objects get processed."""
        schema = {
            "type": "object",
            "properties": {
                "nested": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "string"},
                        "other": {"type": "string"},
                    },
                },
            },
        }
        _ensure_required_for_all_properties(schema)
        nested_required = schema["properties"]["nested"]["required"]
        assert set(nested_required) == {"value", "other"}

    def test_defs_processing(self):
        """Test that $defs are processed."""
        schema = {
            "type": "object",
            "$defs": {
                "Nested": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "string"},
                        "other": {"type": "string"},
                    },
                },
            },
        }
        _ensure_required_for_all_properties(schema)
        assert "required" in schema["$defs"]["Nested"]
        assert set(schema["$defs"]["Nested"]["required"]) == {"value", "other"}


class TestInlineRefs:
    """Tests for _inline_refs function."""

    def test_inline_simple_ref(self):
        """Test inlining a simple $ref reference."""
        schema = {
            "type": "object",
            "properties": {
                "name": {"$ref": "#/$defs/PersonName"},
            },
            "$defs": {
                "PersonName": {
                    "type": "string",
                    "minLength": 1,
                },
            },
        }
        _inline_refs(schema)
        # $ref should be replaced with actual schema
        assert "$ref" not in schema["properties"]["name"]
        assert schema["properties"]["name"]["type"] == "string"
        assert schema["properties"]["name"]["minLength"] == 1

    def test_inline_ref_preserves_other_keys(self):
        """Test that inlining preserves other keys like description."""
        schema = {
            "type": "object",
            "properties": {
                "name": {
                    "$ref": "#/$defs/PersonName",
                    "description": "Person's name",
                },
            },
            "$defs": {
                "PersonName": {
                    "type": "string",
                },
            },
        }
        _inline_refs(schema)
        assert schema["properties"]["name"]["type"] == "string"
        assert schema["properties"]["name"]["description"] == "Person's name"

    def test_inline_nested_refs(self):
        """Test inlining nested $ref references."""
        schema = {
            "type": "object",
            "properties": {
                "person": {"$ref": "#/$defs/Person"},
            },
            "$defs": {
                "Person": {
                    "type": "object",
                    "properties": {
                        "name": {"$ref": "#/$defs/PersonName"},
                    },
                },
                "PersonName": {
                    "type": "string",
                },
            },
        }
        _inline_refs(schema)
        # Both refs should be inlined
        assert "$ref" not in schema["properties"]["person"]
        assert "$ref" not in schema["properties"]["person"]["properties"]["name"]
        assert schema["properties"]["person"]["properties"]["name"]["type"] == "string"

    def test_inline_refs_definitions_v1(self):
        """Test inlining references from definitions (Pydantic v1)."""
        schema = {
            "type": "object",
            "properties": {
                "name": {"$ref": "#/definitions/PersonName"},
            },
            "definitions": {
                "PersonName": {
                    "type": "string",
                },
            },
        }
        _inline_refs(schema)
        assert "$ref" not in schema["properties"]["name"]
        assert schema["properties"]["name"]["type"] == "string"

    def test_inline_refs_no_ref(self):
        """Test that schema without $ref is unchanged."""
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
            },
        }
        original = schema.copy()
        _inline_refs(schema)
        assert schema == original
