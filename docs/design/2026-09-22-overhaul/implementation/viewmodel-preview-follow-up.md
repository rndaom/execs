# Hands-only Viewmodels preview follow-up

Earlier development UI distinguished Show, Hide weapon and Hide all. It fetched pinned CompVMInstaller screenshots for stock and no-viewmodel states, but had no verified hands-only captures. That fetch and the 64-group builder are retired in the current development branch. The current Viewmodels pane imports user-provided VPKs and makes no rendered preview claim.

A future rights-cleared builder would need a genuine hands-only image per supported class/group. Build each mode with its own verified isolated model pipeline, render the compiled model with the player's installed TF2 assets in an isolated viewer, then compare representative captures to the game before shipping them as previews. A preview cache should bind to the input model and build version so a TF2 update cannot leave stale imagery. This does not require running the player's profile or writing to the live TF2 tree.

Valve's [Source model viewer documentation](https://developer.valvesoftware.com/wiki/Half-Life_Model_Viewer_%28Source%29) describes a model screenshot option, but also notes reliability and game-directory constraints. Those constraints need a prototype and verification before it can be adopted as a capture pipeline. An edited image would not establish that the compiled weapon-only mode appears exactly as drawn.
