"""Utility functions for converting Pydantic models to JSON schemas for structured output."""

import copy
from typing import Any


def convert_output_schema(
    output_schema: type[Any] | None, context_id: str = ""
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Convert a Pydantic model class to JSON schema dict and name for structured output.

    Args:
        output_schema: Pydantic model class (v1 or v2)
        context_id: Optional context identifier for error messages (e.g., agent ID)

    Returns:
        Tuple of (output_schema_dict, output_schema_name) where:
        - output_schema_dict: JSON schema dictionary (None if output_schema is None)
        - output_schema_name: Name of the model class (None if output_schema is None)

    Raises:
        ValueError: If output_schema is not a Pydantic model or conversion fails
    """
    if output_schema is None:
        return None, None

    try:
        # Check if it's a Pydantic model
        if hasattr(output_schema, "model_json_schema"):
            # Pydantic v2 - validate fields first
            _validate_output_schema_v2(output_schema, context_id)

            schema_dict = output_schema.model_json_schema()
            # Inline $ref references
            _inline_refs(schema_dict)
            # Requires additionalProperties: false for structured output
            if "additionalProperties" not in schema_dict:
                schema_dict["additionalProperties"] = False
            # Requires all properties to be in required array
            if "properties" in schema_dict:
                all_properties = set(schema_dict["properties"].keys())
                required_properties = set(schema_dict.get("required", []))
                # Add any missing properties to required
                if all_properties != required_properties:
                    schema_dict["required"] = list(all_properties)
            # Also ensure nested objects have additionalProperties: false
            _ensure_additional_properties_false(schema_dict)
            # Also ensure all nested schemas in $defs have required arrays
            _ensure_required_for_all_properties(schema_dict)
            return schema_dict, output_schema.__name__
        elif hasattr(output_schema, "schema"):
            # Pydantic v1 - validate fields first
            _validate_output_schema_v1(output_schema, context_id)

            schema_dict = output_schema.schema()
            # Inline $ref references
            _inline_refs(schema_dict)
            # Requires additionalProperties: false for structured output
            if "additionalProperties" not in schema_dict:
                schema_dict["additionalProperties"] = False
            # Requires all properties to be in required array
            if "properties" in schema_dict:
                all_properties = set(schema_dict["properties"].keys())
                required_properties = set(schema_dict.get("required", []))
                # Add any missing properties to required
                if all_properties != required_properties:
                    schema_dict["required"] = list(all_properties)
            # Also ensure nested objects have additionalProperties: false
            _ensure_additional_properties_false(schema_dict)
            # Also ensure all nested schemas in $defs have required arrays
            _ensure_required_for_all_properties(schema_dict)
            return schema_dict, output_schema.__name__
        else:
            raise ValueError(
                f"output_schema must be a Pydantic model class. Got: {type(output_schema)}"
            )
    except Exception as e:
        raise ValueError(
            f"Failed to convert output_schema to JSON schema"
            f"{f' for {context_id}' if context_id else ''}: {e}"
        ) from e


def _validate_output_schema_v2(model_class: type[Any], context_id: str = "") -> None:
    """Validate that all optional fields have default values (Pydantic v2)."""
    if not hasattr(model_class, "model_fields"):
        return

    invalid_fields = []
    for _field_name, field_info in model_class.model_fields.items():
        # Check if field is Optional (Union[Type, None] or Type | None)
        import types
        import typing

        field_type = field_info.annotation
        is_optional = False
        if hasattr(typing, "get_origin"):
            origin = typing.get_origin(field_type)
            # Handle both typing.Union and types.UnionType (for Python 3.10+ syntax like int | None)
            if origin is typing.Union or origin is types.UnionType:
                args = typing.get_args(field_type)
                is_optional = type(None) in args

        # Check if field has a default value
        # In Pydantic v2, PydanticUndefined is the sentinel for "no default"
        has_default = False
        try:
            from pydantic_core import PydanticUndefined

            has_default = field_info.default is not PydanticUndefined
        except ImportError:
            # Fallback: PydanticUndefined might be in a different location
            # Check if default is a sentinel value by comparing to known sentinels
            default = field_info.default
            # If default is None, it's an actual default value (not undefined)
            # If default is ..., it's not a default
            # Check if it's the PydanticUndefined sentinel by checking its type/name
            if default is None:
                has_default = True  # None is a valid default
            elif default is not ... and not (
                isinstance(default, type)
                and hasattr(default, "__name__")
                and "Undefined" in default.__name__
            ):
                has_default = True

        # Also check default_factory
        if not has_default:
            has_default = field_info.default_factory is not None

        # If field is Optional but doesn't have a default, it's invalid
        if is_optional and not has_default:
            invalid_fields.append(_field_name)

    if invalid_fields:
        fields_str = ", ".join(invalid_fields)
        context_str = f" for {context_id}" if context_id else ""
        error_msg = (
            f"Invalid output_schema{context_str}: Optional fields must have "
            f"default values. Fields without defaults: {fields_str}. "
            f"Either add default values (e.g., Optional[str] = None) or "
            f"make them required (remove Optional)."
        )
        raise ValueError(error_msg)


def _validate_output_schema_v1(model_class: type[Any], context_id: str = "") -> None:
    """Validate that all optional fields have default values (Pydantic v1)."""
    if not hasattr(model_class, "__fields__"):
        return

    invalid_fields = []
    for _field_name, field_info in model_class.__fields__.items():
        # Check if field is Optional
        field_type = (
            field_info.outer_type_ if hasattr(field_info, "outer_type_") else field_info.type_
        )
        import types
        import typing

        is_optional = False
        if hasattr(typing, "get_origin"):
            origin = typing.get_origin(field_type)
            # Handle both typing.Union and types.UnionType (for Python 3.10+ syntax like int | None)
            if origin is typing.Union or origin is types.UnionType:
                args = typing.get_args(field_type)
                is_optional = type(None) in args
        elif hasattr(field_type, "__origin__") and field_type.__origin__ is typing.Union:
            args = field_type.__args__
            is_optional = type(None) in args

        # Check if field has a default value
        has_default = (
            field_info.default is not ...
            and field_info.default is not None
            or hasattr(field_info, "default_factory")
        )

        # If field is Optional but doesn't have a default, it's invalid
        if is_optional and not has_default:
            invalid_fields.append(_field_name)

    if invalid_fields:
        fields_str = ", ".join(invalid_fields)
        context_str = f" for {context_id}" if context_id else ""
        error_msg = (
            f"Invalid output_schema{context_str}: Optional fields must have "
            f"default values. Fields without defaults: {fields_str}. "
            f"Either add default values (e.g., Optional[str] = None) or "
            f"make them required (remove Optional)."
        )
        raise ValueError(error_msg)


def _ensure_additional_properties_false(schema: dict[str, Any]) -> None:
    """Recursively ensure all object schemas have additionalProperties: false."""
    if isinstance(schema, dict):
        # If this is an object type, ensure additionalProperties: false
        if schema.get("type") == "object":
            schema["additionalProperties"] = False
        # Recursively process properties
        if "properties" in schema:
            for prop_schema in schema["properties"].values():
                _ensure_additional_properties_false(prop_schema)
        # Recursively process items (for arrays)
        if "items" in schema:
            _ensure_additional_properties_false(schema["items"])
        # Recursively process anyOf, oneOf, allOf
        for key in ["anyOf", "oneOf", "allOf"]:
            if key in schema:
                for sub_schema in schema[key]:
                    _ensure_additional_properties_false(sub_schema)
        # Recursively process $defs (definitions) - Pydantic v2 uses this for nested models
        if "$defs" in schema:
            for _def_name, def_schema in schema["$defs"].items():
                _ensure_additional_properties_false(def_schema)
        # Recursively process definitions (Pydantic v1 uses this)
        if "definitions" in schema:
            for _def_name, def_schema in schema["definitions"].items():
                _ensure_additional_properties_false(def_schema)
        # Handle $ref references - we can't modify them directly, but we ensure
        # the referenced schema is processed
        # Note: $ref schemas should be in $defs or definitions, which we already process above


def _ensure_required_for_all_properties(schema: dict[str, Any]) -> None:
    """Recursively ensure all object schemas have all properties in required array."""
    if isinstance(schema, dict):
        # If this is an object type with properties, ensure all properties are in required
        if schema.get("type") == "object" and "properties" in schema:
            all_properties = set(schema["properties"].keys())
            current_required = set(schema.get("required", []))
            # Add any missing properties to required
            if all_properties != current_required:
                schema["required"] = list(all_properties)

        # Recursively process properties
        if "properties" in schema:
            for prop_schema in schema["properties"].values():
                _ensure_required_for_all_properties(prop_schema)
        # Recursively process items (for arrays)
        if "items" in schema:
            _ensure_required_for_all_properties(schema["items"])
        # Recursively process anyOf, oneOf, allOf
        for key in ["anyOf", "oneOf", "allOf"]:
            if key in schema:
                for sub_schema in schema[key]:
                    _ensure_required_for_all_properties(sub_schema)
        # Recursively process $defs (definitions) - Pydantic v2 uses this for nested models
        if "$defs" in schema:
            for _def_name, def_schema in schema["$defs"].items():
                _ensure_required_for_all_properties(def_schema)
        # Recursively process definitions (Pydantic v1 uses this)
        if "definitions" in schema:
            for _def_name, def_schema in schema["definitions"].items():
                _ensure_required_for_all_properties(def_schema)


def _inline_refs(schema: dict[str, Any]) -> None:
    """Inline $ref references by replacing them with the actual schema from $defs/definitions."""
    if not isinstance(schema, dict):
        return

    # Collect all definitions first
    defs = {}
    if "$defs" in schema:
        defs.update(schema["$defs"])
    if "definitions" in schema:
        defs.update(schema["definitions"])

    # Recursively inline refs in the schema
    _inline_refs_recursive(schema, defs)


def _inline_refs_recursive(obj: Any, defs: dict[str, Any]) -> None:
    """Recursively inline $ref references in a schema object."""
    if isinstance(obj, dict):
        # If this object has a $ref, inline it
        if "$ref" in obj:
            ref_path = obj["$ref"]
            # Parse $ref path (e.g., "#/$defs/PersonName" or "#/definitions/PersonName")
            if ref_path.startswith("#/$defs/") or ref_path.startswith("#/definitions/"):
                ref_name = ref_path.split("/")[-1]
                if ref_name in defs:
                    # Get the referenced schema
                    ref_schema = defs[ref_name]
                    # Deep copy the referenced schema
                    inlined = copy.deepcopy(ref_schema)
                    # Preserve any other keys from the original object (like description)
                    # But remove $ref since we're inlining
                    other_keys = {k: v for k, v in obj.items() if k != "$ref"}
                    # Merge: start with inlined schema, then add other keys
                    obj.clear()
                    obj.update(inlined)
                    # Merge other keys (description, etc.) - but be careful not to
                    # override schema properties
                    for key, value in other_keys.items():
                        if key not in obj or key in ["description", "title"]:
                            obj[key] = value
                    # Recursively process the inlined schema
                    _inline_refs_recursive(obj, defs)
            return

        # Recursively process all values
        for key, value in obj.items():
            if key not in ["$defs", "definitions"]:  # Skip definitions themselves
                _inline_refs_recursive(value, defs)
    elif isinstance(obj, list):
        for item in obj:
            _inline_refs_recursive(item, defs)
