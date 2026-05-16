import logging
import sys
import os

from pythonjsonlogger import jsonlogger
from rich.logging import RichHandler


class LoggerFactory:
    _loggers = {}

    @classmethod
    def get_logger(cls, name: str, level: int = logging.INFO) -> logging.Logger:
        if name in cls._loggers:
            return cls._loggers[name]

        logger = logging.getLogger(name)
        logger.setLevel(level)

        if os.getenv("ENV") != "production":
            console_handler = RichHandler(show_time=True, show_level=True, markup=True)
        else:
            json_formatter = jsonlogger.JsonFormatter(
                "%(asctime)s %(levelname)s %(name)s %(message)s %(funcName)s %(lineno)d",
                datefmt="%Y-%m-%dT%H:%M:%S"
            )
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setFormatter(json_formatter)

        console_handler.setLevel(level)
        logger.addHandler(console_handler)
        logger.propagate = False

        cls._loggers[name] = logger
        return logger