# Viewmodels

## In game

- **Viewmodel FOV**: your weapon's perspective, separate from world FOV.
- **Draw viewmodel**, **Min viewmodels** (compact weapon placement) and **Left-handed viewmodels**. TF2 won't change left-handed while you are connected to a server.
- **Transparent viewmodels** is mastercomfig's addon; it needs DirectX 9 and a HUD that supports it, and turns off anti-aliasing.

These save on their own, like Gameplay.

## Per weapon

Each class is one table: a row per weapon slot with its weapons listed beneath it, then inspect animations. Choose **Shown**, **Hidden** or **Hands only** for a whole slot or for one weapon, then **Review and build**. Changing a slot moves the weapons that follow it; a weapon you set on its own keeps its choice. execs builds `tf/custom/execs-viewmodels.vpk` from your own TF2 files; only your first-person view changes, and nothing is written until you build.

**Every class…** applies one choice to the whole profile (show all, hide all, or keep melee visible) and shows exactly what changes before it applies.

Some weapons share animations; those must be set the same before the pack can build.

If TF2 updates its files while you have unbuilt choices, execs keeps them but can't build them against the new files. Discard them to load the new weapons.

## Packs you already have

You can import a viewmodel VPK instead of building one. Profile exports carry the build recipe, not the built model files, so whoever imports the profile builds it from their own TF2.

Custom viewmodels on Valve Casual need the profile's preload launch option; see [Mods → Casual setup](mods.md#casual-setup).
