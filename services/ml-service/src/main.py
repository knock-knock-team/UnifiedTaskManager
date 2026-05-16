import logging
import os
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from pythonjsonlogger import jsonlogger

from .core import lifespan, settings
from .api import assistant_router, task_router

SERVICE_NAME = "ml-service"
SLOW_REQUEST_MS = int(os.getenv("SLOW_REQUEST_MS", "750") or "0")
logger = logging.getLogger("ml-service")

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total number of HTTP requests.",
    ["service", "method", "route", "status"],
)
HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ["service", "method", "route", "status"],
)
HTTP_REQUESTS_IN_FLIGHT = Gauge(
    "http_requests_in_flight",
    "Current number of in-flight HTTP requests.",
    ["service", "method", "route"],
)


def setup_logging():
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    handler = logging.StreamHandler()
    if os.getenv("ENV", "").lower() == "production":
        handler.setFormatter(jsonlogger.JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    root.addHandler(handler)


def create_app() -> FastAPI:
    setup_logging()
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        debug=settings.DEBUG,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.CORS_ALLOW_ORIGIN] if settings.CORS_ALLOW_ORIGIN else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def metrics_middleware(request, call_next):
        if request.url.path == "/metrics":
            return await call_next(request)

        method = request.method
        route = request.url.path
        started = time.perf_counter()
        HTTP_REQUESTS_IN_FLIGHT.labels(SERVICE_NAME, method, route).inc()
        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - started) * 1000
            HTTP_REQUESTS_TOTAL.labels(SERVICE_NAME, method, route, "500").inc()
            HTTP_REQUEST_DURATION_SECONDS.labels(SERVICE_NAME, method, route, "500").observe(elapsed_ms / 1000)
            logger.exception("http_request_failed", extra={"method": method, "route": route, "duration_ms": round(elapsed_ms, 2)})
            raise
        finally:
            HTTP_REQUESTS_IN_FLIGHT.labels(SERVICE_NAME, method, route).dec()

        route_obj = request.scope.get("route")
        route = getattr(route_obj, "path", route)
        status = str(response.status_code)
        elapsed_ms = (time.perf_counter() - started) * 1000
        HTTP_REQUESTS_TOTAL.labels(SERVICE_NAME, method, route, status).inc()
        HTTP_REQUEST_DURATION_SECONDS.labels(SERVICE_NAME, method, route, status).observe(elapsed_ms / 1000)
        if SLOW_REQUEST_MS > 0 and elapsed_ms >= SLOW_REQUEST_MS:
            logger.warning(
                "slow_http_request",
                extra={
                    "method": method,
                    "route": route,
                    "status": response.status_code,
                    "duration_ms": round(elapsed_ms, 2),
                    "threshold_ms": SLOW_REQUEST_MS,
                },
            )
        return response

    @app.get("/metrics")
    async def metrics():
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.include_router(task_router, prefix="")
    app.include_router(assistant_router, prefix="")
    return app


app = create_app()