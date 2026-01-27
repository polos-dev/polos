"""Tool class and decorator for defining tools that can be called by LLM agents."""

import inspect
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Union

from pydantic import BaseModel

from ..core.context import WorkflowContext
from ..core.workflow import _WORKFLOW_REGISTRY, Workflow
from ..runtime.queue import Queue

if TYPE_CHECKING:
    from ..middleware.hook import Hook


class Tool(Workflow):
    """
    Base class for tools that can be called by LLM agents.

    Tools are workflows with additional metadata for LLM function calling.
    They can be:
    - Invoked via .invoke() without waiting for completion -
      This is the recommended way to invoke the tool.
    - Executed directly via .run(): This is a convenience method to invoke
      the tool and wait for completion.
    - Used in Agent tool lists

    Subclass this to create built-in tools like CodeInterpreter, BrowserTool, etc.
    """

    def __init__(
        self,
        id: str,
        description: str | None = None,
        parameters: dict[str, Any] | None = None,
        func: Callable | None = None,
        queue: str | Queue | dict[str, Any] | None = None,
        on_start: Union[str, list[str], "Hook", list["Hook"]] | None = None,
        on_end: Union[str, list[str], "Hook", list["Hook"]] | None = None,
        **kwargs,
    ):
        """
        Initialize a tool.

        Args:
            id: Unique tool identifier
            description: Description for LLM (what this tool does)
            parameters: JSON schema for tool parameters
            func: Optional function to execute (for simple tools)
            queue: Optional queue configuration
            on_start: Optional lifecycle hook(s) to run before tool execution
            on_end: Optional lifecycle hook(s) to run after tool execution
            **kwargs: Additional workflow configuration
        """
        # Parse queue configuration
        queue_name = self._parse_queue_name(queue)
        queue_concurrency_limit = self._parse_queue_concurrency(queue)

        # Initialize as Workflow
        super().__init__(
            id=id,
            func=func or self._default_execute,
            workflow_type="tool",
            queue_name=queue_name,
            queue_concurrency_limit=queue_concurrency_limit,
            on_start=on_start,
            on_end=on_end,
        )

        # Register tool in global registry (so it can be found by agents)
        _WORKFLOW_REGISTRY[id] = self

        # Tool-specific metadata for LLM function calling
        self._tool_description = description or self.__doc__ or ""
        # If parameters not provided, use empty schema (subclasses should provide explicitly)
        if parameters is None:
            parameters = {"type": "object", "properties": {}}
        self._tool_parameters = parameters
        # Store input schema class for validation (set by decorator)
        self._input_schema_class: type[BaseModel] | None = None

    def _default_execute(self, ctx: WorkflowContext, payload: BaseModel | None):
        """
        Default execution function - subclasses should override.
        This is called when the tool is triggered as a workflow.
        """
        raise NotImplementedError(f"Tool {self.id} must implement _default_execute or provide func")

    async def run(
        self,
        payload: BaseModel | dict[str, Any] | None = None,
        queue: str | None = None,
        concurrency_key: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        timeout: float | None = 600.0,
    ) -> Any:
        """
        Run tool and return final result (wait for completion).

        This method cannot be called from within an execution context
        (e.g., from within a workflow).
        Use step.invoke_and_wait() to call tools from within workflows.

        Args:
            payload: Tool payload - Pydantic BaseModel instance if tool has
                input schema, dict, or None
            queue: Optional queue name (overrides tool-level queue)
            concurrency_key: Optional concurrency key for per-tenant queuing
            session_id: Optional session ID
            user_id: Optional user ID
            timeout: Optional timeout in seconds (default: 600 seconds / 10 minutes)

        Returns:
            Result from tool execution

        Raises:
            WorkflowTimeoutError: If the execution exceeds the timeout

        Example:
            result = await my_tool.run(MyInputModel(param="value"))
        """
        # Handle Pydantic payload conversion if tool has input schema
        prepared_payload = payload
        if self._input_schema_class is not None:
            if payload is None:
                raise ValueError(f"Tool '{self.id}' requires input schema but payload is None")
            # If payload is a Pydantic model, validate it's the correct type and convert to dict
            if isinstance(payload, BaseModel):
                if not isinstance(payload, self._input_schema_class):
                    raise ValueError(
                        f"Tool '{self.id}' expects payload of type "
                        f"{self._input_schema_class.__name__}, "
                        f"got {type(payload).__name__}"
                    )
                # Convert to dict for invoke
                prepared_payload = payload.model_dump()
            elif isinstance(payload, dict):
                # Validate dict against Pydantic model
                try:
                    validated_model = self._input_schema_class.model_validate(payload)
                    prepared_payload = validated_model.model_dump()
                except Exception as e:
                    raise ValueError(f"Invalid payload for tool '{self.id}': {e}") from e
            else:
                raise ValueError(
                    f"Tool '{self.id}' expects payload of type "
                    f"{self._input_schema_class.__name__} or dict, "
                    f"got {type(payload).__name__}"
                )
        else:
            # No input schema - payload should be None
            if payload is not None:
                raise ValueError(
                    f"Tool '{self.id}' does not accept a payload, but got {type(payload).__name__}"
                )
            prepared_payload = None

        # Call parent run() method
        return await super().run(
            payload=prepared_payload,
            queue=queue,
            concurrency_key=concurrency_key,
            session_id=session_id,
            user_id=user_id,
            timeout=timeout,
        )

    def get_tool_type(self) -> str:
        """
        Get the tool type identifier.

        Returns:
            Tool type string (e.g., "default", "browser_tool")
            Default implementation returns "default".
        """
        return "default"

    def get_tool_metadata(self) -> dict[str, Any] | None:
        """
        Get tool metadata (constructor properties and configuration).

        Returns:
            Dictionary containing tool-specific metadata, or None if no metadata.
            Default implementation returns None.
            Subclasses should override to return their constructor properties.
        """
        return None

    def to_llm_tool_definition(self) -> dict[str, Any]:
        """
        Convert tool to LLM function calling format.

        Returns format compatible with OpenAI/Anthropic function calling:
        {
            "type": "function",
            "function": {
                "name": "tool_id",
                "description": "...",
                "parameters": {...}
            }
        }
        """
        return {
            "type": "function",
            "function": {
                "name": self.id,
                "description": self._tool_description,
                "parameters": self._tool_parameters,
            },
        }

    @staticmethod
    def _parse_queue_name(queue: Any) -> str | None:
        """Extract queue name from queue configuration."""
        if queue is None:
            return None
        if isinstance(queue, str):
            return queue
        if isinstance(queue, dict):
            return queue.get("name")
        if hasattr(queue, "name"):
            return queue.name
        return None

    @staticmethod
    def _parse_queue_concurrency(queue: Any) -> int | None:
        """Extract concurrency limit from queue configuration."""
        if queue is None:
            return None
        if isinstance(queue, dict):
            return queue.get("concurrency_limit")
        if hasattr(queue, "concurrency_limit"):
            return queue.concurrency_limit
        return None


