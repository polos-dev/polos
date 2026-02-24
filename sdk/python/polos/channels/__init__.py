"""Channel abstraction for delivering notifications when agents suspend."""

from .channel import Channel, ChannelContext, ChannelOutputMode, SuspendNotification
from .slack import SlackChannel, SlackChannelConfig

__all__ = [
    "Channel",
    "ChannelContext",
    "ChannelOutputMode",
    "SuspendNotification",
    "SlackChannel",
    "SlackChannelConfig",
]
