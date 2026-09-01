//! Lightweight Source cfg helpers for first-run classification.

use std::collections::BTreeSet;

const GAMEPLAY_CMDS: &[&str] = &["bind", "unbind", "unbindall", "alias", "exec"];

pub fn gameplay_script_signature(text: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for raw in text.lines() {
        let Some(tokens) = tokenize_line(raw) else {
            continue;
        };
        if !is_gameplay_cmd(&tokens[0]) {
            continue;
        }
        out.insert(tokens.join(" "));
    }
    out
}

fn is_gameplay_cmd(cmd: &str) -> bool {
    GAMEPLAY_CMDS.contains(&cmd)
}

fn tokenize_line(raw: &str) -> Option<Vec<String>> {
    let stripped = strip_comment(raw);
    let tokens = tokenize(stripped);
    if tokens.is_empty() {
        None
    } else {
        Some(tokens)
    }
}

fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut in_quote = false;
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'"' {
            in_quote = !in_quote;
        } else if !in_quote && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            return line[..i].trim_end();
        }
        i += 1;
    }
    line
}

fn tokenize(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    for ch in line.chars() {
        if ch == '"' {
            in_quote = !in_quote;
            continue;
        }
        if ch.is_whitespace() && !in_quote {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    if let Some(first) = tokens.first_mut() {
        *first = first.to_ascii_lowercase();
    }
    if matches!(tokens.first().map(String::as_str), Some("bind" | "unbind")) {
        if let Some(key) = tokens.get_mut(1) {
            *key = key.to_ascii_lowercase();
        }
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_ignores_host_cvars_and_quotes() {
        let stock = "unbindall\nbind \"w\" +forward\nbind s +back\n";
        let first_launch =
            "unbindall\nbind w +forward\nbind \"s\" +back\nname Player\nvolume 1.0\n";
        assert_eq!(
            gameplay_script_signature(stock),
            gameplay_script_signature(first_launch)
        );
    }

    #[test]
    fn signature_sees_rebinds() {
        let stock = "unbindall\nbind w +forward\n";
        let changed = "unbindall\nbind w +back\n";
        assert_ne!(
            gameplay_script_signature(stock),
            gameplay_script_signature(changed)
        );
    }
}
