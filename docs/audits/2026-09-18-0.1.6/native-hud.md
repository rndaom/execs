# Native TF2 HUD acceptance

Passed on September 18, 2026 against candidate core `0650085`, using the
installed Windows 64-bit TF2 build 10828683 at 1920×1080. Generated HUDs came
from production option application against hash-verified pinned archives and
schemas. No HUD resource or material was hand-edited for these observations.

## Observed behavior

| Control | Retail game observation |
| --- | --- |
| kbnhud independent crosshairs | Two small, differently colored components remain distinct with configured sizes 13 and 17. The larger size-23 magenta hitmarker appears during actual damage. |
| kbnhud outlines | A/B captures preserve the glyphs while the hitmarker loses its dark outline. Exact sizes are corroborated by loaded font definitions, not inferred from screenshot pixel widths. |
| HypnotizeHUD health | The enabled variant shows a red box at actual 100 HP; its absence at full health follows the author's animation rules. |
| HypnotizeHUD scoreboard | The full statistics layout switches to the compact layout. |
| HypnotizeHUD pause background | Solid background switches to the visible game scene behind the menu. |
| HypnotizeHUD team status | Tall portrait health backgrounds switch to thin health strips. |
| HypnotizeHUD speedometer | Off has no readout; on shows 0000 idle and 0230 while moving. |
| HypnotizeHUD transparent viewmodels | The room, doorway and floor are visible through the minigun and hands. |

Transparency initially remained opaque. It became visible after the
[author's graphics guidance](https://github.com/Hypnootize/hypnotizehud/wiki/Transparent-Viewmodels)
and a map reload. The pinned HUD's `Refract` alias also specifies antialiasing
0, which was already the current value. The individual graphics or lifecycle
cause was not isolated; this does not establish that a map reload is universally
required. The active include chain, mask resource, VMT and VTF match upstream.
An independent reviewer confirmed all six effects and the kbnhud comparison.

## Isolation and restoration

The owner explicitly approved temporarily disabling TF2 Steam Cloud and
controlling the local test window. Before launching, a fresh session snapshot
recorded 363 protected local cfg/custom files and the RemoteStorage cfg entry.
The official installed Valve API disabled Cloud for app 440 and read back the
setting before each case. Account-wide Cloud remained unchanged. The normal
execs app was closed to prevent profile absorption during testing.

Disposable game folders retained the basename `tf`, required for the game's
localization lookup. No video command-line flags were used. Commands and HUDs
were confined to disposable test directories; testing used a local itemtest
server. The earlier failed Cloud-isolation attempt remains documented in
[its separate incident record](retail-hud-smoke.md).

The fresh local and API cfg sets remained byte-identical even before restoration.
After the game exited, the original app Cloud setting was restored and read
back. Steam's remote cache retained the original config hash with synced state;
the test log reports sync disabled throughout the session, with the same global
change number. No replacement cfg upload was needed.

The runtime changed `ScreenWindowed` and `ScreenNoBorder` despite the absence
of video flags. Both were restored from the fresh registry snapshot. Final
independent verification found all 369 protected files unchanged and the whole
Source display-settings snapshot equal. The original execs installation was
reopened through Explorer and verified to run outside MSIX package identity.

Raw screenshots, logs and restoration manifests remain local because menus can
include account and friend information. This is Windows retail rendering
evidence, not a Linux gameplay claim or blanket compatibility claim for every
HUD, material or particle effect.
