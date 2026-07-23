use schemars::Schema;

use crate::ConfigResult;
use crate::ContextConfig;

pub fn schema_document() -> ConfigResult<serde_json::Value> {
    let schema: Schema = schemars::schema_for!(ContextConfig);
    serde_json::to_value(schema).map_err(Into::into)
}
