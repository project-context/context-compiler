use std::error::Error;
use std::fs;

use pretty_assertions::assert_eq;
use tempfile::tempdir;

use crate::AgentFileProfile;
use crate::FormatId;
use crate::RetrievalProfile;
use crate::ToolSupport;
use agent_file_normalizer::NormalizedFormat;

use super::*;

#[test]
fn local_connector_discovers_supported_sources_and_captures_stable_identity()
-> Result<(), Box<dyn Error>> {
    let root = tempdir()?;
    fs::write(
        root.path().join("refund.md"),
        "# Refund\nAmount must be valid.",
    )?;
    fs::write(root.path().join("ignore.txt"), "ignored")?;
    let connector = LocalSourceConnector::new(root.path(), vec![markdown_rule()]);

    let files = connector.discover()?;
    assert_eq!(files, vec![root.path().join("refund.md")]);

    let captured = connector.capture(&files[0])?;
    assert_eq!(captured.record.entity_ref.id, "source:file:refund.md");
    assert_eq!(captured.record.format, FormatId::new("markdown"));
    assert_eq!(captured.bytes.as_ref(), b"# Refund\nAmount must be valid.");
    assert_eq!(
        captured.snapshot.revision_ref.entity,
        captured.record.entity_ref
    );
    Ok(())
}

fn markdown_rule() -> ResolvedNormalization {
    ResolvedNormalization {
        normalizer_id: "markdown-to-markdown".to_owned(),
        input_format: FormatId::new("markdown"),
        input_media_type: "text/markdown".to_owned(),
        input_extension: "md".to_owned(),
        output: NormalizedFormat {
            format: FormatId::new("markdown"),
            media_type: "text/markdown".to_owned(),
            extension: "md".to_owned(),
            agent: AgentFileProfile {
                retrieval: RetrievalProfile::Prose,
                tools: ToolSupport::shell_text(),
            },
        },
        priority: 100,
        config: serde_json::json!({}),
    }
}
