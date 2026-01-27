"""Unit tests for polos.utils.retry module."""

import asyncio

import pytest

from polos.utils.retry import retry_with_backoff


class TestRetryWithBackoff:
    """Tests for retry_with_backoff function."""

    @pytest.mark.asyncio
    async def test_success_on_first_attempt(self):
        """Test that function succeeds on first attempt."""
        call_count = 0

        async def success_func():
            nonlocal call_count
            call_count += 1
            return "success"

        result = await retry_with_backoff(success_func)
        assert result == "success"
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_success_after_retries(self):
        """Test that function succeeds after retries."""
        call_count = 0

        async def retry_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ValueError("Temporary error")
            return "success"

        result = await retry_with_backoff(retry_func, max_retries=3)
        assert result == "success"
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_exhausts_all_retries(self):
        """Test that function raises exception after exhausting retries."""
        call_count = 0

        async def failing_func():
            nonlocal call_count
            call_count += 1
            raise ValueError("Always fails")

        with pytest.raises(ValueError, match="Always fails"):
            await retry_with_backoff(failing_func, max_retries=2)

        assert call_count == 3  # Initial + 2 retries

    @pytest.mark.asyncio
    async def test_backoff_delay(self):
        """Test that backoff delay increases exponentially."""
        call_times = []

        async def failing_func():
            call_times.append(asyncio.get_event_loop().time())
            raise ValueError("Fails")

        with pytest.raises(ValueError):
            await retry_with_backoff(failing_func, max_retries=2, base_delay=0.1, max_delay=1.0)

        # Check that delays increase (allowing for some timing variance)
        assert len(call_times) == 3
        # Delays should be approximately 0.1s, 0.2s (with some tolerance)
        delay1 = call_times[1] - call_times[0]
        delay2 = call_times[2] - call_times[1]
        assert delay1 >= 0.05  # Allow some tolerance
        assert delay2 >= delay1  # Second delay should be >= first

    @pytest.mark.asyncio
    async def test_max_delay_respected(self):
        """Test that max_delay is respected."""
        call_times = []

        async def failing_func():
            call_times.append(asyncio.get_event_loop().time())
            raise ValueError("Fails")

        with pytest.raises(ValueError):
            await retry_with_backoff(failing_func, max_retries=5, base_delay=10.0, max_delay=0.5)

        # Check that delays don't exceed max_delay
        if len(call_times) > 1:
            delays = [call_times[i] - call_times[i - 1] for i in range(1, len(call_times))]
            # All delays should be <= max_delay (with some tolerance)
            for delay in delays:
                assert delay <= 0.6  # Allow some tolerance

    @pytest.mark.asyncio
    async def test_passes_arguments(self):
        """Test that function keyword arguments are passed correctly."""

        async def func_with_kwargs(arg1, arg2, kwarg1=None):
            return f"{arg1}-{arg2}-{kwarg1}"

        # Test that kwargs are passed through correctly
        # Note: We can't easily test *args because max_retries, base_delay, max_delay
        # are positional parameters before *args in the function signature
        result = await retry_with_backoff(
            func_with_kwargs,
            max_retries=0,
            arg1="value1",
            arg2="value2",
            kwarg1="kwvalue",
        )
        assert result == "value1-value2-kwvalue"

    @pytest.mark.asyncio
    async def test_exception_chaining(self):
        """Test that exception is chained correctly."""
        call_count = 0

        async def failing_func():
            nonlocal call_count
            call_count += 1
            raise ValueError("Original error")

        with pytest.raises(ValueError, match="Original error") as exc_info:
            await retry_with_backoff(failing_func, max_retries=0)

        # Exception should be chained with from None
        assert exc_info.value.__cause__ is None

    @pytest.mark.asyncio
    async def test_zero_retries(self):
        """Test with zero retries (only initial attempt)."""
        call_count = 0

        async def failing_func():
            nonlocal call_count
            call_count += 1
            raise ValueError("Fails")

        with pytest.raises(ValueError):
            await retry_with_backoff(failing_func, max_retries=0)

        assert call_count == 1