def tool(
    id: str | None = None,
    description: str | None = None,
    parameters: dict[str, Any] | None = None,
    queue: str | Queue | dict[str, Any] | None = None,
    on_start: Union[str, list[str], "Workflow", list["Workflow"]] | None = None,
    on_end: Union[str, list[str], "Workflow", list["Workflow"]] | None = None,
    **kwargs,
):
    """
    Decorator to mark a function as a tool callable by LLM agents.

    Creates a simple Tool instance from a function.
    For complex tools (CodeInterpreter, BrowserTool), use classes instead.

    Args:
        id: Optional tool ID (defaults to function name)
        description: Optional tool description (for LLM)
        parameters: Optional parameter schema (auto-inferred if not provided)
        queue: Optional queue configuration
        on_start: Optional lifecycle hook(s) to run before tool execution
        on_end: Optional lifecycle hook(s) to run after tool execution
        **kwargs: Additional workflow configuration

    Example:
        @tool(description="Search the knowledge base")
        async def search_kb(query: str) -> dict:
            results = await db.search(query)
            return {"results": results}

        # Use in agent
        agent = Agent(tools=[search_kb])
    """

    def decorator(func: Callable) -> Tool:
        tool_id = id or func.__name__

        # Validate function signature
        input_schema_class, return_type = _validate_tool_signature(func)

        # Capture parameters from outer scope and infer if needed
        tool_parameters = parameters
        if tool_parameters is None:
            if input_schema_class is not None:
                # Extract schema from Pydantic model
                tool_parameters = input_schema_class.model_json_schema()
            else:
                # No input schema - empty schema
                tool_parameters = {"type": "object", "properties": {}}

        # Wrap function to work as workflow function
        wrapped_func = _wrap_function_for_tool(func, input_schema_class)

        # Create Tool instance from function
        tool_obj = Tool(
            id=tool_id,
            description=description or func.__doc__ or "",
            parameters=tool_parameters,
            func=wrapped_func,
            queue=queue,
            on_start=on_start,
            on_end=on_end,
            **kwargs,
        )

        # Store input schema class for validation (used by inherited run() method)
        tool_obj._input_schema_class = input_schema_class

        # Register the tool
        _WORKFLOW_REGISTRY[tool_id] = tool_obj
        return tool_obj

    # Handle both @tool and @tool(...) syntax
    if id is not None and callable(id):
        # Called as @tool without parentheses
        func = id
        tool_id = func.__name__

        # Validate function signature
        input_schema_class, return_type = _validate_tool_signature(func)

        # Capture parameters from outer scope and infer if needed
        tool_parameters = parameters
        if tool_parameters is None:
            if input_schema_class is not None:
                # Extract schema from Pydantic model
                tool_parameters = input_schema_class.model_json_schema()
            else:
                # No input schema - empty schema
                tool_parameters = {"type": "object", "properties": {}}

        wrapped_func = _wrap_function_for_tool(func, input_schema_class)

        tool_obj = Tool(
            id=tool_id,
            description=description or func.__doc__ or "",
            parameters=tool_parameters,
            func=wrapped_func,
            queue=queue,
            **kwargs,
        )

        # Store input schema class for validation (used by inherited run() method)
        tool_obj._input_schema_class = input_schema_class

        # Register the tool
        _WORKFLOW_REGISTRY[tool_id] = tool_obj
        return tool_obj

    return decorator


