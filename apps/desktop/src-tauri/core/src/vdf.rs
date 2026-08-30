//! Minimal Valve KeyValues (VDF) reader for Steam library files.

use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VdfValue {
    Str(String),
    Obj(VdfMap),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VdfMap {
    pub entries: Vec<(String, VdfValue)>,
}

impl VdfValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Str(s) => Some(s),
            Self::Obj(_) => None,
        }
    }

    pub fn as_obj(&self) -> Option<&VdfMap> {
        match self {
            Self::Obj(map) => Some(map),
            Self::Str(_) => None,
        }
    }
}

impl VdfMap {
    /// Last matching key wins. Comparison is ASCII case-insensitive.
    pub fn get(&self, key: &str) -> Option<&VdfValue> {
        self.entries
            .iter()
            .rev()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v)
    }

    /// Set a nested string, creating missing objects. Last key is the leaf.
    /// Existing keys are matched ASCII case-insensitively; new keys use `keys` as given.
    pub fn set_path(&mut self, keys: &[&str], value: impl Into<String>) {
        if keys.is_empty() {
            return;
        }
        set_path_rec(self, keys, value.into());
    }

    /// Merge `other` into this map. Objects recurse; strings overwrite the last matching key.
    pub fn merge_from(&mut self, other: &VdfMap) {
        for (key, value) in &other.entries {
            match value {
                VdfValue::Str(text) => {
                    if let Some((_, existing)) = self
                        .entries
                        .iter_mut()
                        .rev()
                        .find(|(k, _)| k.eq_ignore_ascii_case(key))
                    {
                        *existing = VdfValue::Str(text.clone());
                    } else {
                        self.entries
                            .push((key.clone(), VdfValue::Str(text.clone())));
                    }
                }
                VdfValue::Obj(obj) => {
                    let idx = match self.entries.iter().rposition(|(k, _)| k.eq_ignore_ascii_case(key))
                    {
                        Some(i) => {
                            if !matches!(self.entries[i].1, VdfValue::Obj(_)) {
                                self.entries[i].1 = VdfValue::Obj(VdfMap::default());
                            }
                            i
                        }
                        None => {
                            self.entries
                                .push((key.clone(), VdfValue::Obj(VdfMap::default())));
                            self.entries.len() - 1
                        }
                    };
                    let VdfValue::Obj(child) = &mut self.entries[idx].1 else {
                        unreachable!("merge_from created an object for {key}");
                    };
                    child.merge_from(obj);
                }
            }
        }
    }
}

fn set_path_rec(map: &mut VdfMap, keys: &[&str], value: String) {
    let key = keys[0];
    if keys.len() == 1 {
        if let Some((_, existing)) = map
            .entries
            .iter_mut()
            .rev()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
        {
            *existing = VdfValue::Str(value);
        } else {
            map.entries.push((key.to_string(), VdfValue::Str(value)));
        }
        return;
    }

    let idx = match map
        .entries
        .iter()
        .rposition(|(k, _)| k.eq_ignore_ascii_case(key))
    {
        Some(i) => {
            if !matches!(map.entries[i].1, VdfValue::Obj(_)) {
                map.entries[i].1 = VdfValue::Obj(VdfMap::default());
            }
            i
        }
        None => {
            map.entries
                .push((key.to_string(), VdfValue::Obj(VdfMap::default())));
            map.entries.len() - 1
        }
    };
    let VdfValue::Obj(child) = &mut map.entries[idx].1 else {
        unreachable!("set_path created an object for {key}");
    };
    set_path_rec(child, &keys[1..], value);
}

/// Quoted KeyValues. Objects use the Steam brace-on-next-line layout.
pub fn serialize_vdf(map: &VdfMap) -> String {
    let mut out = String::new();
    write_map(&mut out, map, 0);
    out
}

fn write_map(out: &mut String, map: &VdfMap, indent: usize) {
    for (key, value) in &map.entries {
        write_indent(out, indent);
        write_quoted(out, key);
        match value {
            VdfValue::Str(s) => {
                out.push_str("\t\t");
                write_quoted(out, s);
                out.push('\n');
            }
            VdfValue::Obj(obj) => {
                out.push('\n');
                write_indent(out, indent);
                out.push_str("{\n");
                write_map(out, obj, indent + 1);
                write_indent(out, indent);
                out.push_str("}\n");
            }
        }
    }
}

fn write_indent(out: &mut String, n: usize) {
    for _ in 0..n {
        out.push('\t');
    }
}

fn write_quoted(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            other => out.push(other),
        }
    }
    out.push('"');
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamLibrary {
    pub path: String,
    pub apps: HashSet<String>,
}

pub fn parse_vdf(input: &str) -> Result<VdfMap, String> {
    let mut parser = Parser {
        chars: input.chars().collect(),
        i: 0,
    };
    let map = parser.parse_pairs_until_end(false)?;
    parser.skip_ws_and_comments();
    if parser.peek().is_some() {
        return Err("unexpected trailing VDF content".into());
    }
    Ok(map)
}

