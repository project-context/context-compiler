set shell := ["zsh", "-cu"]

fmt:
    cargo fmt --all
    cargo fmt --manifest-path normalizers/Cargo.toml --all
    cargo fmt --manifest-path connectors/Cargo.toml --all

lint:
    cargo clippy --workspace --all-targets --all-features -- -D warnings
    cargo clippy --manifest-path normalizers/Cargo.toml --workspace --all-targets --all-features -- -D warnings
    cargo clippy --manifest-path connectors/Cargo.toml --workspace --all-targets --all-features -- -D warnings

test crate:
    cargo test -p context-{{crate}}

test-all:
    cargo test --workspace
    cargo test --manifest-path normalizers/Cargo.toml --workspace --all-targets
    cargo test --manifest-path connectors/Cargo.toml --workspace --all-targets
    cd admin-web && npm test
    cd admin-web && npm run build

web-build:
    cd admin-web && npm run build

test-normalizer crate:
    cargo test --manifest-path normalizers/Cargo.toml -p agent-file-normalizer-{{crate}}

write-schemas:
    cargo run -p context-test-support --bin write-schemas
    cargo run -p context-admin-backend --bin write_openapi
    cd admin-web && npm run generate:api
