use std::collections::BTreeMap;

use agent_file_normalizer::NormalizerDescriptor;
use globset::Glob;
use globset::GlobSetBuilder;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::ConfigError;
use crate::ConfigResult;
use crate::ContextConfig;
use crate::NormalizationRule;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteInput<'a> {
    pub source_id: &'a str,
    pub path: &'a str,
    pub extension: Option<&'a str>,
    pub media_type: Option<&'a str>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRoute {
    pub rule_id: String,
    pub normalizer_id: String,
    pub precedence: u8,
    pub priority: i32,
    pub config: serde_json::Value,
}

impl ContextConfig {
    pub fn matching_routes(
        &self,
        input: RouteInput<'_>,
        descriptors: &[NormalizerDescriptor],
    ) -> ConfigResult<Vec<ResolvedRoute>> {
        let descriptor_by_id = descriptors
            .iter()
            .map(|descriptor| (descriptor.id.as_str(), descriptor))
            .collect::<BTreeMap<_, _>>();
        let mut candidates = Vec::new();

        for rule in &self.normalization.defaults {
            push_candidate(&mut candidates, rule, 1, &input, &descriptor_by_id)?;
        }
        for source in &self.normalization.source_overrides {
            if source.source_id == input.source_id {
                for rule in &source.rules {
                    push_candidate(&mut candidates, rule, 2, &input, &descriptor_by_id)?;
                }
            }
        }
        for path in &self.normalization.path_overrides {
            if path
                .source_id
                .as_deref()
                .is_some_and(|source_id| source_id != input.source_id)
                || !matches_any(&path.globs, input.path)?
            {
                continue;
            }
            push_candidate(&mut candidates, &path.rule, 3, &input, &descriptor_by_id)?;
        }

        candidates.sort_by(|left: &ResolvedRoute, right: &ResolvedRoute| {
            right
                .precedence
                .cmp(&left.precedence)
                .then_with(|| right.priority.cmp(&left.priority))
                .then_with(|| left.rule_id.cmp(&right.rule_id))
        });
        if let Some(precedence) = candidates.first().map(|candidate| candidate.precedence) {
            candidates.retain(|candidate| candidate.precedence == precedence);
        }
        Ok(candidates)
    }

    pub fn resolve_route(
        &self,
        input: RouteInput<'_>,
        descriptors: &[NormalizerDescriptor],
    ) -> ConfigResult<Option<ResolvedRoute>> {
        let candidates = self.matching_routes(input.clone(), descriptors)?;
        let Some(selected) = candidates.first() else {
            return Ok(None);
        };
        if candidates.get(1).is_some_and(|other| {
            other.precedence == selected.precedence
                && other.priority == selected.priority
                && other.normalizer_id != selected.normalizer_id
        }) {
            return Err(ConfigError::Conflict(format!(
                "normalization rules are tied for {}: {} and {}",
                input.path, selected.rule_id, candidates[1].rule_id
            )));
        }
        Ok(Some(selected.clone()))
    }
}

fn push_candidate(
    candidates: &mut Vec<ResolvedRoute>,
    rule: &NormalizationRule,
    precedence: u8,
    input: &RouteInput<'_>,
    descriptors: &BTreeMap<&str, &NormalizerDescriptor>,
) -> ConfigResult<()> {
    if !rule.enabled {
        return Ok(());
    }
    let descriptor = descriptors
        .get(rule.normalizer_id.as_str())
        .ok_or_else(|| {
            ConfigError::Validation(format!(
                "normalizer is not installed: {}",
                rule.normalizer_id
            ))
        })?;
    let extension = input.extension.map(normalize_extension);
    let descriptor_extensions = descriptor
        .inputs
        .iter()
        .flat_map(|input| input.extensions.iter());
    let configured_extensions = if rule.extensions.is_empty() {
        descriptor_extensions.cloned().collect::<Vec<_>>()
    } else {
        rule.extensions.clone()
    };
    let extension_matches = extension.as_ref().is_some_and(|extension| {
        configured_extensions
            .iter()
            .map(|value| normalize_extension(value))
            .any(|value| value == *extension)
    });
    let media_matches = input.media_type.is_some_and(|media_type| {
        (rule.media_types.is_empty()
            && descriptor
                .inputs
                .iter()
                .any(|input| input.media_types.iter().any(|value| value == media_type)))
            || rule.media_types.iter().any(|value| value == media_type)
    });
    if extension_matches || media_matches {
        candidates.push(ResolvedRoute {
            rule_id: rule.id.clone(),
            normalizer_id: rule.normalizer_id.clone(),
            precedence,
            priority: rule.priority,
            config: rule.config.clone(),
        });
    }
    Ok(())
}

fn matches_any(patterns: &[String], path: &str) -> ConfigResult<bool> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder
            .add(Glob::new(pattern).map_err(|error| ConfigError::Validation(error.to_string()))?);
    }
    let globs = builder
        .build()
        .map_err(|error| ConfigError::Validation(error.to_string()))?;
    Ok(globs.is_match(path))
}

fn normalize_extension(value: &str) -> String {
    value.trim_start_matches('.').to_ascii_lowercase()
}
