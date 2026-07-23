use std::fs;
use std::path::Path;

use crate::WorkspaceResult;

const START: &str = "<!-- context-compiler:managed:start -->";
const END: &str = "<!-- context-compiler:managed:end -->";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentConfigOutcome {
    Created,
    UpdatedManagedBlock,
    Unchanged,
    SkippedUnmanaged,
}

pub fn ensure_managed_agent_block(
    path: impl AsRef<Path>,
    managed_content: &str,
) -> WorkspaceResult<AgentConfigOutcome> {
    let path = path.as_ref();
    let block = format!("{START}\n{}\n{END}\n", managed_content.trim());
    if !path.exists() {
        fs::write(path, block)?;
        return Ok(AgentConfigOutcome::Created);
    }
    let existing = fs::read_to_string(path)?;
    let Some(start) = existing.find(START) else {
        return Ok(AgentConfigOutcome::SkippedUnmanaged);
    };
    let Some(relative_end) = existing[start..].find(END) else {
        return Ok(AgentConfigOutcome::SkippedUnmanaged);
    };
    let end = start + relative_end + END.len();
    let mut updated = String::with_capacity(existing.len() + block.len());
    updated.push_str(&existing[..start]);
    updated.push_str(block.trim_end());
    updated.push_str(&existing[end..]);
    if updated == existing {
        return Ok(AgentConfigOutcome::Unchanged);
    }
    fs::write(path, updated)?;
    Ok(AgentConfigOutcome::UpdatedManagedBlock)
}
