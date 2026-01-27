"""Unit tests for polos.core.state module."""

import pytest

from polos.core.state import WorkflowState


class TestWorkflowState:
    """Tests for WorkflowState class."""

    def test_workflow_state_is_base_model(self):
        """Test that WorkflowState is a Pydantic BaseModel."""

        class MyState(WorkflowState):
            counter: int = 0

        state = MyState()
        assert state.counter == 0

    def test_workflow_state_with_fields(self):
        """Test WorkflowState with multiple fields."""

        class MyState(WorkflowState):
            counter: int = 0
            items: list[str] = []
            name: str = "default"

        state = MyState()
        assert state.counter == 0
        assert state.items == []
        assert state.name == "default"

    def test_workflow_state_validation(self):
        """Test that WorkflowState validates assignments."""

        class MyState(WorkflowState):
            counter: int = 0

        state = MyState()
        # Should allow valid assignment
        state.counter = 5
        assert state.counter == 5

        # Should validate type
        with pytest.raises((ValueError, TypeError)):  # Pydantic validation error
            state.counter = "not an int"  # type: ignore

    def test_workflow_state_initialization(self):
        """Test WorkflowState initialization with values."""

        class MyState(WorkflowState):
            counter: int = 0
            name: str = "default"

        state = MyState(counter=10, name="test")
        assert state.counter == 10
        assert state.name == "test"

    def test_workflow_state_inheritance(self):
        """Test that WorkflowState can be inherited and extended."""

        class BaseState(WorkflowState):
            base_field: str = "base"

        class ExtendedState(BaseState):
            extended_field: int = 0

        state = ExtendedState()
        assert state.base_field == "base"
        assert state.extended_field == 0
