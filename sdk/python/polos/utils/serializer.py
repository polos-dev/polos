"""JSON serialization utilities for handling non-serializable types."""

import json
from typing import Any

from pydantic import BaseModel

from ..types.types import AgentResult


def is_json_serializable(obj: Any) -> bool:
    """Check if an object is JSON serializable by attempting json.dumps.

    Args:
        obj: Object to check

    Returns:
        True if the object is JSON serializable, False otherwise
    """
    try:
        json.dumps(obj)
        return True
    except (TypeError, ValueError):
        return False


def serialize(obj: Any) -> Any:
    """Serialize an object to a JSON-serializable object.

    If the input is a Pydantic BaseModel, uses model_dump(mode="json") to serialize it to a dict.
    Otherwise, checks if it's JSON serializable via json.dumps and raises TypeError if not.

    Args:
        obj: Object to serialize

    Returns:
        JSON-serializable value (dict, list, str, int, float, bool, None)

    Raises:
        TypeError: If the object is not a Pydantic model and not JSON serializable
    """
    # Handle Pydantic models
    if isinstance(obj, BaseModel):
        return obj.model_dump(mode="json")

    # Check if it's JSON serializable
    if not is_json_serializable(obj):
        raise TypeError(
            f"Object of type {type(obj).__name__} is not JSON serializable. "
            f"If it's a Pydantic model, ensure it inherits from BaseModel."
        )

    return obj


def json_serialize(obj: Any) -> str:
    """Serialize an object to a JSON string.

    If the input is a Pydantic BaseModel, uses model_dump_json() to serialize it to a JSON string.
    Otherwise, uses json.dumps and raises TypeError if not.

    Args:
        obj: Object to serialize

    Returns:
        JSON string

    Raises:
        TypeError: If the object is not a Pydantic model and not JSON serializable
    """
    # Handle Pydantic models
    if isinstance(obj, BaseModel):
        return obj.model_dump_json()

    # Check if it's JSON serializable
    try:
        return json.dumps(obj)
    except (TypeError, ValueError) as e:
        raise TypeError(
            f"Object of type {type(obj).__name__} is not JSON serializable. "
            f"If it's a Pydantic model, ensure it inherits from BaseModel."
        ) from e


async def deserialize(obj: Any, output_schema_name: str | None = None) -> Any:
    """Deserialize an object from a JSON string.

    Args:
        obj: Object to deserialize
        output_schema_name: The name of the output schema (can be
            "list[module.ClassName]" for lists)

    Returns:
        Deserialized object
    """
    # Handle list of Pydantic models (schema format: "list[module.ClassName]")
    if output_schema_name and output_schema_name.startswith("list[") and isinstance(obj, list):
        try:
            # Extract the inner class name from "list[module.ClassName]"
            inner_schema = output_schema_name[5:-1]  # Remove "list[" and "]"
            module_path, class_name = inner_schema.rsplit(".", 1)
            module = __import__(module_path, fromlist=[class_name])
            model_class = getattr(module, class_name)

            # Validate each item in the list back to the Pydantic model
            if issubclass(model_class, BaseModel):
                obj = [model_class.model_validate(item) for item in obj]
        except (ImportError, AttributeError, ValueError, TypeError) as e:
            raise Exception(
                f"Failed to reconstruct Pydantic model list from output_schema_name: "
                f"{output_schema_name}. Error: {str(e)}"
            ) from e
        return obj

    # If output_schema_name is present, try to reconstruct the Pydantic model
    if output_schema_name and isinstance(obj, dict):
        try:
            # Dynamically import the Pydantic class
            module_path, class_name = output_schema_name.rsplit(".", 1)
            module = __import__(module_path, fromlist=[class_name])
            model_class = getattr(module, class_name)

            # Validate the dict back to the Pydantic model
            if issubclass(model_class, BaseModel):
                obj = model_class.model_validate(obj)
        except (ImportError, AttributeError, ValueError, TypeError) as e:
            raise Exception(
                f"Failed to reconstruct Pydantic model from output_schema_name: "
                f"{output_schema_name}. Error: {str(e)}"
            ) from e
    return obj


async def deserialize_agent_result(result: AgentResult) -> AgentResult:
    """Deserialize an agent result to a Pydantic model."""

    # Convert result to structured output schema
    if result.result_schema and result.result is not None:
        result.result = await _deserialize_agent_result_schema(result.result, result.result_schema)

    # Convert tool results to structured output schema
    for tool_result in result.tool_results:
        if tool_result.result_schema and tool_result.result is not None:
            tool_result.result = await _deserialize_agent_result_schema(
                tool_result.result, tool_result.result_schema
            )

    return result


async def _deserialize_agent_result_schema(result, schema: str):
    try:
        # Dynamically import the Pydantic class
        module_path, class_name = schema.rsplit(".", 1)
        module = __import__(module_path, fromlist=[class_name])
        model_class = getattr(module, class_name)

        # Validate that it's a Pydantic BaseModel
        if issubclass(model_class, BaseModel):
            if isinstance(result, str):
                return model_class.model_validate_json(result)
            elif isinstance(result, dict):
                return model_class.model_validate(result)
            else:
                return result
    except (ImportError, AttributeError, ValueError, TypeError) as e:
        # If reconstruction fails, log warning but return dict
        # This allows backward compatibility if the class is not available
        import warnings

        warnings.warn(
            f"Failed to reconstruct Pydantic model '{schema}': {e}. Returning dict instead.",
            UserWarning,
            stacklevel=2,
        )
    return result


def safe_serialize(value):
    """Serialize with fallback for non-serializable values."""
    try:
        return serialize(value)
    except (TypeError, ValueError):
        # Fallback representations
        if hasattr(value, "__name__"):
            return f"<{value.__name__}>"
        return f"<{type(value).__name__}>"