/// Libraries listed in `libraryfolders.vdf` (modern objects or old numeric paths).
pub fn steam_libraries(vdf: &VdfMap) -> Vec<SteamLibrary> {
    let root = vdf
        .get("libraryfolders")
        .or_else(|| vdf.get("LibraryFolders"))
        .and_then(VdfValue::as_obj)
        .unwrap_or(vdf);

    let mut out = Vec::new();
    for (key, value) in &root.entries {
        match value {
            VdfValue::Str(path) if is_index_key(key) => {
                out.push(SteamLibrary {
                    path: path.clone(),
                    apps: HashSet::new(),
                });
            }
            VdfValue::Obj(obj) => {
                let Some(path) = obj.get("path").and_then(VdfValue::as_str) else {
                    continue;
                };
                let mut apps = HashSet::new();
                if let Some(app_obj) = obj.get("apps").and_then(VdfValue::as_obj) {
                    for (app_id, _) in &app_obj.entries {
                        apps.insert(app_id.clone());
                    }
                }
                out.push(SteamLibrary {
                    path: path.to_string(),
                    apps,
                });
            }
            _ => {}
        }
    }
    out
}

pub fn installdir_from_acf(text: &str) -> Option<String> {
    let vdf = parse_vdf(text).ok()?;
    let state = vdf.get("AppState")?.as_obj()?;
    state.get("installdir")?.as_str().map(str::to_string)
}

fn is_index_key(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_ascii_digit())
}

struct Parser {
    chars: Vec<char>,
    i: usize,
}

impl Parser {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.i).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let ch = self.peek()?;
        self.i += 1;
        Some(ch)
    }

    fn skip_ws_and_comments(&mut self) {
        loop {
            while self.peek().is_some_and(|c| c.is_whitespace()) {
                self.bump();
            }
            if self.starts_with("//") {
                while self.peek().is_some_and(|c| c != '\n') {
                    self.bump();
                }
                continue;
            }
            if self.starts_with("/*") {
                self.i += 2;
                while self.peek().is_some() && !self.starts_with("*/") {
                    self.bump();
                }
                if self.starts_with("*/") {
                    self.i += 2;
                }
                continue;
            }
            break;
        }
    }

    fn starts_with(&self, s: &str) -> bool {
        let rest = &self.chars[self.i..];
        s.chars()
            .enumerate()
            .all(|(idx, ch)| rest.get(idx) == Some(&ch))
    }

    fn parse_pairs_until_end(&mut self, stop_on_brace: bool) -> Result<VdfMap, String> {
        let mut entries = Vec::new();
        loop {
            self.skip_ws_and_comments();
            match self.peek() {
                None => break,
                Some('}') if stop_on_brace => break,
                Some('}') => return Err("unexpected } in VDF".into()),
                _ => {}
            }
            let key = self.parse_string()?;
            let value = self.parse_value()?;
            entries.push((key, value));
        }
        Ok(VdfMap { entries })
    }

    fn parse_value(&mut self) -> Result<VdfValue, String> {
        self.skip_ws_and_comments();
        if self.peek() == Some('{') {
            self.bump();
            let obj = self.parse_pairs_until_end(true)?;
            self.skip_ws_and_comments();
            if self.bump() != Some('}') {
                return Err("expected } closing VDF object".into());
            }
            return Ok(VdfValue::Obj(obj));
        }
        Ok(VdfValue::Str(self.parse_string()?))
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.skip_ws_and_comments();
        if self.peek() == Some('"') {
            self.bump();
            let mut out = String::new();
            loop {
                match self.bump() {
                    None => return Err("unterminated VDF string".into()),
                    Some('"') => return Ok(out),
                    Some('\\') => match self.bump() {
                        Some('n') => out.push('\n'),
                        Some('t') => out.push('\t'),
                        Some('r') => out.push('\r'),
                        Some(other) => out.push(other),
                        None => return Err("unterminated VDF escape".into()),
                    },
                    Some(ch) => out.push(ch),
                }
            }
        }
        let mut out = String::new();
        while let Some(ch) = self.peek() {
            if ch.is_whitespace() || ch == '{' || ch == '}' {
                break;
            }
            out.push(ch);
            self.bump();
        }
        if out.is_empty() {
            return Err("expected VDF string".into());
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODERN: &str = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps"
		{
			"228980"		"1"
			"440"		"12345"
		}
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
		"apps"
		{
			"730"		"9"
		}
	}
}
"#;

    const OLD: &str = r#"
