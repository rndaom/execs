//! Byte-preserving edits to the small cfg surface shared by settings panes.

use crate::profile::ProfileError;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManagedCfgScope {
    Gameplay,
    Crosshair,
    Sounds,
}

impl ManagedCfgScope {
    fn owns(self, name: &[u8]) -> bool {
        let name = name.to_ascii_lowercase();
        match self {
            Self::Gameplay => matches!(
                name.as_slice(),
                b"fov_desired"
                    | b"viewmodel_fov"
                    | b"tf_use_min_viewmodels"
                    | b"r_drawviewmodel"
                    | b"r_drawtracers_firstperson"
                    | b"r_drawtracers"
                    | b"cl_flipviewmodels"
            ),
            Self::Crosshair => matches!(
                name.as_slice(),
                b"cl_crosshair_file"
                    | b"cl_crosshair_scale"
                    | b"cl_crosshair_red"
                    | b"cl_crosshair_green"
                    | b"cl_crosshair_blue"
            ),
            Self::Sounds => matches!(
                name.as_slice(),
                b"tf_dingalingaling"
                    | b"tf_dingalingaling_lasthit"
                    | b"tf_dingaling_pitchmindmg"
                    | b"tf_dingaling_pitchmaxdmg"
                    | b"tf_dingalingaling_effect"
                    | b"tf_dingaling_lasthit_pitchmindmg"
                    | b"tf_dingaling_lasthit_pitchmaxdmg"
                    | b"tf_dingalingaling_last_effect"
                    | b"tf_dingaling_volume"
                    | b"tf_dingaling_lasthit_volume"
                    | b"tf_dingalingaling_repeat_delay"
            ),
        }
    }
}

struct Command<'a> {
    body: &'a [u8],
    trailer: &'a [u8],
}

/// Retain separators and comments as slices; a semicolon-heavy file must not
/// amplify into an allocated vector of commands.
struct Commands<'a> {
    remaining: &'a [u8],
}

impl<'a> Iterator for Commands<'a> {
    type Item = Command<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        let input = self.remaining;
        if input.is_empty() {
            return None;
        }
        let mut quoted = false;
        let mut escaped = false;
        let mut end = input.len();
        let mut consumed = input.len();
        for (i, &byte) in input.iter().enumerate() {
            if byte == b'"' && !escaped {
                quoted = !quoted;
            }
            if !quoted && (byte == b';' || byte == b'\n' || byte == b'\r') {
                end = i;
                consumed = i + 1;
                if byte == b'\r' && input.get(i + 1) == Some(&b'\n') {
                    consumed += 1;
                }
                break;
            }
            if !quoted && byte == b'/' && input.get(i + 1) == Some(&b'/') {
                end = i;
                consumed = input[i..]
                    .iter()
                    .position(|b| *b == b'\n')
                    .map_or(input.len(), |n| i + n + 1);
                break;
            }
            escaped = byte == b'\\' && !escaped;
            if byte != b'\\' {
                escaped = false;
            }
        }
        self.remaining = &input[consumed..];
        Some(Command {
            body: &input[..end],
            trailer: &input[end..consumed],
        })
    }
}

struct Tokens<'a> {
    remaining: &'a [u8],
}
impl Iterator for Tokens<'_> {
    type Item = Vec<u8>;
    fn next(&mut self) -> Option<Vec<u8>> {
        let input = self.remaining.trim_ascii_start();
        if input.is_empty() {
            self.remaining = input;
            return None;
        }
        let mut token = Vec::new();
        let mut quoted = false;
        let mut escaped = false;
        for (i, &byte) in input.iter().enumerate() {
            if byte == b'"' && !escaped {
                quoted = !quoted;
                continue;
            }
            if !quoted && byte.is_ascii_whitespace() {
                self.remaining = &input[i + 1..];
                return Some(token);
            }
            token.push(byte);
            escaped = byte == b'\\' && !escaped;
            if byte != b'\\' {
                escaped = false;
            }
        }
        self.remaining = &[];
        Some(token)
    }
}

pub(crate) fn merge_scope(
    existing: &[u8],
    submitted: &[u8],
    scope: ManagedCfgScope,
) -> Result<Vec<u8>, ProfileError> {
    validate_quotes(existing)?;
    validate_quotes(submitted)?;
    let mut result = Vec::new();
    for command in (Commands {
        remaining: existing,
    }) {
        let owned = (Tokens {
            remaining: command.body,
        })
        .next()
        .is_some_and(|name| scope.owns(&name));
        if owned {
            if matches!(command.trailer, b"\n" | b"\r" | b"\r\n" | b"") {
                continue;
            }
            // Leave the author's comment, separator and leading whitespace.
            let leading = command
                .body
                .iter()
                .take_while(|b| b.is_ascii_whitespace())
                .count();
            result.extend_from_slice(&command.body[..leading]);
        } else {
            result.extend_from_slice(command.body);
        }
        result.extend_from_slice(command.trailer);
    }
    let mut changed = false;
    for command in (Commands {
        remaining: submitted,
    }) {
        let owned = (Tokens {
            remaining: command.body,
        })
        .next()
        .is_some_and(|name| scope.owns(&name));
        if owned {
            if !result.is_empty() && !result.ends_with(b"\n") {
                result.push(b'\n');
            }
            result.extend_from_slice(command.body.trim_ascii());
            result.push(b'\n');
            changed = true;
        }
    }
    if !changed {
        return Err(ProfileError::InvalidPath);
    }
    Ok(result)
}

