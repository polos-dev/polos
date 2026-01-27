"""Unit tests for LLM utility functions."""

from polos.utils.agent import convert_input_to_messages


class TestConvertInputToMessages:
    """Tests for convert_input_to_messages function."""

    def test_convert_string_input(self):
        """Test converting string input to messages."""
        result = convert_input_to_messages("Hello, world")
        assert result == [{"role": "user", "content": "Hello, world"}]

    def test_convert_list_input(self):
        """Test converting list input to messages."""
        input_data = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]
        result = convert_input_to_messages(input_data)
        assert result == input_data

    def test_convert_with_system_prompt(self):
        """Test converting input with system prompt."""
        result = convert_input_to_messages("Hello", system_prompt="You are a helpful assistant")
        assert len(result) == 2
        assert result[0] == {"role": "system", "content": "You are a helpful assistant"}
        assert result[1] == {"role": "user", "content": "Hello"}

    def test_convert_list_with_system_prompt(self):
        """Test converting list input with system prompt."""
        input_data = [{"role": "user", "content": "Hello"}]
        result = convert_input_to_messages(input_data, system_prompt="You are a helpful assistant")
        assert len(result) == 2
        assert result[0] == {"role": "system", "content": "You are a helpful assistant"}
        assert result[1] == input_data[0]

    def test_convert_without_system_prompt(self):
        """Test converting input without system prompt."""
        result = convert_input_to_messages("Hello", system_prompt=None)
        assert result == [{"role": "user", "content": "Hello"}]

    def test_convert_empty_list(self):
        """Test converting empty list input."""
        result = convert_input_to_messages([])
        assert result == []

    def test_convert_empty_list_with_system_prompt(self):
        """Test converting empty list with system prompt."""
        result = convert_input_to_messages([], system_prompt="System prompt")
        assert result == [{"role": "system", "content": "System prompt"}]
