use std::fs;
use std::path::Path;

use tempfile::TempDir;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TestSupportError {
    #[error("fixture I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

pub type TestSupportResult<T> = Result<T, TestSupportError>;

pub struct RefundFixture {
    directory: TempDir,
}

impl RefundFixture {
    pub fn new() -> TestSupportResult<Self> {
        let directory = tempfile::tempdir()?;
        fs::create_dir_all(directory.path().join("docs"))?;
        fs::create_dir_all(directory.path().join("src"))?;
        fs::write(
            directory.path().join("docs/refund.md"),
            "# 退款规则\n\n退款必须在 7 天内完成。\n\n## 地区 A\n\n退款由原支付渠道退回。\n",
        )?;
        fs::write(
            directory.path().join("src/refund.ts"),
            "export function refund(days: number) {\n  if (days <= 7) return true;\n  return false;\n}\n",
        )?;
        Ok(Self { directory })
    }

    pub fn root(&self) -> &Path {
        self.directory.path()
    }
}
