use super::*;

#[test]
fn later_missing_move_preserves_the_complete_original_tree() {
    let schema = parse_hud_schema(r#"{"Controls":{"Moves":[
        {"Name":"first","Type":"CheckBox","Value":"true","RenameFile":{"OldName":"a_","NewName":"a"}},
        {"Name":"second","Type":"CheckBox","Value":"true","RenameFile":{"OldName":"missing_","NewName":"missing"}}
    ]}}"#).unwrap();
    let mut tree = HudTree::default();
    tree.insert("a_/resource/file.res", vec![1, 2, 3]);
    let original = tree.clone();
    let error =
        apply_hud_options(&mut tree, &schema, "imported-hud", &BTreeMap::new()).unwrap_err();
    assert!(error.to_string().contains("missing_"));
    assert_eq!(tree, original);
}

#[test]
fn unknown_combo_selection_refuses_before_resetting_variants() {
    let schema = parse_hud_schema(
        r#"{"Controls":{"Moves":[
        {"Name":"style","Type":"ComboBox","Value":"a","Options":[
          {"Value":"a","RenameFile":{"OldName":"a_","NewName":"a"}}, {"Value":"none"}
        ]}
    ]}}"#,
    )
    .unwrap();
    let mut tree = HudTree::default();
    tree.insert("a/resource/file.res", vec![1, 2, 3]);
    let original = tree.clone();
    let error = apply_hud_options(
        &mut tree,
        &schema,
        "hud",
        &BTreeMap::from([("style".into(), "unknown".into())]),
    )
    .unwrap_err();
    assert!(error.to_string().contains("Unknown HUD selection"));
    assert_eq!(tree, original);
}

#[test]
fn file_choices_validate_raw_paths_and_required_folders() {
    let base = serde_json::json!({"CustomizationsFolder":"custom","EnabledFolder":"enabled",
      "Controls":{"Moves":[{"Name":"style","Type":"CheckBox","Value":"true","FileName":"a.res"}]}});
    for field in ["CustomizationsFolder", "EnabledFolder", "FileName"] {
        for invalid in ["../outside", "/absolute", "C:\\absolute", "..\\outside", ""] {
            let mut value = base.clone();
            if field == "FileName" {
                value["Controls"]["Moves"][0][field] = invalid.into();
            } else {
                value[field] = invalid.into();
            }
            let schema = parse_hud_schema(&value.to_string()).unwrap();
            let mut tree = HudTree::default();
            tree.insert("custom/a.res", vec![1]);
            let original = tree.clone();
            assert!(
                apply_hud_options(&mut tree, &schema, "hud", &BTreeMap::new()).is_err(),
                "{field}: {invalid}"
            );
            assert_eq!(tree, original);
        }
    }
    for field in ["CustomizationsFolder", "EnabledFolder"] {
        let mut value = base.clone();
        value.as_object_mut().unwrap().remove(field);
        let schema = parse_hud_schema(&value.to_string()).unwrap();
        assert!(
            apply_hud_options(&mut HudTree::default(), &schema, "hud", &BTreeMap::new()).is_err()
        );
    }
}

#[test]
fn directory_moves_preserve_bytes_and_portable_identity() {
    let mut tree = HudTree::default();
    tree.insert("#users/Dane_/resource/ui.res", vec![0, 255, 1]);
    tree.insert("#users/Dane_/nested/file.bin", vec![4, 3, 2]);
    tree.insert("#users/Dane_other/file", vec![9]);
    tree.rename("#users/dane_/", "#users/dane/").unwrap();
    assert_eq!(
        tree.get("#users/dane/resource/ui.res"),
        Some(&[0, 255, 1][..])
    );
    assert_eq!(
        tree.get("#users/dane/nested/file.bin"),
        Some(&[4, 3, 2][..])
    );
    assert!(tree.get("#users/Dane_other/file").is_some());
    let enabled = tree.clone();
    tree.rename("#users/dane_/", "#users/dane/").unwrap();
    assert_eq!(tree, enabled);
    tree.rename("#users/dane/", "#users/dane_/").unwrap();
    assert!(tree.get("#users/dane_/nested/file.bin").is_some());
}

