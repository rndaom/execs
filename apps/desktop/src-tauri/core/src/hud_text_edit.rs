//! Surgical edits for escape-disabled HUD KeyValues. The parsed maps establish
//! identity; byte spans keep unrelated formatting, comments and directives intact.

use crate::vdf::{parse_hud_vdf, serialize_hud_vdf, VdfMap, VdfValue};
use std::ops::Range;

/// Apply value changes and appended entries without reserializing existing nodes.
/// The caller must retain existing entry order and conditional identities. This
/// is the shape produced by HUD schema merges; destructive tree edits fail closed.
pub(crate) fn edit(original: &str, before: &VdfMap, after: &VdfMap) -> Result<String, String> {
    if parse_hud_vdf(original)? != *before {
        return Err("HUD resource changed before its text edit".into());
    }
    // Validate new strings before placing any literal quoted token in the file.
    serialize_hud_vdf(after)?;
    let mut cursor = Cursor {
        text: original,
        pos: 0,
    };
    let spans = cursor.map(before, false)?;
    let mut patches = Vec::new();
    changes(
        before,
        after,
        &spans,
        0,
        original.contains("\r\n"),
        &mut patches,
    )?;
    let mut output = original.to_owned();
    // Every replacement belongs to a disjoint node or a map's closing position.
    patches.sort_by_key(|(range, _)| range.start);
    for (range, replacement) in patches.into_iter().rev() {
        output.replace_range(range, &replacement);
    }
    if parse_hud_vdf(&output)? != *after {
        return Err("HUD resource text edit did not preserve the requested tree".into());
    }
    Ok(output)
}

struct MapSpans {
    entries: Vec<EntrySpan>,
    end: usize,
}

struct EntrySpan {
    value: Range<usize>,
    child: Option<MapSpans>,
}

struct Cursor<'a> {
    text: &'a str,
    pos: usize,
}

impl Cursor<'_> {
    fn rest(&self) -> &str {
        &self.text[self.pos..]
    }

    fn trivia(&mut self) {
        loop {
            let whitespace = self.rest().len() - self.rest().trim_start().len();
            self.pos += whitespace;
            if self.rest().starts_with("//") {
                self.pos += self.rest().find('\n').unwrap_or(self.rest().len());
            } else if self.rest().starts_with("/*") {
                // The authoritative parser already rejected unclosed comments.
                self.pos += self.rest().find("*/").map_or(self.rest().len(), |i| i + 2);
            } else {
                break;
            }
        }
    }

    fn token(&mut self) -> Result<(), String> {
        self.trivia();
        if self.rest().starts_with('"') {
            self.pos += 1;
            let end = self.rest().find('"').ok_or("Unclosed HUD token")?;
            self.pos += end + 1;
        } else {
            let size = self
                .rest()
                .find(|c: char| c.is_whitespace() || matches!(c, '{' | '}' | '"'))
                .unwrap_or(self.rest().len());
            if size == 0 {
                return Err("Missing HUD token".into());
            }
            self.pos += size;
        }
        Ok(())
    }

    fn condition(&mut self) -> bool {
        self.trivia();
        if !self.rest().starts_with('[') {
            return false;
        }
        for (index, ch) in self.rest().char_indices() {
            if matches!(ch, '\n' | '{' | '}' | '"') {
                return false;
            }
            if ch == ']' {
                self.pos += index + 1;
                return true;
            }
        }
        false
    }

    fn map(&mut self, map: &VdfMap, nested: bool) -> Result<MapSpans, String> {
        let mut entries = Vec::with_capacity(map.entries.len());
        for (_, value) in &map.entries {
            self.token()?;
            let prefix_condition = self.condition();
            self.trivia();
            let start = self.pos;
            let child = if let VdfValue::Obj(child) = value {
                if !self.rest().starts_with('{') {
                    return Err("Missing HUD object".into());
                }
                self.pos += 1;
                let spans = self.map(child, true)?;
                self.pos += 1;
                Some(spans)
            } else {
                self.token()?;
                None
            };
            let end = self.pos;
            if !prefix_condition {
                self.condition();
            }
            entries.push(EntrySpan {
                value: start..end,
                child,
            });
        }
        self.trivia();
        if nested && !self.rest().starts_with('}') {
            return Err("Missing HUD closing brace".into());
        }
        Ok(MapSpans {
            entries,
            end: self.pos,
        })
    }
}

