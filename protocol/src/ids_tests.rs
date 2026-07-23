use super::*;
use pretty_assertions::assert_eq;

#[test]
fn revision_ref_round_trips_with_stable_entity_identity() -> Result<(), serde_json::Error> {
    let value = RevisionRef::new(EntityRef::new(Layer::Fact, "fact:refund-limit"), "sha256:1");
    let json = serde_json::to_string(&value)?;
    let decoded: RevisionRef = serde_json::from_str(&json)?;
    assert_eq!(decoded, value);
    Ok(())
}
