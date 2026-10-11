# Mods

Mods has three parts: **Browse** (GameBanana), **Custom packs** (what this profile has in `tf/custom`) and **Casual setup**.

## Browse

Listings and files come from [GameBanana](https://gamebanana.com/games/297); every mod belongs to its author.

- **Mods** and **Sounds** are GameBanana's two TF2 sections; each has its own categories.
- **Popular**, **Likes** and **Views** use GameBanana's all-time counts. **Updated** and **New** use the dates GameBanana shows. With no category picked, totals are estimates, because execs hides categories it can't install (decal tools, prefabs, server weapons).
- **Maps** install into the pack's `maps` folder, with their bot navigation and MvM missions. Play one with `map` and the map's name in the console, offline or on a server you host.
- **HUDs** go to the HUD pane. Other GUI mods (menus, icons, fonts, loading screens) install like any mod.
- **Hit and kill sounds** open in Sounds instead of installing.

When a mod has several files, execs lists them with their names, sizes and dates so you can pick one. Split uploads (part 1, part 2…) can't be joined by execs; follow the author's instructions and use **Import mod** with the extracted files.

## Installing and importing

**Import mod** takes a VPK, a ZIP, 7z or RAR, or a folder you already extracted. Inside an archive, execs lists each VPK and content folder it can install, with its size and the author's readme. Each part you pick installs as its own pack; when the author offers alternatives (colours of the same thing, say), pick only one.

A part that would also replace TF2's hit or kill sound says so and isn't picked for you, since it would override your choice in Sounds. A split or unreadable VPK is greyed out with the reason; the rest of the archive still installs.

## Custom packs

- **Turn a pack off** to keep it in the profile without TF2 loading it.
- **Copy to another profile** copies the saved pack without downloading it again.
- **Check for updates** compares GameBanana packs with their listing.
- A pack used by Casual setup can't be turned off or removed until you change that selection.

**File check** lists files that several packs share. TF2 uses the pack whose name comes first alphabetically; maps and servers can still change what you see. It also points out models assembled from different packs, which may not fit together (broken ragdolls, for example), and packs that replace TF2's sound scripts, which can leave newer weapons silent after a TF2 update.

## Casual setup

Valve's Casual servers use sv_pure, which normally blocks custom materials and particles. Casual setup gets selected ones through:

- **Preload on launch**: TF2 opens the offline itemtest map once at startup to load your content, then returns to the menu.
- **Material bypass**: edits one line in `gameinfo.txt` so preloaded materials stay active. The original is backed up first.
- **Casual selection**: the addons (Flat Textures, Developer Textures, No Burning Overlay, No Sentry Shield Overlay) and particle sources from your installed mods. Changes wait in a bar at the bottom of the page: **Apply changes** downloads the addons' verified author files, packs them into your preload addon and patches the particle files, and **Discard changes** goes back. Applying turns Preload on.

**Your packs on Casual** says what each custom pack in the profile can do on Casual servers.

Each particle file comes whole from one mod; overlapping files aren't merged. When two sources supply the same file, execs shows which one wins and lets you choose. Particles from your own mods always win over library particles.

**Restore stock files…** puts back the original particle files and `gameinfo.txt` and removes the Casual addon pack. Your mods stay in the profile.

Choices saved from the old cueki library still show and can be removed. They reapply only while their original download is still on this PC; the library itself is retired.

### Credits

[Flat Textures](https://gamebanana.com/mods/295065) by flewvar, with textures credited to JarateKing. [Developer Textures Overhaul v2](https://gamebanana.com/mods/336110), reworked by FPS_Engineer from a pack reuploaded and continued by ayrtonSilna (the original creator is unidentified). The two overlay choices from [Square Series](https://gamebanana.com/mods/435309), submitted by ghytd. Casual setup is built on the ideas of [casual-pre-loader](https://github.com/cueki/casual-pre-loader).
