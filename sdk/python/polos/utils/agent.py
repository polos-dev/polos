from typing import Any


def convert_input_to_messages(
    input_data: str | list[dict[str, Any]], system_prompt: str | None = None
) -> list[dict[str, Any]]:
    """
    Convert input to messages format.

    Args:
        input_data: String or array of input items
        system_prompt: Optional system prompt

    Returns:
        List of message dicts
    """
    messages = []

    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    if isinstance(input_data, str):
        messages.append({"role": "user", "content": input_data})
    elif isinstance(input_data, list):
        messages.extend(input_data)

    return messages