"LibraryFolders"
{
	"TimeNextStatsReport"		"123"
	"ContentStatsID"		"456"
	"1"		"D:\\SteamLibrary"
	"2"		"E:\\Games"
}
"#;

    #[test]
    fn parses_modern_libraryfolders() {
        let vdf = parse_vdf(MODERN).unwrap();
        let libs = steam_libraries(&vdf);
        assert_eq!(libs.len(), 2);
        assert_eq!(libs[0].path, r"C:\Program Files (x86)\Steam");
        assert!(libs[0].apps.contains("440"));
        assert_eq!(libs[1].path, r"D:\SteamLibrary");
        assert!(!libs[1].apps.contains("440"));
    }

    #[test]
    fn parses_old_numeric_libraryfolders() {
        let vdf = parse_vdf(OLD).unwrap();
        let libs = steam_libraries(&vdf);
        assert_eq!(
            libs.iter().map(|l| l.path.as_str()).collect::<Vec<_>>(),
            vec![r"D:\SteamLibrary", r"E:\Games"]
        );
    }

    #[test]
    fn reads_installdir_from_acf() {
        let acf = r#"
"AppState"
{
	"appid"		"440"
	"installdir"		"Team Fortress 2"
}
"#;
        assert_eq!(installdir_from_acf(acf).as_deref(), Some("Team Fortress 2"));
    }

    #[test]
    fn skips_line_comments() {
        let vdf = parse_vdf(
            r#"
// header
"libraryfolders"
{
	// inner
	"0"		"/games/steam"
}
"#,
        )
        .unwrap();
        let libs = steam_libraries(&vdf);
        assert_eq!(libs[0].path, "/games/steam");
    }

    #[test]
    fn set_path_creates_objects_and_updates_leaf() {
        let mut map = VdfMap::default();
        map.set_path(
            &[
                "UserLocalConfigStore",
                "Software",
                "Valve",
                "Steam",
                "apps",
                "440",
                "LaunchOptions",
            ],
            "-novid",
        );
        map.set_path(
            &[
                "UserLocalConfigStore",
                "Software",
                "Valve",
                "Steam",
                "apps",
                "440",
                "LastPlayed",
            ],
            "123",
        );
        map.set_path(
            &[
                "UserLocalConfigStore",
                "Software",
                "Valve",
                "Steam",
                "apps",
                "440",
                "LaunchOptions",
            ],
            "-console",
        );

        let store = map.get("UserLocalConfigStore").unwrap().as_obj().unwrap();
        let apps = store
            .get("Software")
            .and_then(VdfValue::as_obj)
            .and_then(|software| software.get("Valve"))
            .and_then(VdfValue::as_obj)
            .and_then(|valve| valve.get("Steam"))
            .and_then(VdfValue::as_obj)
            .and_then(|steam| steam.get("apps"))
            .and_then(VdfValue::as_obj)
            .and_then(|apps| apps.get("440"))
            .and_then(VdfValue::as_obj)
            .unwrap();
        assert_eq!(
            apps.get("LaunchOptions").and_then(VdfValue::as_str),
            Some("-console")
        );
        assert_eq!(
            apps.get("LastPlayed").and_then(VdfValue::as_str),
            Some("123")
        );
    }

    #[test]
    fn serialize_round_trips_launch_options() {
        let original = r#""UserLocalConfigStore"
{
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"apps"
				{
					"440"
					{
						"LastPlayed"		"9"
						"LaunchOptions"		"-novid"
					}
				}
			}
		}
	}
}
"#;
        let mut vdf = parse_vdf(original).unwrap();
        vdf.set_path(
            &[
                "UserLocalConfigStore",
                "Software",
                "Valve",
                "Steam",
                "apps",
                "440",
                "LaunchOptions",
            ],
            "-novid -nojoy",
        );
        let text = serialize_vdf(&vdf);
        let again = parse_vdf(&text).unwrap();
        assert_eq!(again, vdf);
        let app = again
            .get("UserLocalConfigStore")
            .and_then(VdfValue::as_obj)
            .and_then(|store| store.get("Software"))
            .and_then(VdfValue::as_obj)
            .and_then(|software| software.get("Valve"))
            .and_then(VdfValue::as_obj)
            .and_then(|valve| valve.get("Steam"))
            .and_then(VdfValue::as_obj)
            .and_then(|steam| steam.get("apps"))
            .and_then(VdfValue::as_obj)
            .and_then(|apps| apps.get("440"))
            .and_then(VdfValue::as_obj)
            .unwrap();
        assert_eq!(
            app.get("LaunchOptions").and_then(VdfValue::as_str),
            Some("-novid -nojoy")
        );
        assert_eq!(app.get("LastPlayed").and_then(VdfValue::as_str), Some("9"));
    }

    #[test]
    fn merge_from_updates_nested_strings() {
        let mut base = parse_vdf(
            r#""Scheme"
{
	"Colors"
	{
		"Health"		"255 0 0 255"
		"Keep"		"1 2 3 4"
	}
}
"#,
        )
        .unwrap();
        let patch = parse_vdf(
            r#""Scheme"
{
	"Colors"
	{
		"Health"		"0 153 255 255"
	}
}
"#,
        )
        .unwrap();
        base.merge_from(&patch);
        let colors = base
            .get("Scheme")
            .and_then(VdfValue::as_obj)
            .and_then(|scheme| scheme.get("Colors"))
            .and_then(VdfValue::as_obj)
            .unwrap();
        assert_eq!(
            colors.get("Health").and_then(VdfValue::as_str),
            Some("0 153 255 255")
        );
        assert_eq!(colors.get("Keep").and_then(VdfValue::as_str), Some("1 2 3 4"));
    }
}
