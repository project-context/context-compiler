use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

const DEFAULT_PAGE_SIZE: u16 = 50;
const MAX_PAGE_SIZE: u16 = 200;

/// Opaque keyset pagination request shared by every catalog API.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    pub cursor: Option<String>,
    pub limit: Option<u16>,
}

impl PageRequest {
    pub fn limit(&self) -> usize {
        usize::from(
            self.limit
                .unwrap_or(DEFAULT_PAGE_SIZE)
                .clamp(1, MAX_PAGE_SIZE),
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

impl<T> Page<T> {
    pub fn empty() -> Self {
        Self {
            items: Vec::new(),
            next_cursor: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RevisionMode {
    #[default]
    Current,
    All,
}

/// Applies stable keyset pagination after sorting by the provided key.
pub fn page_by_key<T, F>(mut values: Vec<T>, request: &PageRequest, key: F) -> Page<T>
where
    F: Fn(&T) -> String,
{
    values.sort_by_key(&key);
    if let Some(cursor) = &request.cursor {
        values.retain(|value| key(value) > *cursor);
    }
    let limit = request.limit();
    let has_more = values.len() > limit;
    values.truncate(limit);
    let next_cursor = has_more.then(|| values.last().map(&key)).flatten();
    Page {
        items: values,
        next_cursor,
    }
}

#[cfg(test)]
mod tests {
    use super::PageRequest;
    use super::page_by_key;

    #[test]
    fn cursor_is_exclusive_and_limit_is_bounded() {
        let page = page_by_key(
            vec!["c", "a", "b"],
            &PageRequest {
                cursor: Some("a".to_owned()),
                limit: Some(1),
            },
            |value| (*value).to_owned(),
        );
        assert_eq!(page.items, vec!["b"]);
        assert_eq!(page.next_cursor.as_deref(), Some("b"));
    }
}
