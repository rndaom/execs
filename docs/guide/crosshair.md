# Crosshair

## TF2's crosshairs and custom ones

**TF2's own crosshairs** apply as soon as you pick them; they are just the `cl_crosshair_file` setting. Size and colour save on their own.

**Anything else** (execs shapes, your designs, imported PNGs and VTFs) or **a different crosshair for some weapons** needs the custom pack. **Build crosshair pack** writes a small pack to `tf/custom/execs-crosshairs` from your own copy of TF2's weapon scripts; no Valve art is copied. **Switch to TF2's crosshair** turns the pack off and keeps your custom crosshairs saved.

Custom crosshairs usually work on Valve Casual servers.

## Size on your screen

TF2 draws crosshairs in screen pixels and doesn't scale them with resolution. At size 32, a 64 px sprite covers 64 px whether you play at 1280 × 720 or 2560 × 1440, so it looks smaller at higher resolutions.

The preview uses your game resolution: one you set in execs, then `-w`/`-h` in launch options, then TF2's saved video setting, then your screen. **Actual size** shows exactly the pixels the crosshair covers. Fullscreen below your screen's resolution is stretched to fill the screen, so the crosshair grows with it.

## Designs and imports

The designer makes crosshairs from shapes, gaps, rotation and smooth edges. The outline is always black, so it reads on bright maps; colour is TF2's crosshair colour setting. Share codes let you copy a design and paste it into another one.

Imported PNGs larger than 64 × 64 are fitted into 64 × 64, keeping their shape. VTFs can be up to 512 × 512.

## Messages you may see

- **This pack was changed outside execs**: its pictures may not match what TF2 draws. Rebuild it, or remove it from the ⋯ menu.
- **TF2's weapon scripts changed**: a TF2 update changed them. Rebuild to pick up the update. An older pack without a recorded script version asks you to rebuild once to check it.
- **Another pack also replaces a crosshair image**: TF2 may show that pack's art instead of the picture in execs.
- **A HUD's crosshair overlay**: it draws on top of the crosshair here; turn it off in the HUD's options.

## Not part of TF2's crosshair

Hit markers and team colours aren't TF2 crosshair features. Hit sounds are in **Sounds**, damage numbers in **Gameplay**, and some HUDs add hit markers in their own options.

## Credits

Previously installed Venom Crosshairs are by HbiVnm and their respective creators. Stock crosshair previews are read from your own copy of TF2; Team Fortress 2 and its sprites are © Valve Corporation.
