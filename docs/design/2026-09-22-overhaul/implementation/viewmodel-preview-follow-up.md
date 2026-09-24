# Hands-only Viewmodels preview follow-up

The development UI distinguishes Show, Hide weapon, and Hide all. Its pinned CompVMInstaller image source supplies a stock screenshot for each group and a no-viewmodel screenshot for each class; it does not supply hands-only captures. Hide weapon explains that the built pack hides the weapon and keeps the hands visible. The pane shows no hands-only image because an accurate capture is not available.

The intended follow-up is a genuine hands-only image per supported class/group. Build each mode with the existing isolated model pipeline, render the compiled model with the player's installed TF2 assets in an isolated viewer, then compare representative captures to the game before shipping them as previews. The preview cache should bind to the input model and build version so a TF2 update cannot leave stale imagery. This does not require running the player's profile or writing to the live TF2 tree.

Valve's [Source model viewer documentation](https://developer.valvesoftware.com/wiki/Half-Life_Model_Viewer_%28Source%29) describes a model screenshot option, but also notes reliability and game-directory constraints. Those constraints need a prototype and verification before it can be adopted as a capture pipeline. An edited image would not establish that the compiled weapon-only mode appears exactly as drawn.
