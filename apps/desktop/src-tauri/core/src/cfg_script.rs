//! Lightweight Source cfg helpers for first-run classification.

/// Normalized Source commands in execution order, produced one at a time.
///
/// This deliberately includes cvars as well as binds. `config.cfg` is the
/// player's settings, and treating an engine-written `volume` or `sensitivity`
/// as disposable is much worse than conservatively offering Save current.
/// The iterator preserves duplicate/reordered binds, but unlike a `Vec` it
/// cannot amplify a semicolon-heavy file into millions of retained strings.
pub fn gameplay_script_signature(text: &str) -> impl Iterator<Item = String> + '_ {
    SourceCommands { remaining: text }
}

/// Split on newlines and semicolons outside quotes, while making `//` consume
/// only the remainder of its current line. Source accepts both separators;
/// treating a semicolon-separated pair as one opaque line can hide a final
/// rebind behind the same unordered signature.
struct SourceCommands<'a> {
    remaining: &'a str,
}

impl Iterator for SourceCommands<'_> {
    type Item = String;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if self.remaining.is_empty() {
                return None;
            }

            let input = self.remaining;
            let mut chars = input.char_indices().peekable();
            let mut command_end = input.len();
            let mut consumed = input.len();
            let mut in_quote = false;
            let mut escaped = false;

            while let Some((index, ch)) = chars.next() {
                if !in_quote && ch == '/' && chars.peek().is_some_and(|(_, next)| *next == '/') {
                    command_end = index;
                    for (comment_index, comment_ch) in chars.by_ref() {
                        if comment_ch == '\n' {
                            consumed = comment_index + comment_ch.len_utf8();
                            break;
                        }
                    }
                    break;
                }

                if ch == '"' && !escaped {
                    in_quote = !in_quote;
                    escaped = false;
                    continue;
                }
                if !in_quote && matches!(ch, ';' | '\n' | '\r') {
                    command_end = index;
                    consumed = index + ch.len_utf8();
                    break;
                }

                escaped = ch == '\\' && !escaped;
                if ch != '\\' {
                    escaped = false;
                }
            }

            self.remaining = &input[consumed..];
            if let Some(command) = normalize_command(input[..command_end].trim()) {
                return Some(command);
            }
        }
    }
}

fn normalize_command(command: &str) -> Option<String> {
    let mut tokens = SourceTokens {
        chars: command.chars(),
    };
    let first = tokens.next()?;
    let first = first.to_ascii_lowercase();
    let lower_key = matches!(first.as_str(), "bind" | "unbind");
    let mut normalized = first;

    if let Some(second) = tokens.next() {
        normalized.push(' ');
        if lower_key {
            normalized.push_str(&second.to_ascii_lowercase());
        } else {
            normalized.push_str(&second);
        }
    }
    for token in tokens {
        normalized.push(' ');
        normalized.push_str(&token);
    }
    Some(normalized)
}

struct SourceTokens<'a> {
    chars: std::str::Chars<'a>,
}

impl Iterator for SourceTokens<'_> {
    type Item = String;

    fn next(&mut self) -> Option<Self::Item> {
        let mut current = String::new();
        let mut in_quote = false;
        let mut escaped = false;

        for ch in self.chars.by_ref() {
            if ch == '"' && !escaped {
                in_quote = !in_quote;
                escaped = false;
                continue;
            }
            if ch.is_whitespace() && !in_quote {
                if !current.is_empty() {
                    return Some(current);
                }
                escaped = false;
                continue;
            }
            current.push(ch);
            escaped = ch == '\\' && !escaped;
            if ch != '\\' {
                escaped = false;
            }
        }
        (!current.is_empty()).then_some(current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_normalizes_quotes_but_keeps_cvars() {
        let stock = "unbindall\nbind \"w\" +forward\nbind s +back\n";
        let equivalent = "unbindall\nbind w +forward\nbind \"s\" +back\n";
        assert!(gameplay_script_signature(stock).eq(gameplay_script_signature(equivalent)));
        assert!(
            !gameplay_script_signature(stock).eq(gameplay_script_signature(&format!(
                "{equivalent}volume 1.0\n"
            )))
        );
    }

    #[test]
    fn signature_sees_rebinds() {
        let stock = "unbindall\nbind w +forward\n";
        let changed = "unbindall\nbind w +back\n";
        assert!(!gameplay_script_signature(stock).eq(gameplay_script_signature(changed)));
    }

    #[test]
    fn signature_keeps_execution_order_and_splits_semicolons() {
        let lines = "bind w +forward\nbind w +back\n";
        let semicolons = "bind w +forward; bind w +back // final binding wins\n";
        let reversed = "bind w +back; bind w +forward\n";
        assert!(gameplay_script_signature(lines).eq(gameplay_script_signature(semicolons)));
        assert!(!gameplay_script_signature(lines).eq(gameplay_script_signature(reversed)));
    }

    #[test]
    fn semicolons_and_comment_markers_inside_quotes_are_data() {
        let actual = gameplay_script_signature("bind x \"say one; say // two\"; volume 0.5\n");
        let expected = gameplay_script_signature("bind x \"say one; say // two\"\nvolume 0.5\n");
        assert!(actual.eq(expected));
    }

    #[test]
    fn semicolon_storm_is_consumed_without_a_retained_command_list() {
        let storm = "volume 1;".repeat(100_000);
        assert_eq!(gameplay_script_signature(&storm).count(), 100_000);
    }
}
