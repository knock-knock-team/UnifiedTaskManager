use axum::{
    body::Body,
    extract::MatchedPath,
    http::Request,
    middleware::Next,
    response::{IntoResponse, Response},
};
use once_cell::sync::Lazy;
use prometheus::{
    Encoder, HistogramOpts, HistogramVec, IntCounterVec, IntGaugeVec, TextEncoder, register_histogram_vec,
    register_int_counter_vec, register_int_gauge_vec,
};
use std::{env, time::Instant};

static HTTP_REQUESTS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "http_requests_total",
        "Total number of HTTP requests.",
        &["service", "method", "route", "status"]
    )
    .expect("register http_requests_total")
});

static HTTP_REQUEST_DURATION_SECONDS: Lazy<HistogramVec> = Lazy::new(|| {
    register_histogram_vec!(
        HistogramOpts::new(
            "http_request_duration_seconds",
            "HTTP request duration in seconds."
        ),
        &["service", "method", "route", "status"]
    )
    .expect("register http_request_duration_seconds")
});

static HTTP_REQUESTS_IN_FLIGHT: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "http_requests_in_flight",
        "Current number of in-flight HTTP requests.",
        &["service", "method", "route"]
    )
    .expect("register http_requests_in_flight")
});

pub async fn track_http(req: Request<Body>, next: Next) -> Response {
    let method = req.method().as_str().to_owned();
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_owned())
        .unwrap_or_else(|| req.uri().path().to_owned());

    if route == "/metrics" {
        return next.run(req).await;
    }

    HTTP_REQUESTS_IN_FLIGHT
        .with_label_values(&["chat-service", &method, &route])
        .inc();

    let started = Instant::now();
    let response = next.run(req).await;
    let status = response.status().as_u16().to_string();
    let elapsed = started.elapsed().as_secs_f64();

    HTTP_REQUESTS_IN_FLIGHT
        .with_label_values(&["chat-service", &method, &route])
        .dec();
    HTTP_REQUESTS_TOTAL
        .with_label_values(&["chat-service", &method, &route, &status])
        .inc();
    HTTP_REQUEST_DURATION_SECONDS
        .with_label_values(&["chat-service", &method, &route, &status])
        .observe(elapsed);

    let slow_threshold_ms = env::var("SLOW_REQUEST_MS")
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(750.0);
    let elapsed_ms = elapsed * 1000.0;
    if slow_threshold_ms > 0.0 && elapsed_ms >= slow_threshold_ms {
        tracing::warn!(
            method = %method,
            route = %route,
            status = %status,
            duration_ms = elapsed_ms,
            threshold_ms = slow_threshold_ms,
            "slow_http_request"
        );
    }

    response
}

pub async fn metrics() -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();
    if let Err(err) = encoder.encode(&metric_families, &mut buffer) {
        tracing::error!(error = %err, "failed to encode prometheus metrics");
        return (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "failed to encode metrics".to_owned(),
        )
            .into_response();
    }

    (
        [(
            axum::http::header::CONTENT_TYPE,
            encoder.format_type().to_owned(),
        )],
        buffer,
    )
        .into_response()
}
