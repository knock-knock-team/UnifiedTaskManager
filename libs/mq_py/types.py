from dataclasses import dataclass, field
from typing import Optional, Any


@dataclass
class PublishOptions:
    """Options for publishing messages to RabbitMQ."""
    content_type: Optional[str] = "application/json"
    content_encoding: Optional[str] = None
    message_type: Optional[str] = None
    correlation_id: Optional[str] = None
    reply_to: Optional[str] = None
    persistent: bool = False
    headers: dict[str, Any] = field(default_factory=dict)