//! The extraction contract of SPEC §5 and the test scenes.
//!
//! Scene text comes from `fixtures/`, never from a real manuscript.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const MANUSCRIPT: &str = include_str!("../../../../fixtures/la-veda/manuscript.json");

#[derive(Deserialize)]
struct Manuscript {
    scenes: Vec<Scene>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Scene {
    pub id: String,
    pub title: String,
    pub text: String,
}

pub fn scene(id: &str) -> Scene {
    let m: Manuscript = serde_json::from_str(MANUSCRIPT).expect("fixture is valid JSON");
    m.scenes
        .into_iter()
        .find(|s| s.id == id)
        .expect("scene exists in the fixture")
}

/// Scene sent for the streaming rewrite.
pub const REWRITE_SCENE: &str = "s01";
/// Has a physical trait, a kinship relation and a name: the example in SPEC §5.
pub const EXTRACTION_SCENE: &str = "s02";

pub const EXTRACTION_INSTRUCTIONS: &str = "Extrae de la escena las entidades, sus alias, los hechos y las relaciones. \
Cada hecho y cada relación llevan en `quote` una cita copiada de la escena carácter por carácter. \
No inventes nada que no esté en la escena. Usa `story_time` solo si la escena lo indica.";

/// Strict-mode schema: every field required and no extras allowed.
pub fn extraction_schema() -> Value {
    let string = json!({ "type": "string" });
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["entities", "facts", "relations"],
        "properties": {
            "entities": { "type": "array", "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["name", "type", "aliases"],
                "properties": {
                    "name": string,
                    "type": string,
                    "aliases": { "type": "array", "items": string }
                }
            }},
            "facts": { "type": "array", "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["entity", "attribute", "value", "quote", "story_time"],
                "properties": {
                    "entity": string,
                    "attribute": string,
                    "value": string,
                    "quote": string,
                    "story_time": { "type": ["string", "null"] }
                }
            }},
            "relations": { "type": "array", "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["from", "to", "label", "quote"],
                "properties": {
                    "from": string,
                    "to": string,
                    "label": string,
                    "quote": string
                }
            }}
        }
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Extraction {
    entities: Vec<Entity>,
    facts: Vec<Fact>,
    relations: Vec<Relation>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)] // Fields exist to enforce the shape.
struct Entity {
    name: String,
    #[serde(rename = "type")]
    kind: String,
    aliases: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
struct Fact {
    entity: String,
    attribute: String,
    value: String,
    quote: String,
    story_time: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
struct Relation {
    from: String,
    to: String,
    label: String,
    quote: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct ContractCheck {
    pub schema_ok: bool,
    pub schema_error: Option<String>,
    pub entities: usize,
    pub facts: usize,
    pub relations: usize,
    pub quotes_total: usize,
    /// Rule 3: a quote not found literally in the scene gets discarded.
    pub quotes_literal: usize,
}

impl ContractCheck {
    pub fn usable(&self) -> bool {
        self.schema_ok && self.entities > 0
    }
}

pub fn check(json_text: &str, scene_text: &str) -> ContractCheck {
    let parsed: Extraction = match serde_json::from_str(json_text) {
        Ok(p) => p,
        Err(e) => {
            return ContractCheck {
                // Not `e.to_string()`: that can quote the model's own text,
                // and this value goes into a report.
                schema_error: Some(format!("{:?} at {}:{}", e.classify(), e.line(), e.column())),
                ..ContractCheck::default()
            };
        }
    };
    let quotes: Vec<&str> = parsed
        .facts
        .iter()
        .map(|f| f.quote.as_str())
        .chain(parsed.relations.iter().map(|r| r.quote.as_str()))
        .collect();
    ContractCheck {
        schema_ok: true,
        schema_error: None,
        entities: parsed.entities.len(),
        facts: parsed.facts.len(),
        relations: parsed.relations.len(),
        quotes_total: quotes.len(),
        quotes_literal: quotes
            .iter()
            .filter(|q| !q.is_empty() && scene_text.contains(**q))
            .count(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"{
      "entities": [{ "name": "Marta Rey", "type": "person", "aliases": ["la doctora"] }],
      "facts": [{ "entity": "Marta Rey", "attribute": "eye_color", "value": "verdes", "quote": "los ojos verdes de su madre", "story_time": null }],
      "relations": [{ "from": "Marta Rey", "to": "Tomás", "label": "hermana de", "quote": "Tomás, su hermano" }]
    }"#;

    #[test]
    fn the_fixture_scenes_exist() {
        assert!(!scene(REWRITE_SCENE).text.is_empty());
        assert!(!scene(EXTRACTION_SCENE).title.is_empty());
    }

    #[test]
    fn accepts_the_spec_example_and_counts_literal_quotes() {
        let c = check(GOOD, &scene(EXTRACTION_SCENE).text);
        assert!(c.usable());
        assert_eq!((c.entities, c.facts, c.relations), (1, 1, 1));
        assert_eq!((c.quotes_total, c.quotes_literal), (2, 2));
    }

    #[test]
    fn an_invented_quote_does_not_count_as_literal() {
        let c = check(GOOD, "Una escena sin esas palabras.");
        assert_eq!((c.quotes_total, c.quotes_literal), (2, 0));
    }

    #[test]
    fn an_empty_quote_does_not_count_as_literal() {
        let json = GOOD.replace("los ojos verdes de su madre", "");
        let c = check(&json, &scene(EXTRACTION_SCENE).text);
        assert_eq!(c.quotes_literal, 1);
    }

    #[test]
    fn rejects_unknown_fields_missing_fields_and_prose() {
        let extra = GOOD.replacen("\"entities\"", "\"extra\": 1, \"entities\"", 1);
        assert!(!check(&extra, "").schema_ok);
        assert!(!check(r#"{"entities":[],"facts":[]}"#, "").schema_ok);
        let fenced = check("```json\n{}\n```", "");
        assert!(!fenced.schema_ok);
        assert!(fenced.schema_error.is_some());
    }

    #[test]
    fn a_schema_error_never_quotes_the_model_output() {
        let c = check(r#"{"entities":"texto del modelo"}"#, "");
        assert!(!c.schema_ok);
        assert!(!c.schema_error.unwrap().contains("texto del modelo"));
    }

    #[test]
    fn an_empty_extraction_is_valid_but_not_usable() {
        let c = check(r#"{"entities":[],"facts":[],"relations":[]}"#, "");
        assert!(c.schema_ok);
        assert!(!c.usable());
    }

    #[test]
    fn the_schema_is_strict_mode_compatible() {
        // Strict mode wants every property listed as required, at every level.
        fn walk(v: &Value) {
            if let Some(props) = v.get("properties").and_then(Value::as_object) {
                assert_eq!(v["additionalProperties"], false);
                let required: Vec<&str> = v["required"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|x| x.as_str().unwrap())
                    .collect();
                for (name, child) in props {
                    assert!(required.contains(&name.as_str()), "{name} not required");
                    walk(child);
                }
            }
            if let Some(items) = v.get("items") {
                walk(items);
            }
        }
        walk(&extraction_schema());
    }
}
