"""Queue configuration for workflow concurrency control."""


class Queue:
    """Represents a named queue with concurrency limits.

    Queues control how many workflows can run concurrently. Each queue has:
    - A unique name
    - A concurrency limit (max concurrent executions)

    Workflows can be assigned to queues to control resource usage.
    """

    def __init__(self, name: str, concurrency_limit: int | None = None):
        """Create a queue.

        Args:
            name: Unique queue name
            concurrency_limit: Maximum concurrent executions (None = unlimited, uses env default)
        """
        self.name = name
        self.concurrency_limit = concurrency_limit

    def __repr__(self) -> str:
        return f"Queue(name='{self.name}', concurrency_limit={self.concurrency_limit})"


def queue(name: str, concurrency_limit: int | None = None) -> Queue:
    """Create a queue object.

    Example:
        my_queue = queue("my-queue", concurrency_limit=5)
        workflow1 = workflow(queue=my_queue)

    Args:
        name: Unique queue name
        concurrency_limit: Maximum concurrent executions (None = unlimited, uses env default)

    Returns:
        Queue object
    """
    return Queue(name, concurrency_limit)
