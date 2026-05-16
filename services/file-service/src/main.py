import logging
import os
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

from src.api.routes import router as file_router
from src.core.config import settings
from src.core.lifespan import lifespan
from src.core.logging import setup_logging

setup_logging()

SERVICE_NAME = "file-service"
SLOW_REQUEST_MS = int(os.getenv("SLOW_REQUEST_MS", "750") or "0")
logger = logging.getLogger("file-service")

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

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.app_debug,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_allow_origin] if settings.cors_allow_origin else ["*"],
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


app.include_router(file_router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    return {"status": "ready"}


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
