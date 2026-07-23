use axum::Router;
use axum::body::Body;
use axum::http::StatusCode;
use axum::http::header;
use axum::response::Response;
use axum::routing::get;
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
// Build `admin-web/dist` before this crate so the single binary captures the
// current content-preview client and generated API contract.
#[folder = "../admin-web/dist"]
struct AdminWebAssets;

pub(crate) fn with_embedded_web(api: Router) -> Router {
    api.fallback(get(asset))
}

async fn asset(uri: axum::http::Uri) -> Response {
    let requested = uri.path().trim_start_matches('/');
    let name = if requested.is_empty() {
        "index.html"
    } else {
        requested
    };
    let resolved = AdminWebAssets::get(name)
        .map(|asset| {
            let content_type = mime_guess::from_path(name)
                .first_or_octet_stream()
                .to_string();
            (asset, content_type)
        })
        .or_else(|| {
            AdminWebAssets::get("index.html")
                .map(|asset| (asset, "text/html; charset=utf-8".to_owned()))
        });
    let Some((asset, content_type)) = resolved else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from("admin web assets missing"))
            .unwrap_or_else(|_| Response::new(Body::empty()));
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from(asset.data))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}