pub(crate) fn validate_quotes(text: &[u8]) -> Result<(), ProfileError> {
    for command in (Commands { remaining: text }) {
        let mut quoted = false;
        let mut escaped = false;
        for &byte in command.body {
            if byte == b'"' && !escaped {
                quoted = !quoted;
            }
            escaped = byte == b'\\' && !escaped;
            if byte != b'\\' {
                escaped = false;
            }
        }
        if quoted {
            return Err(ProfileError::Io(
                "A cfg has an unfinished quoted value. Fix it in Files before saving settings."
                    .into(),
            ));
        }
    }
    Ok(())
}

pub(crate) fn ensure_exec(existing: &[u8], prefix: &str, stem: &str) -> Vec<u8> {
    let target = format!("{prefix}{stem}");
    let legacy = format!("overrides/{stem}");
    let canonical = format!("exec {target} // execs:managed");
    let mut result = Vec::new();
    let mut found = false;
    for command in (Commands {
        remaining: existing,
    }) {
        let mut tokens = Tokens {
            remaining: command.body,
        };
        let mut migrate = false;
        if tokens
            .next()
            .is_some_and(|name| name.eq_ignore_ascii_case(b"exec"))
        {
            if let Some(exec) = tokens.next() {
                if tokens.next().is_none() {
                    let exec = exec.strip_suffix(b".cfg").unwrap_or(&exec);
                    if exec == target.as_bytes() {
                        found = true;
                    } else if (exec == stem.as_bytes() || exec == legacy.as_bytes())
                        && command.trailer.trim_ascii() == b"// execs:managed"
                    {
                        migrate = true;
                        found = true;
                    }
                }
            }
        }
        if migrate {
            result.extend_from_slice(format!("exec {target} ").as_bytes());
        } else {
            result.extend_from_slice(command.body);
        }
        result.extend_from_slice(command.trailer);
    }
    if !found {
        if !result.is_empty() && !result.ends_with(b"\n") {
            result.push(b'\n');
        }
        result.extend_from_slice(canonical.as_bytes());
        result.push(b'\n');
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_merge_preserves_other_commands_comments_and_quoted_separators() {
        let old = b"// custom \xff\r\nfov_desired 70; cl_crosshair_scale 40 // keep scale\r\necho \"a; // b\"; tf_dingaling_volume 0.2\r\n";
        let changed = merge_scope(
            old,
            b"fov_desired 90; cl_crosshair_scale 1; tf_dingaling_volume 1",
            ManagedCfgScope::Gameplay,
        )
        .unwrap();
        assert_eq!(changed, b"// custom \xff\r\n; cl_crosshair_scale 40 // keep scale\r\necho \"a; // b\"; tf_dingaling_volume 0.2\r\nfov_desired 90\n");
        let changed = merge_scope(
            &changed,
            b"fov_desired 10; cl_crosshair_scale 50",
            ManagedCfgScope::Crosshair,
        )
        .unwrap();
        assert!(changed
            .windows(b"fov_desired 90".len())
            .any(|w| w == b"fov_desired 90"));
        assert!(changed.ends_with(b"cl_crosshair_scale 50\n"));
    }

    #[test]
    fn quoted_command_names_never_masquerade_as_exec() {
        let text = b"\"exec overrides/execs_binds\"\n";
        let result = ensure_exec(text, "overrides/", "execs_binds");
        assert!(result.starts_with(text));
        assert!(result.ends_with(b"exec overrides/execs_binds // execs:managed\n"));
        let multiline = b"alias quoted \"say hello\nexec overrides/execs_binds\n\"\n";
        let result = ensure_exec(multiline, "overrides/", "execs_binds");
        assert!(result.starts_with(multiline));
        assert!(result.ends_with(b"exec overrides/execs_binds // execs:managed\n"));
    }

    #[test]
    fn scoped_merge_is_stable_and_refuses_unfinished_quotes() {
        let input = b"// header\r\nfov_desired 70\r\ncl_crosshair_scale 40\r\n";
        let once = merge_scope(input, b"fov_desired 90\n", ManagedCfgScope::Gameplay).unwrap();
        assert_eq!(
            merge_scope(&once, b"fov_desired 90\n", ManagedCfgScope::Gameplay).unwrap(),
            once
        );
        assert!(merge_scope(
            b"echo \"broken",
            b"fov_desired 90",
            ManagedCfgScope::Gameplay
        )
        .is_err());
        let quoted = br#"echo "escaped \"; // still quoted"; fov_desired 70"#;
        let merged = merge_scope(quoted, b"fov_desired 90", ManagedCfgScope::Gameplay).unwrap();
        assert!(merged.starts_with(br#"echo "escaped \"; // still quoted";"#));
    }

    #[test]
    fn semicolon_heavy_autoexec_streams_without_losing_suffix_exec() {
        let mut text = b"x;".repeat(50_000);
        text.extend_from_slice(b"exec overrides/execs_binds.cfg\n");
        assert_eq!(ensure_exec(&text, "overrides/", "execs_binds"), text);
    }
}
