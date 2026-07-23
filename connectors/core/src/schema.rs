use schemars::JsonSchema;
use schemars::schema_for;
use serde_json::Value;

use crate::ConnectionTestResult;
use crate::ConnectorDescriptor;
use crate::ConnectorInstanceConfig;
use crate::ConnectorObject;
use crate::DiscoveryRequest;
use crate::DiscoveryResult;
use crate::SecretRef;

#[allow(dead_code)]
#[derive(JsonSchema)]
struct ConnectorProtocolSchema {
    descriptor: ConnectorDescriptor,
    instance: ConnectorInstanceConfig,
    secret: SecretRef,
    request: DiscoveryRequest,
    discovery: DiscoveryResult,
    object: ConnectorObject,
    connection: ConnectionTestResult,
}

pub fn schema_document() -> Result<Value, serde_json::Error> {
    serde_json::to_value(schema_for!(ConnectorProtocolSchema))
}