def is_json_serializable(annotation: Any) -> bool:
    """
    Check if a type annotation represents a JSON-serializable type.

    Args:
        annotation: Type annotation to check

    Returns:
        True if the type is JSON serializable, False otherwise
    """
    json_serializable_types = (str, int, float, bool, type(None), dict, list)
    return annotation in json_serializable_types


def _validate_tool_signature(func: Callable) -> tuple[type[BaseModel] | None, Any | None]:
    """
    Validate tool function signature and return input schema class and return type.

    Args:
        func: Function to validate

    Returns:
        Tuple of (input_schema_class, return_type):
        - input_schema_class: Pydantic BaseModel class if second parameter exists, None otherwise
        - return_type: Return type annotation if exists, None otherwise

    Raises:
        TypeError: If signature is invalid
    """
    sig = inspect.signature(func)
    params = list(sig.parameters.values())

    # Tool function must have at least 1 parameter (WorkflowContext)
    if len(params) < 1:
        raise TypeError(
            f"Tool function '{func.__name__}' must have at least 1 parameter: "
            f"(ctx: WorkflowContext) or (ctx: WorkflowContext, input: BaseModel)"
        )

    # Tool function must have at most 2 parameters
    if len(params) > 2:
        raise TypeError(
            f"Tool function '{func.__name__}' must have at most 2 parameters: "
            f"(ctx: WorkflowContext) or (ctx: WorkflowContext, input: BaseModel)"
        )

    # Check first parameter (context)
    first_param = params[0]
    first_annotation = first_param.annotation

    # Allow untyped parameters or anything that ends with WorkflowContext
    first_type_valid = False
    if first_annotation == inspect.Parameter.empty:
        # Untyped is allowed
        first_type_valid = True
    elif isinstance(first_annotation, str):
        # String annotation - check if it ends with WorkflowContext
        if first_annotation.endswith("WorkflowContext") or "WorkflowContext" in first_annotation:
            first_type_valid = True
    else:
        # Type annotation - check if class name ends with WorkflowContext
        try:
            # Get the class name
            type_name = getattr(first_annotation, "__name__", None) or str(first_annotation)
            if type_name.endswith("WorkflowContext") or "WorkflowContext" in type_name:
                first_type_valid = True
            # Also check if it's the actual WorkflowContext class
            from ..core.context import WorkflowContext

            if first_annotation is WorkflowContext or first_annotation == WorkflowContext:
                first_type_valid = True
            elif hasattr(first_annotation, "__origin__"):
                args = getattr(first_annotation, "__args__", ())
                if WorkflowContext in args:
                    first_type_valid = True
        except (ImportError, AttributeError):
            # If we can't check, allow it if the name suggests it's WorkflowContext
            type_name = getattr(first_annotation, "__name__", None) or str(first_annotation)
            if "WorkflowContext" in type_name:
                first_type_valid = True

    if not first_type_valid:
        raise TypeError(
            f"Tool function '{func.__name__}': first parameter "
            f"'{first_param.name}' must be typed as WorkflowContext "
            f"(or untyped), got {first_annotation}"
        )

    # Check second parameter (input schema) if it exists
    input_schema_class = None
    if len(params) >= 2:
        second_param = params[1]
        second_annotation = second_param.annotation
        if second_annotation == inspect.Parameter.empty:
            raise TypeError(
                f"Tool function '{func.__name__}': second parameter "
                f"'{second_param.name}' must be typed as a Pydantic BaseModel class"
            )

        # Check if second parameter is a Pydantic BaseModel
        second_type_valid = False
        if inspect.isclass(second_annotation) and issubclass(second_annotation, BaseModel):
            second_type_valid = True
            input_schema_class = second_annotation

        if not second_type_valid:
            raise TypeError(
                f"Tool function '{func.__name__}': second parameter "
                f"'{second_param.name}' must be typed as a Pydantic BaseModel "
                f"class, got {second_annotation}"
            )

    # Validate return type if specified
    return_type = sig.return_annotation
    if return_type != inspect.Signature.empty and return_type is not None:
        # Check if return type is valid (Pydantic BaseModel or JSON serializable)
        return_type_valid = False

        # Check if it's a Pydantic BaseModel
        if (
            inspect.isclass(return_type)
            and issubclass(return_type, BaseModel)
            or is_json_serializable(return_type)
        ):
            return_type_valid = True
        # Check if it's a Union/Optional with JSON serializable types or Pydantic models
        elif hasattr(return_type, "__origin__"):
            origin = return_type.__origin__
            args = getattr(return_type, "__args__", ())
            # Check for Union/Optional
            if origin is Union:
                return_type_valid = all(
                    (inspect.isclass(arg) and issubclass(arg, BaseModel))
                    or arg is type(None)
                    or is_json_serializable(arg)
                    for arg in args
                )
            # Check for Dict[str, Any] or List[str] etc.
            elif origin in (dict, list):
                # Allow Dict and List with any args (runtime will validate)
                return_type_valid = True
        # Check if it's a string annotation (forward reference)
        elif isinstance(return_type, str) and any(
            keyword in return_type
            for keyword in [
                "dict",
                "Dict",
                "list",
                "List",
                "str",
                "int",
                "float",
                "bool",
                "None",
            ]
        ):
            return_type_valid = True

        if not return_type_valid:
            raise TypeError(
                f"Tool function '{func.__name__}': return type must be a "
                f"Pydantic BaseModel or JSON serializable type, "
                f"got {return_type}"
            )

    return input_schema_class, return_type if return_type != inspect.Signature.empty else None


