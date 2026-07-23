use std::process::Command;

use context_test_support::RefundFixture;

#[test]
fn build_status_and_doctor_support_json() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = RefundFixture::new()?;
    let home = tempfile::tempdir()?;
    let binary = env!("CARGO_BIN_EXE_context");

    let build = Command::new(binary)
        .current_dir(fixture.root())
        .env("CONTEXT_COMPILER_HOME", home.path())
        .args(["build", "--json", "--no-agent", "--portable"])
        .output()?;
    assert!(
        build.status.success(),
        "{}",
        String::from_utf8_lossy(&build.stderr)
    );
    let build_json: serde_json::Value = serde_json::from_slice(&build.stdout)?;
    assert_eq!(build_json["summary"]["built"], 2);
    assert!(fixture.root().join("context.config.json").exists());
    assert!(fixture.root().join(".context/store/context.db").exists());
    assert!(
        fixture
            .root()
            .join(".context/sources/docs/refund.md")
            .exists()
    );

    for command in ["status", "doctor"] {
        let output = Command::new(binary)
            .current_dir(fixture.root())
            .env("CONTEXT_COMPILER_HOME", home.path())
            .args([command, "--json"])
            .output()?;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let _: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    }
    Ok(())
}
