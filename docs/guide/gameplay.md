# Gameplay

Gameplay settings save on their own to the profile's `execs_gameplay.cfg`, which TF2 runs after `config.cfg` every time it starts.

## Field of view

**World FOV** goes from 75 to 90, TF2's own range. If a cfg sets a value outside it (for example 60), TF2 uses the nearest allowed value; execs keeps your cfg's value until you move the slider.

Viewmodel FOV is in **Viewmodels**.

## Mouse

**Sensitivity** and **Zoomed sensitivity ratio** keep the exact decimals you type. TF2's defaults are 3 and 1. The zoomed ratio multiplies sensitivity while you are scoped. Raw input and acceleration are mastercomfig's **Flat mouse** addon.

## Weapons and combat feedback

- **Auto reload**: reload clip weapons when you stop firing.
- **Fast weapon switch**: select a weapon without a confirming click. If a cfg uses another selection mode, execs keeps it until you change the switch.
- **Medigun auto-heal**: click once to heal instead of holding fire.
- **First-person tracers**: bullet tracers from your own weapon. (TF2 refuses the all-tracers setting from cfgs, so execs doesn't offer it.)
- **Damage numbers**, **Combine damage numbers** (hits close together show as one number; needs damage numbers on) and **Healing numbers**.

## Changes made in TF2

If you change these in TF2's Options, execs takes the new values into the profile after the game closes.

## When another cfg sets the same value

If a startup cfg runs after execs' file and sets the same value, the pane warns you and links to that line in Files. Class cfgs and launch options can also set values again when you pick a class or launch TF2.