def _wrap_function_for_tool(
    func: Callable, input_schema_class: type[BaseModel] | None = None
) -> Callable:
    """Wrap user function to work as workflow function.

    Tool functions must have one of these signatures:
    - (ctx: WorkflowContext) -> no input schema
    - (ctx: WorkflowContext, input: BaseModel) -> Pydantic input schema

    The wrapper receives payload as a dict (from workflow execution system) and converts it
    to a Pydantic model instance if input_schema_class is provided.
    """
    sig = inspect.signature(func)
    params = list(sig.parameters.values())

    # Tool function must have WorkflowContext as first param (already validated in decorator)
    # Check if there's a second parameter (input schema)
    has_input_schema = len(params) >= 2

    async def wrapper(ctx: WorkflowContext, payload: dict[str, Any] | None):
        # Build arguments
        args = [ctx]

        if has_input_schema:
            # Convert dict payload to Pydantic model instance if input_schema_class is provided
            if input_schema_class is not None:
                if payload is None:
                    raise ValueError(
                        f"Tool function '{func.__name__}' requires input schema but payload is None"
                    )
                try:
                    # Payload comes as a dict from workflow execution system
                    # Convert it to the Pydantic model instance
                    if isinstance(payload, dict):
                        input_instance = input_schema_class.model_validate(payload)
                    elif isinstance(payload, input_schema_class):
                        # Already the correct type (shouldn't happen, but handle it)
                        input_instance = payload
                    elif isinstance(payload, BaseModel):
                        # Different Pydantic model - convert to dict and validate
                        input_instance = input_schema_class.model_validate(payload.model_dump())
                    else:
                        raise ValueError(
                            f"Payload must be a dict or Pydantic BaseModel "
                            f"instance, got {type(payload)}"
                        )
                    args.append(input_instance)
                except Exception as e:
                    raise ValueError(
                        f"Invalid payload for tool '{func.__name__}': {e}. Payload: {payload}"
                    ) from e
            else:
                # Should not happen - has_input_schema but no input_schema_class
                raise ValueError(
                    f"Tool function '{func.__name__}' expects input schema but none provided"
                )

        # Call original function with appropriate arguments
        if inspect.iscoroutinefunction(func):
            return await func(*args)
        else:
            return func(*args)

    return wrapper