#[test]
fn directory_moves_refuse_collisions_and_invalid_paths_without_mutation() {
    let mut tree = HudTree::default();
    tree.insert("disabled/a.res", vec![1]);
    tree.insert("ENABLED/other.res", vec![2]);
    let original = tree.clone();
    for (from, to) in [
        ("disabled", "enabled"),
        ("disabled", "../outside"),
        ("disabled", "/absolute"),
        ("disabled", "disabled/child"),
        ("missing", "also-missing"),
    ] {
        assert!(tree.rename(from, to).is_err(), "{from} → {to}");
        assert_eq!(tree, original);
    }
    tree.insert("disabled/A.res", vec![3]);
    let original = tree.clone();
    assert!(tree.rename("disabled", "elsewhere").is_err());
    assert_eq!(tree, original);
}

#[test]
fn combo_renames_restore_deselected_variants_and_none() {
    let schema = parse_hud_schema(
        r##"{"Controls":{"Users":[{
        "Name":"user","Type":"ComboBox","Value":"none","Options":[
          {"Value":"none"},
          {"Value":"a","RenameFile":{"OldName":"#users/a_/","NewName":"#users/a/"}},
          {"Value":"b","RenameFile":{"OldName":"#users/b_/","NewName":"#users/b/"}}
        ]}]}}"##,
    )
    .unwrap();
    let mut tree = HudTree::default();
    tree.insert("#users/a_/resource/a.res", vec![1]);
    tree.insert("#users/b_/resource/b.res", vec![2]);
    let initial = tree.clone();
    for value in ["a", "a", "b", "none"] {
        let options = BTreeMap::from([("user".into(), value.into())]);
        apply_hud_options(&mut tree, &schema, "imported-hud", &options).unwrap();
        assert_eq!(tree.get("#users/a/resource/a.res").is_some(), value == "a");
        assert_eq!(tree.get("#users/b/resource/b.res").is_some(), value == "b");
    }
    assert_eq!(tree, initial);
}

#[test]
fn combo_file_and_directory_lists_restore_variants() {
    let schema = parse_hud_schema(
        r#"{"CustomizationsFolder":"customizations","EnabledFolder":"customizations/enabled",
      "Controls":{"Look":[{"Name":"style","Type":"ComboBox","Value":"none",
        "ComboFiles":["a.res"],"ComboDirectories":["b"],"Options":[
          {"Value":"none"},{"Value":"a","FileName":"a.res"},{"Value":"b","FileName":"b/"}
        ]}]}}"#,
    )
    .unwrap();
    let mut tree = HudTree::default();
    tree.insert("customizations/a.res", vec![1]);
    tree.insert("customizations/b/nested/b.res", vec![2]);
    let initial = tree.clone();
    for value in ["a", "b", "b", "none"] {
        apply_hud_options(
            &mut tree,
            &schema,
            "renamed-import",
            &BTreeMap::from([("style".into(), value.into())]),
        )
        .unwrap();
        assert_eq!(
            tree.get("customizations/enabled/a.res").is_some(),
            value == "a"
        );
        assert_eq!(
            tree.get("customizations/enabled/b/nested/b.res").is_some(),
            value == "b"
        );
    }
    assert_eq!(tree, initial);
}

#[test]
fn checkbox_directory_move_is_reversible_and_missing_source_fails() {
    let schema = parse_hud_schema(
        r#"{"Controls":{"Look":[{"Name":"layout","Type":"CheckBox","Value":"false",
      "RenameFile":{"OldName":"layouts/kn_/","NewName":"layouts/kn/"}}]}}"#,
    )
    .unwrap();
    let mut tree = HudTree::default();
    assert!(apply_hud_options(&mut tree, &schema, "kbnhud", &BTreeMap::new()).is_err());
    tree.insert("layouts/kn_/resource/layout.res", vec![5]);
    let initial = tree.clone();
    for value in ["true", "true", "false", "false"] {
        apply_hud_options(
            &mut tree,
            &schema,
            "kbnhud",
            &BTreeMap::from([("layout".into(), value.into())]),
        )
        .unwrap();
        assert_eq!(
            tree.get("layouts/kn/resource/layout.res").is_some(),
            value == "true"
        );
    }
    assert_eq!(tree, initial);
}
