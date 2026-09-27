//! Native operation eligibility from the player's installed schema. No network.
//! Independently authored from Valve's public field/behavior documentation.
use super::{inherited, object, read_text, string};
use crate::{
    hash::sha256_hex,
    vdf::{parse_hud_vdf, VdfMap},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub struct OperationSchema {
    pub revision: String,
    game: VdfMap,
    attribute_names: BTreeMap<u32, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        let names = [
            "cannot trade",
            "always tradable",
            "never craftable",
            "cannot delete",
            "non economy",
            "expiration date",
            "tradable after date",
            "quest loaner id low",
            "quest loaner id hi",
            "custom name attr",
        ];
        let attrs = names
            .iter()
            .enumerate()
            .map(|(i, name)| format!("\"{i}\" {{ \"name\" \"{name}\" }}"))
            .collect::<Vec<_>>()
            .join("\n");
        let items = (5000..=5002).map(|id| format!("\"{id}\" {{ \"name\" \"metal{id}\" \"craft_material_type\" \"craft_bar\" \"item_class\" \"craft_item\" }}")).collect::<Vec<_>>().join("\n");
        let mut recipes = String::new();
        for (index, input, count, output, out_count) in [
            (4, 5000, 3, 5001, 1),
            (5, 5001, 3, 5002, 1),
            (22, 5001, 1, 5000, 3),
            (23, 5002, 1, 5001, 3),
        ] {
            let criterion = |id| {
                format!("\"conditions\" {{ \"0\" {{ \"field\" \"name\" \"operator\" \"string==\" \"value\" \"metal{id}\" \"required\" \"1\" }} }}")
            };
            let outputs = (1..=out_count)
                .map(|n| format!("\"item{n}\" {{ {} }}", criterion(output)))
                .collect::<Vec<_>>()
                .join("\n");
            recipes.push_str(&format!("\"{index}\" {{ \"disabled\" \"0\" \"premium_only\" \"0\" \"always_known\" \"1\" \"input_items\" {{ \"{count}\" {{ {} }} }} \"output_items\" {{ {outputs} }} }}", criterion(input)));
        }
        format!("\"items_game\" {{ \"attributes\" {{ {attrs} }} \"items\" {{ {items} }} \"recipes\" {{ {recipes} }} }}")
    }

    fn metal() -> EligibilityInput<'static> {
        EligibilityInput {
            definition: 5000,
            quality: 6,
            quantity: Some(1),
            flags: None,
            origin: Some(4),
            in_use: None,
            custom_name: None,
            custom_description: None,
            attributes: vec![],
            has_interior: false,
        }
    }

    #[test]
    fn resolves_recipe_semantics_and_refuses_disabled_or_changed_criteria() {
        let text = fixture();
        let schema = OperationSchema::parse(&text).unwrap();
        for (key, id) in [
            ("combine_scrap", 4),
            ("combine_reclaimed", 5),
            ("smelt_reclaimed", 22),
            ("smelt_refined", 23),
        ] {
            assert_eq!(schema.metal_recipe(key).unwrap().recipe_id, id);
        }
        assert!(schema.metal_recipe("wildcard").is_err());
        let redirected = OperationSchema::parse(&text.replacen(
            "\"4\" { \"disabled\"",
            "\"44\" { \"disabled\"",
            1,
        ))
        .unwrap();
        assert!(redirected.metal_recipe("combine_scrap").is_err());
        for text in [
            text.replace("\"disabled\" \"0\"", "\"disabled\" \"1\""),
            text.replace("\"required\" \"1\"", "\"required\" \"0\""),
            text.replace(
                "\"always_known\" \"1\"",
                "\"always_known\" \"1\" \"future_condition\" \"1\"",
            ),
        ] {
            let changed = OperationSchema::parse(&text).unwrap();
            assert_ne!(changed.revision, schema.revision);
            assert!(changed.metal_recipe("combine_scrap").is_err());
        }
    }

    #[test]
    fn safe_metal_defaults_and_restrictions_are_native() {
        let schema = OperationSchema::parse(&fixture()).unwrap();
        let mut item = metal();
        assert!(schema.eligibility(&item).craftable);
        assert!(schema.eligibility(&item).deletable);
        item.flags = Some(4); // Free-account trading permission is not a restriction.
        assert!(schema.eligibility(&item).craftable);
        item.flags = Some(2);
        assert!(!schema.eligibility(&item).craftable);
        item.flags = Some(8);
        assert!(!schema.eligibility(&item).deletable);
        item.flags = None;
        item.custom_name = Some("keep me");
        assert!(!schema.eligibility(&item).craftable);
        item.custom_name = None;
        item.quantity = None;
        assert!(!schema.eligibility(&item).deletable);
        item.quantity = Some(1);
        item.in_use = Some(true);
        assert!(!schema.eligibility(&item).craftable);
    }

    #[test]
    fn duplicate_unknown_and_temporary_attributes_refuse_consumption() {
        let schema = OperationSchema::parse(&fixture()).unwrap();
        let value = 0u32.to_le_bytes();
        let mut item = metal();
        for attributes in [
            vec![(999, &value[..])],
            vec![(3, &value[..])],
            vec![(3, &value[..]), (3, &value[..])],
            vec![(5, &value[..])],
            vec![(7, &value[..])],
        ] {
            item.attributes = attributes;
            assert!(!schema.eligibility(&item).deletable);
        }
        item.attributes = vec![(2, &value[..])]; // existence matters, even a zero value
        assert!(!schema.eligibility(&item).craftable);
        let expiry = u32::MAX.to_le_bytes();
        item.attributes = vec![(6, &expiry[..])];
        assert!(!schema.eligibility(&item).tradable);
    }

    #[test]
    fn static_restrictions_and_missing_prefabs_are_not_ignored() {
        let text = fixture().replace(
            "\"name\" \"metal5000\"",
            "\"name\" \"metal5000\" \"static_attrs\" { \"cannot delete\" \"1\" }",
        );
        assert!(
            !OperationSchema::parse(&text)
                .unwrap()
                .eligibility(&metal())
                .deletable
        );
        let text = fixture().replace(
            "\"name\" \"metal5000\"",
            "\"name\" \"metal5000\" \"prefab\" \"missing\"",
        );
        assert!(
            !OperationSchema::parse(&text)
                .unwrap()
                .eligibility(&metal())
                .craftable
        );
    }

    #[test]
    fn optional_installed_schema_read_only() {
        let Some(root) = std::env::var_os("EXECS_TEST_INVENTORY_SCHEMA_ROOT") else {
            return;
        };
        let schema = OperationSchema::load(Path::new(&root)).unwrap();
        for key in [
            "combine_scrap",
            "combine_reclaimed",
            "smelt_reclaimed",
            "smelt_refined",
        ] {
            let recipe = schema.metal_recipe(key).unwrap();
            assert!(recipe.recipe_id >= 0);
            assert!(
                schema
                    .eligibility(&EligibilityInput {
                        definition: recipe.input_definition,
                        ..metal()
                    })
                    .craftable
            );
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MetalRecipe {
    pub recipe_id: i16,
    pub input_definition: u32,
    pub input_count: usize,
    pub output_definition: u32,
    pub output_count: usize,
}

pub struct EligibilityInput<'a> {
    pub definition: u32,
    pub quality: u32,
    pub quantity: Option<u32>,
    pub flags: Option<u32>,
    pub origin: Option<u32>,
    pub in_use: Option<bool>,
    pub custom_name: Option<&'a str>,
    pub custom_description: Option<&'a str>,
    pub attributes: Vec<(u32, &'a [u8])>,
    pub has_interior: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Eligibility {
    pub craftable: bool,
    pub tradable: bool,
    pub customized: bool,
    pub deletable: bool,
    pub reason: Option<String>,
}

impl Eligibility {
    fn refused(reason: impl Into<String>) -> Self {
        Self {
            craftable: false,
            tradable: false,
            customized: true,
            deletable: false,
            reason: Some(reason.into()),
        }
    }
}

fn unique(map: &VdfMap) -> Result<(), String> {
    let mut keys = BTreeSet::new();
    for (index, (key, _)) in map.entries.iter().enumerate() {
        if map.condition_at(index).is_some() || !keys.insert(key.to_ascii_lowercase()) {
            return Err(format!(
                "Ambiguous or conditional operation schema field: {key}"
            ));
        }
    }
    Ok(())
}

fn exact_name_condition(map: &VdfMap, name: &str) -> bool {
    if unique(map).is_err() || map.entries.len() != 1 {
        return false;
    }
    let Some(conditions) = object(map, "conditions") else {
        return false;
    };
    if unique(conditions).is_err() || conditions.entries.len() != 1 {
        return false;
    }
    let Some(condition) = conditions.entries[0].1.as_obj() else {
        return false;
    };
    unique(condition).is_ok()
        && condition.entries.len() == 4
        && string(condition, "field") == Some("name")
        && string(condition, "operator") == Some("string==")
        && string(condition, "value") == Some(name)
        && string(condition, "required") == Some("1")
}

impl OperationSchema {
    pub fn load(root: &Path) -> Result<Self, String> {
        Self::parse(&read_text(root, "scripts/items/items_game.txt")?)
    }

    fn parse(text: &str) -> Result<Self, String> {
        let schema = parse_hud_vdf(text)?;
        unique(&schema)?;
        let game = object(&schema, "items_game")
            .ok_or("Missing item schema")?
            .clone();
        unique(&game)?;
        let attributes = object(&game, "attributes").ok_or("Missing attribute schema")?;
        unique(attributes)?;
        let mut attribute_names = BTreeMap::new();
        let mut names = BTreeSet::new();
        for (id, value) in &attributes.entries {
            let Some(attribute) = value.as_obj() else {
                continue;
            };
            // Display-only fields in Valve's schema can repeat. Only the
            // restriction identity is used here and must be unconditional/unique.
            let fields: Vec<_> = attribute
                .entries
                .iter()
                .enumerate()
                .filter(|(_, (key, _))| key.eq_ignore_ascii_case("name"))
                .collect();
            if fields.len() != 1 || attribute.condition_at(fields[0].0).is_some() {
                return Err("Ambiguous attribute identity".into());
            }
            let name = string(attribute, "name").ok_or("Missing attribute name")?;
            let id = id.parse().map_err(|_| "Invalid attribute index")?;
            if !names.insert(name.to_owned()) {
                return Err("Duplicate attribute name".into());
            }
            attribute_names.insert(id, name.to_owned());
        }
        for required in [
            "cannot trade",
            "always tradable",
            "never craftable",
            "cannot delete",
            "non economy",
            "expiration date",
            "tradable after date",
            "quest loaner id low",
            "quest loaner id hi",
        ] {
            if !names.contains(required) {
                return Err(format!("Missing restriction definition: {required}"));
            }
        }
        Ok(Self {
            revision: sha256_hex(text.as_bytes()),
            game,
            attribute_names,
        })
    }

    fn definition(&self, id: u32) -> Result<VdfMap, String> {
        let items = object(&self.game, "items").ok_or("Missing item definitions")?;
        let key = id.to_string();
        if items
            .entries
            .iter()
            .filter(|(name, _)| name == &key)
            .count()
            != 1
        {
            return Err("Missing or duplicate item definition".into());
        }
        let item = object(items, &key).ok_or("Invalid item definition")?;
        self.checked_inheritance(item, 0)
    }

    fn checked_inheritance(&self, item: &VdfMap, depth: usize) -> Result<VdfMap, String> {
        if depth > 16 {
            return Err("Item inheritance exceeds limit".into());
        }
        unique(item)?;
        let empty = VdfMap::default();
        let prefabs = object(&self.game, "prefabs").unwrap_or(&empty);
        for name in string(item, "prefab").unwrap_or("").split_whitespace() {
            if prefabs
                .entries
                .iter()
                .filter(|(key, _)| key == name)
                .count()
                != 1
            {
                return Err("Missing or ambiguous item prefab".into());
            }
            self.checked_inheritance(object(prefabs, name).ok_or("Missing prefab")?, depth + 1)?;
        }
        inherited(item, prefabs, 0)
    }

    pub fn metal_recipe(&self, key: &str) -> Result<MetalRecipe, String> {
        // A locally changed schema cannot redirect a supported conversion to
        // another GC recipe. Both the supported index and exact criteria match.
        let (expected_index, input_definition, input_count, output_definition, output_count) =
            match key {
                "combine_scrap" => (4, 5000, 3, 5001, 1),
                "combine_reclaimed" => (5, 5001, 3, 5002, 1),
                "smelt_reclaimed" => (22, 5001, 1, 5000, 3),
                "smelt_refined" => (23, 5002, 1, 5001, 3),
                _ => return Err("Unsupported metal recipe".into()),
            };
        let input = self.definition(input_definition)?;
        let output = self.definition(output_definition)?;
        for item in [&input, &output] {
            if string(item, "craft_material_type") != Some("craft_bar")
                || string(item, "item_class") != Some("craft_item")
            {
                return Err("Installed metal definition changed".into());
            }
        }
        let input_name = string(&input, "name").ok_or("Missing input name")?;
        let output_name = string(&output, "name").ok_or("Missing output name")?;
        let recipes = object(&self.game, "recipes").ok_or("Missing recipes")?;
        unique(recipes)?;
        let mut matches = Vec::new();
        for (id, value) in &recipes.entries {
            let Some(recipe) = value.as_obj() else {
                continue;
            };
            if unique(recipe).is_err()
                || string(recipe, "disabled") != Some("0")
                || string(recipe, "premium_only") != Some("0")
                || string(recipe, "always_known") != Some("1")
            {
                continue;
            }
            // Reject new semantic fields rather than assuming they are cosmetic.
            if recipe.entries.iter().any(|(key, _)| {
                !matches!(
                    key.as_str(),
                    "name"
                        | "n_A"
                        | "desc_inputs"
                        | "desc_outputs"
                        | "di_A"
                        | "di_B"
                        | "do_A"
                        | "do_B"
                        | "always_known"
                        | "premium_only"
                        | "disabled"
                        | "input_items"
                        | "output_items"
                        | "category"
                )
            }) {
                continue;
            }
            let Some(inputs) = object(recipe, "input_items") else {
                continue;
            };
            let Some(outputs) = object(recipe, "output_items") else {
                continue;
            };
            if unique(inputs).is_err()
                || unique(outputs).is_err()
                || inputs.entries.len() != 1
                || outputs.entries.len() != output_count
            {
                continue;
            }
            if inputs.entries[0].0.parse::<usize>().ok() != Some(input_count)
                || !inputs.entries[0]
                    .1
                    .as_obj()
                    .is_some_and(|item| exact_name_condition(item, input_name))
                || !outputs.entries.iter().all(|(_, value)| {
                    value
                        .as_obj()
                        .is_some_and(|item| exact_name_condition(item, output_name))
                })
            {
                continue;
            }
            let recipe_id: i16 = id.parse().map_err(|_| "Invalid recipe index")?;
            if recipe_id < 0 {
                return Err("Wildcard recipe refused".into());
            }
            matches.push(recipe_id);
        }
        if matches.len() != 1 || matches[0] != expected_index {
            return Err("The installed schema has no unambiguous supported metal recipe".into());
        }
        Ok(MetalRecipe {
            recipe_id: matches[0],
            input_definition,
            input_count,
            output_definition,
            output_count,
        })
    }

    pub fn eligibility(&self, item: &EligibilityInput<'_>) -> Eligibility {
        self.checked_eligibility(item)
            .unwrap_or_else(Eligibility::refused)
    }

    fn checked_eligibility(&self, item: &EligibilityInput<'_>) -> Result<Eligibility, String> {
        let definition = self.definition(item.definition)?;
        let flags = item.flags.unwrap_or(0); // explicit protobuf default
        if flags & !31 != 0
            || item.origin.is_none_or(|origin| origin > 29)
            || item.quantity != Some(1)
            || item.has_interior
            || item.in_use.unwrap_or(false)
        {
            return Err("Incomplete, stacked, in-use or unsupported item state".into());
        }
        let mut names: BTreeMap<String, Option<u32>> = BTreeMap::new();
        if item.attributes.len() > 256 {
            return Err("Too many item attributes".into());
        }
        for (id, bytes) in &item.attributes {
            let name = self
                .attribute_names
                .get(id)
                .ok_or("Unknown item attribute")?;
            if bytes.len() > 4096
                || names
                    .insert(
                        name.clone(),
                        (*bytes).try_into().ok().map(u32::from_le_bytes),
                    )
                    .is_some()
            {
                return Err("Ambiguous item attributes".into());
            }
        }
        for section in ["static_attrs", "attributes"] {
            if let Some(attrs) = object(&definition, section) {
                unique(attrs)?;
                for (name, value) in &attrs.entries {
                    if !self.attribute_names.values().any(|known| known == name) {
                        return Err("Unknown static item attribute".into());
                    }
                    let text = value
                        .as_str()
                        .or_else(|| value.as_obj().and_then(|map| string(map, "value")));
                    names
                        .entry(name.clone())
                        .or_insert_with(|| text.and_then(|value| value.parse::<u32>().ok()));
                }
            }
        }
        let has = |name: &str| names.contains_key(name);
        let temporary = matches!(item.origin, Some(17 | 24))
            || has("quest loaner id low")
            || has("quest loaner id hi")
            || has("expiration date")
            || string(&definition, "expiration_date").is_some();
        let non_economy = flags & 8 != 0 || has("non economy");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Invalid system clock")?
            .as_secs();
        let trade_hold = names
            .get("tradable after date")
            .is_some_and(|time| time.is_none_or(|time| u64::from(time) >= now));
        let tradable = !temporary
            && !non_economy
            && !trade_hold
            && (has("always tradable")
                || (flags & 1 == 0
                    && !has("cannot trade")
                    && !matches!(item.origin, Some(1 | 14 | 17 | 18 | 29))
                    && !(7..=9).contains(&item.quality)));
        let customized = item.custom_name.is_some_and(|s| !s.is_empty())
            || item.custom_description.is_some_and(|s| !s.is_empty())
            || names.keys().any(|name| {
                !matches!(
                    name.as_str(),
                    "always tradable" | "cannot trade" | "never craftable" | "tradable after date"
                )
            });
        // Only plain, tradable Unique metal is supported by this first live recipe family.
        let craftable = matches!(item.definition, 5000..=5002)
            && item.quality == 6
            && tradable
            && !customized
            && flags & 2 == 0
            && !has("never craftable")
            && !matches!(item.origin, Some(2 | 5 | 14 | 18));
        let deletable = !temporary && !non_economy && !has("cannot delete") && item.quality != 0;
        Ok(Eligibility {
            craftable,
            tradable,
            customized,
            deletable,
            reason: if !deletable {
                Some("This item has a deletion restriction or temporary/non-economy state.".into())
            } else {
                (!craftable).then(|| {
                    "Only plain, tradable metal with complete eligibility can be crafted here."
                        .into()
                })
            },
        })
    }
}
