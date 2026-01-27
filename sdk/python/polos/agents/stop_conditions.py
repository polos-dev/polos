"""Stop conditions for agents.

Stop conditions allow you to define when an agent should stop executing.
Stop conditions execute durably within workflow context using step.run().
"""

import logging
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from ..types.types import Step

logger = logging.getLogger(__name__)


class StopConditionContext(BaseModel):
    """Context available to stop conditions.

    This context is passed to stop conditions and contains information about
    the current execution state.
    """

    # Steps executed so far
    steps: list[Step] = []

    # Optional agent context
    agent_id: str | None = None
    agent_run_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert stop condition context to dictionary for serialization."""
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: Any) -> "StopConditionContext":
        """Create StopConditionContext from dictionary."""
        if isinstance(data, StopConditionContext):
            return data
        if isinstance(data, dict):
            return cls.model_validate(data)
        raise TypeError(f"Cannot create StopConditionContext from {type(data)}")


def stop_condition(fn: Callable) -> Callable:
    """
    Decorator for stop condition functions.

    Stop conditions take `ctx: StopConditionContext` as the first parameter
    and optionally a second parameter (config class instance) for configuration.
    They return a boolean (True to stop, False to continue).

    When called with config params, they return a configured callable that will
    be called later by the executor with StopConditionContext.

    Usage:
        # Simple stop condition (no config)
        @stop_condition
        async def always_stop(ctx: StopConditionContext) -> bool:
            return True

        # Stop condition with config
        class MaxTokensConfig(BaseModel):
            limit: int

        @stop_condition
        async def max_tokens(ctx: StopConditionContext, config: MaxTokensConfig) -> bool:
            total = sum(step.usage.total_tokens if step.usage else 0 for step in ctx.steps)
            return total >= config.limit

        # Configure with limit
        agent = Agent(..., stop_conditions=[max_tokens(MaxTokensConfig(limit=1000))])
    """
    import functools
    import inspect

    sig = inspect.signature(fn)
    params = list(sig.parameters.values())

    # Validate signature: first parameter must be StopConditionContext
    if not params or params[0].annotation != StopConditionContext:
        raise TypeError(
            f"Invalid stop_condition function '{fn.__name__}': "
            f"first parameter must be typed as 'StopConditionContext'. "
            f"Got {params[0].annotation if params else 'no parameters'}."
        )

    # Check if there's a second parameter (for config) - it's optional
    config_class = None
    has_config = len(params) >= 2 and params[1].annotation != inspect.Signature.empty
    if has_config:
        config_class = params[1].annotation

        # Validate that it's a Pydantic BaseModel
        if not issubclass(config_class, BaseModel):
            raise TypeError(
                f"Invalid stop_condition function '{fn.__name__}': "
                f"second parameter must be a Pydantic BaseModel class, got {config_class}."
            )

    # Check return type annotation (should be bool)
    return_annotation = sig.return_annotation
    if return_annotation != inspect.Signature.empty and return_annotation not in (bool, "bool"):
        import asyncio
        from typing import get_args

        # Check for Coroutine[Any, Any, bool]
        is_async_bool = False
        if hasattr(return_annotation, "__origin__"):
            origin = return_annotation.__origin__
            if origin is asyncio.Coroutine:
                args = get_args(return_annotation)
                if len(args) >= 3 and args[2] is bool:
                    is_async_bool = True
        if not is_async_bool:
            logger.warning(
                "stop_condition '%s' should return bool or Coroutine[..., bool], got %s",
                fn.__name__,
                return_annotation,
            )

    # Check if function is async
    import asyncio

    is_async = asyncio.iscoroutinefunction(fn)

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        """
        Wrapper that returns a configured callable when called with config params.
        The configured callable will be called later by the executor with StopConditionContext.
        """
        if has_config:
            # Function requires config, so when called with args/kwargs, return configured callable
            # Create config instance from captured args/kwargs
            if args and len(args) == 1 and isinstance(args[0], config_class):
                # Already an instance of config_class
                config = args[0]
            elif args and len(args) == 1 and isinstance(args[0], dict):
                # Dict provided, use Pydantic's model_validate
                config = config_class.model_validate(args[0])
            elif kwargs:
                # Keyword arguments provided, Pydantic constructor handles this
                config = config_class(**kwargs)
            elif args:
                # Positional arguments provided, Pydantic constructor handles this
                config = config_class(*args)
            else:
                raise ValueError(
                    f"stop_condition '{fn.__name__}' requires config but none provided"
                )

            # Create configured callable that captures config
            # Preserve async/sync behavior of original function
            if is_async:

                async def configured_callable(ctx: StopConditionContext) -> bool:
                    """Async configured callable that executes the original function
                    with captured config."""
                    return await fn(ctx, config)
            else:

                def configured_callable(ctx: StopConditionContext) -> bool:
                    """Sync configured callable that executes the original function
                    with captured config."""
                    return fn(ctx, config)

            # Add metadata for identification
            configured_callable.__stop_condition_fn__ = fn
            configured_callable.__stop_condition_name__ = fn.__name__
            configured_callable.__stop_condition_config__ = config

            return configured_callable
        else:
            # No config needed - the function itself can be called with ctx
            # step.run() will handle it correctly
            return fn

    # Add metadata for identification
    wrapper.__stop_condition_fn__ = fn
    wrapper.__stop_condition_name__ = fn.__name__
    wrapper.__stop_condition_has_config__ = has_config
    wrapper.__stop_condition_config_class__ = config_class

    return wrapper


# Built-in stop condition functions
class MaxTokensConfig(BaseModel):
    """Configuration for max_tokens stop condition."""

    limit: int


@stop_condition
async def max_tokens(ctx: StopConditionContext, config: MaxTokensConfig) -> bool:
    """
    Stop when total tokens exceed limit.

    Usage:
        agent = Agent(..., stop_conditions=[max_tokens(MaxTokensConfig(limit=1000))])
    """
    total = 0
    for step in ctx.steps:
        if step.usage:
            total += step.usage.total_tokens
    return total >= config.limit


class MaxStepsConfig(BaseModel):
    """Configuration for max_steps stop condition."""

    count: int = 5


@stop_condition
def max_steps(ctx: StopConditionContext, config: MaxStepsConfig) -> bool:
    """
    Stop when number of steps reaches count.

    Usage:
        agent = Agent(..., stop_conditions=[max_steps()])  # Uses default count=5
        agent = Agent(..., stop_conditions=[max_steps(MaxStepsConfig(count=10))])  # Custom count
    """
    return len(ctx.steps) >= config.count


class ExecutedToolConfig(BaseModel):
    """Configuration for executed_tool stop condition."""

    tool_names: list[str]


@stop_condition
def executed_tool(ctx: StopConditionContext, config: ExecutedToolConfig) -> bool:
    """
    Stop when all specified tools have been executed.

    Usage:
        agent = Agent(..., stop_conditions=[
            executed_tool(ExecutedToolConfig(tool_names=["get_weather", "search"]))
        ])
    """
    required = set(config.tool_names)
    if not required:
        return False

    executed = set()
    for step in ctx.steps:
        for tool_call in step.tool_calls:
            executed.add(tool_call.function.name)
    return required.issubset(executed)


class HasTextConfig(BaseModel):
    """Configuration for has_text stop condition."""

    texts: list[str]


@stop_condition
def has_text(ctx: StopConditionContext, config: HasTextConfig) -> bool:
    """
    Stop when all specified texts are found in response.

    Usage:
        agent = Agent(..., stop_conditions=[has_text(HasTextConfig(texts=["done", "complete"]))])
    """
    if not config.texts:
        return False

    # Concatenate all content strings from steps
    combined = []
    for step in ctx.steps:
        if step.content:
            combined.append(step.content)
    full_text = " ".join(combined)

    return all(t in full_text for t in config.texts)
