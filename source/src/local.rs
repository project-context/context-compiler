use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use bytes::Bytes;
use context_protocol::AccessStatus;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::RevisionRef;
use sha2::Digest;
use sha2::Sha256;
use walkdir::WalkDir;

use crate::ResolvedNormalization;
use crate::SourceError;
use crate::SourceRecord;
use crate::SourceResult;
use crate::SourceSnapshot;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapturedSource {
    pub record: SourceRecord,
    pub snapshot: SourceSnapshot,
    pub bytes: Bytes,
    pub normalizer_id: String,
    pub normalizer_config: serde_json::Value,
}

/// Discovers and captures supported local files relative to one workspace root.
#[derive(Clone, Debug)]
pub struct LocalSourceConnector {
    root: PathBuf,
    rules: Vec<ResolvedNormalization>,
}

impl LocalSourceConnector {
    pub fn new(root: impl Into<PathBuf>, rules: Vec<ResolvedNormalization>) -> Self {
        Self {
            root: root.into(),
            rules,
        }
    }

    pub fn discover(&self) -> SourceResult<Vec<PathBuf>> {
        let mut files = Vec::new();
        for entry in WalkDir::new(&self.root).into_iter().filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !matches!(name.as_ref(), ".git" | ".context" | "target" | ".idea")
        }) {
            let entry = entry.map_err(|error| SourceError::Io(error.to_string()))?;
            if entry.file_type().is_file() && self.rule_for_path(entry.path()).is_some() {
                files.push(entry.into_path());
            }
        }
        files.sort();
        Ok(files)
    }

    pub fn capture(&self, path: &Path) -> SourceResult<CapturedSource> {
        let rule = self
            .rule_for_path(path)
            .cloned()
            .ok_or_else(|| SourceError::Unsupported(path.display().to_string()))?;
        let bytes = fs::read(path).map_err(|error| SourceError::Io(error.to_string()))?;
        let metadata = fs::metadata(path).map_err(|error| SourceError::Io(error.to_string()))?;
        let relative = path.strip_prefix(&self.root).unwrap_or(path);
        let uri = relative.to_string_lossy().replace('\\', "/");
        let entity_ref = EntityRef::new(Layer::Source, format!("source:file:{uri}"));
        let content_hash = sha256(&bytes);
        let revision_ref = RevisionRef::new(entity_ref.clone(), content_hash.clone());
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .and_then(|value| i64::try_from(value.as_secs()).ok());
        let title = path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| uri.clone());
        let record = SourceRecord {
            entity_ref,
            format: rule.input_format,
            uri,
            title,
            media_type: rule.input_media_type,
            current_snapshot: revision_ref.clone(),
            access_status: AccessStatus::Available,
        };
        let snapshot = SourceSnapshot {
            revision_ref,
            content_hash,
            size_bytes: metadata.len(),
            modified_at,
            freshness: Freshness::Current,
        };
        Ok(CapturedSource {
            record,
            snapshot,
            bytes: Bytes::from(bytes),
            normalizer_id: rule.normalizer_id,
            normalizer_config: rule.config,
        })
    }

    fn rule_for_path(&self, path: &Path) -> Option<&ResolvedNormalization> {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())?
            .to_ascii_lowercase();
        self.rules
            .iter()
            .find(|rule| rule.input_extension == extension)
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
#[path = "local_tests.rs"]
mod tests;