fn changes(
    before: &VdfMap,
    after: &VdfMap,
    spans: &MapSpans,
    depth: usize,
    crlf: bool,
    patches: &mut Vec<(Range<usize>, String)>,
) -> Result<(), String> {
    if after.entries.len() < before.entries.len() {
        return Err("HUD text edits cannot remove existing entries".into());
    }
    for (i, (key, value)) in before.entries.iter().enumerate() {
        let (next_key, next_value) = &after.entries[i];
        if key != next_key || before.condition_at(i) != after.condition_at(i) {
            return Err("HUD text edits cannot reorder or change conditional identities".into());
        }
        if value == next_value {
            continue;
        }
        let span = &spans.entries[i];
        if let (VdfValue::Obj(old), VdfValue::Obj(new), Some(child)) =
            (value, next_value, &span.child)
        {
            changes(old, new, child, depth + 1, crlf, patches)?;
        } else {
            let replacement = match next_value {
                VdfValue::Str(text) => format!("\"{text}\""),
                VdfValue::Obj(map) => {
                    let newline = if crlf { "\r\n" } else { "\n" };
                    format!(
                        "{{{newline}{}{}}}",
                        render_map(map, depth + 1, newline),
                        "\t".repeat(depth)
                    )
                }
            };
            patches.push((span.value.clone(), replacement));
        }
    }
    if after.entries.len() > before.entries.len() {
        let mut appended = VdfMap::default();
        for i in before.entries.len()..after.entries.len() {
            appended.entries.push(after.entries[i].clone());
            appended.set_condition(
                appended.entries.len() - 1,
                after.condition_at(i).map(str::to_owned),
            );
        }
        let newline = if crlf { "\r\n" } else { "\n" };
        let mut insertion = newline.to_owned();
        insertion.push_str(&render_map(&appended, depth, newline));
        insertion.push_str(&"\t".repeat(depth.saturating_sub(1)));
        patches.push((spans.end..spans.end, insertion));
    }
    Ok(())
}

fn render_map(map: &VdfMap, depth: usize, newline: &str) -> String {
    let indent = "\t".repeat(depth);
    let mut out = String::new();
    for (index, (key, value)) in map.entries.iter().enumerate() {
        out.push_str(&format!("{indent}\"{key}\""));
        let condition = map
            .condition_at(index)
            .map(|s| format!(" {s}"))
            .unwrap_or_default();
        match value {
            VdfValue::Str(text) => out.push_str(&format!("\t\t\"{text}\"{condition}{newline}")),
            VdfValue::Obj(child) => {
                out.push_str(&format!("{condition}{newline}{indent}{{{newline}"));
                out.push_str(&render_map(child, depth + 1, newline));
                out.push_str(&format!("{indent}}}{newline}"));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_only_selected_token_with_comments_unicode_and_conditions() {
        let source = "// café\r\n#base \"base.res\"\r\n\"Root\" {\r\n  \"Label\" \"été\\font\" [$WIN32] // keep\r\n  \"Label\" /* note */ \"linux\" [$LINUX]\r\n}\r\n";
        let before = parse_hud_vdf(source).unwrap();
        let mut after = before.clone();
        after.set_path(&["Root", "Label"], "更新\\font");
        let edited = edit(source, &before, &after).unwrap();
        assert_eq!(edited, source.replace("\"linux\"", "\"更新\\font\""));
        assert_eq!(edit(&edited, &after, &after).unwrap(), edited);
    }

    #[test]
    fn appends_nested_nodes_without_losing_tail_comments() {
        let source = "#base base.res\nRoot { existing value // explanation\n /* tail */ } // eof";
        let before = parse_hud_vdf(source).unwrap();
        let mut after = before.clone();
        after.set_path(&["Root", "New", "Color"], "255 255 255");
        after.set_path(&["Another"], "yes");
        let edited = edit(source, &before, &after).unwrap();
        assert!(edited.contains("Root { existing value // explanation\n /* tail */ "));
        assert!(edited.contains("} // eof\n"));
        assert_eq!(parse_hud_vdf(&edited).unwrap(), after);
        assert_eq!(edit(&edited, &after, &after).unwrap(), edited);
    }

    #[test]
    fn replaced_object_keeps_its_conditional_and_neighbor_bytes() {
        let source = "Root [$WIN32] { old x } /* untouched */ next y";
        let before = parse_hud_vdf(source).unwrap();
        let mut after = before.clone();
        after.entries[0].1 = VdfValue::Str("replacement".into());
        assert_eq!(
            edit(source, &before, &after).unwrap(),
            "Root [$WIN32] \"replacement\" /* untouched */ next y"
        );
    }

    #[test]
    fn refuses_stale_tree_and_invalid_literal_values() {
        let before = parse_hud_vdf("k v").unwrap();
        assert!(edit("k changed", &before, &before).is_err());
        let mut after = before.clone();
        after.set_path(&["k"], "bad\"quote");
        assert!(edit("k v", &before, &after).is_err());
    }

    #[test]
    fn inserted_multiline_values_keep_their_literal_bytes_in_crlf_documents() {
        let source = "Root\r\n{\r\n}\r\n";
        let before = parse_hud_vdf(source).unwrap();
        let mut after = before.clone();
        after.set_path(&["Root", "Text"], "first\nsecond\\line");
        let edited = edit(source, &before, &after).unwrap();
        assert!(edited.contains("\"first\nsecond\\line\"\r\n"));
        assert_eq!(parse_hud_vdf(&edited).unwrap(), after);
    }
}
