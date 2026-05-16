from typing import Any


class MqError(Exception):
    """Base exception for MQ operations."""
    
    @classmethod
    def from_exception(cls, exc: Exception, context: str = "") -> "MqError":
        return cls(f"{context}: {exc}" if context else str(exc))


class MqConnectionError(MqError):
    """Raised when connection to RabbitMQ fails."""
    pass


class MqTimeoutError(MqError):
    """Raised when RPC request times out."""
    pass


class MqSerializationError(MqError):
    """Raised when JSON serialization/deserialization fails."""
    pass


class MqPublishError(MqError):
    """Raised when message publishing fails."""
    pass