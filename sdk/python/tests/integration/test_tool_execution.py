"""Integration tests for tool execution."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from polos import WorkflowContext, tool
from polos.core.workflow import _execution_context


class TestToolExecution:
    """Integration tests for tool execution."""

    @pytest.mark.asyncio
    async def test_tool_execution(self):
        """Test tool execution."""
        from pydantic import BaseModel

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        class AddInput(BaseModel):
            a: int
            b: int

        @tool
        def add_numbers(ctx: WorkflowContext, input: AddInput) -> int:
            """Add two numbers together."""
            return input.a + input.b

        with (
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
        ):
            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                ctx = WorkflowContext(
                    workflow_id="test-tool",
                    execution_id=execution_id,
                    root_execution_id=root_execution_id,
                    deployment_id="test-deployment",
                    session_id="test-session",
                )

                result = await add_numbers.func(ctx, AddInput(a=5, b=3))

                assert result == 8
            finally:
                _execution_context.set(None)

    @pytest.mark.asyncio
    async def test_tool_with_complex_types(self):
        """Test tool execution with complex types."""
        from pydantic import BaseModel

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        class PersonInput(BaseModel):
            name: str
            age: int

        class Person(BaseModel):
            name: str
            age: int

        @tool
        def create_person(ctx: WorkflowContext, input: PersonInput) -> Person:
            """Create a person."""
            return Person(name=input.name, age=input.age)

        with (
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
        ):
            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                ctx = WorkflowContext(
                    workflow_id="test-tool",
                    execution_id=execution_id,
                    root_execution_id=root_execution_id,
                    deployment_id="test-deployment",
                    session_id="test-session",
                )

                result = await create_person.func(ctx, PersonInput(name="Alice", age=30))

                assert isinstance(result, Person)
                assert result.name == "Alice"
                assert result.age == 30
            finally:
                _execution_context.set(None)

    @pytest.mark.asyncio
    async def test_tool_class_execution(self):
        """Test Tool class execution via func directly."""
        from pydantic import BaseModel

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        class MultiplyInput(BaseModel):
            a: int
            b: int

        # Create tool using the decorator
        @tool(description="Multiply two numbers")
        def multiply_tool(ctx: WorkflowContext, input: MultiplyInput) -> int:
            """Multiply two numbers."""
            return input.a * input.b

        with (
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
        ):
            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                ctx = WorkflowContext(
                    workflow_id="test-tool",
                    execution_id=execution_id,
                    root_execution_id=root_execution_id,
                    deployment_id="test-deployment",
                    session_id="test-session",
                )

                # Call the tool's func directly (as it would be called in a workflow)
                result = await multiply_tool.func(ctx, MultiplyInput(a=4, b=5))

                assert result == 20
            finally:
                _execution_context.set(None)

    @pytest.mark.asyncio
    async def test_tool_error_handling(self):
        """Test tool error handling."""
        from pydantic import BaseModel

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        class ValueInput(BaseModel):
            value: int

        @tool
        def failing_tool(ctx: WorkflowContext, input: ValueInput) -> int:
            """Tool that raises an error."""
            if input.value < 0:
                raise ValueError("Value must be positive")
            return input.value * 2

        with (
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
            patch(
                "polos.runtime.client._get_headers",
                return_value={"Authorization": "Bearer test-key"},
            ),
            patch(
                "polos.features.events._get_headers",
                return_value={"Authorization": "Bearer test-key"},
            ),
        ):
            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                ctx = WorkflowContext(
                    workflow_id="test-tool",
                    execution_id=execution_id,
                    root_execution_id=root_execution_id,
                    deployment_id="test-deployment",
                    session_id="test-session",
                )

                # Test error case
                with pytest.raises(ValueError, match="Value must be positive"):
                    await failing_tool.func(ctx, ValueInput(value=-1))

                # Test success case
                result = await failing_tool.func(ctx, ValueInput(value=5))
                assert result == 10
            finally:
                _execution_context.set(None)
