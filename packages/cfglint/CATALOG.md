# Offline TF2 command catalog

`enumerateCatalog()` and `lookupCommand(name)` expose pinned evidence for completion,
recognition and help. `lookupCvar()` retains its compact compatibility shape. The catalog
does not inspect executables, launch TF2 or contact a service at runtime. Unknown names
mean absent from this catalog: installed plugins and local aliases may supply them.
A malformed personal bind is reported and omitted from the startup map; later
complete commands on new lines remain usable. Unknown invocations still make
startup unresolved because a plugin or external alias may affect tracked settings.

Run `pnpm --filter @execs/cfglint build-corpus` to regenerate. Every source is an immutable
Git revision with its own review date and URL in the generated output. Generation gathers
and validates every input and formats the complete output before replacing the destination.
HTTP errors, missing dump structure, malformed candidate rows, implausible coverage loss,
missing required bind commands and changed verified SDK declarations all stop generation.

The Windows and hidden dumps come from mastercomfig revision
`c7b52734b252bb521cd22e8243bca6f81dd3ab41`. The same revision supplies top-level aliases from
`comfig.cfg` and `define_presets.cfg`. These are conditional on that configuration, not
built-in commands. Nested aliases and arbitrary installed scripts are not catalog claims.
`r_lightmap_bicubic_set` is a narrow supplement: pinned `comfig.cfg` writes it as a
setting, and a [Source-1-Games runtime diagnostic](https://github.com/ValveSoftware/Source-1-Games/issues/7218)
lists the same name among ConVars for another Source game. Its current TF2 default,
flags and availability are not claimed. The supplement is checked during regeneration.
The same diagnostic lists `m_rawinput_onetime_reset`; the pinned mastercomfig
`flat-mouse.cfg` also writes it. This second supplement carries the same limits.
Module-level names such as `texture_quality=low` retain their literal equals sign. The `exec`
and `alias` syntax strings describe forms observed in this pinned configuration; they
do not establish exhaustive engine arity. The SDK does not ship engine command handlers
for bind/alias/exec, so query forms and complete key enums are not guessed into diagnostics.
The parser retains leading `+`/`-` and colons embedded in string defaults.

The Valve SDK revision `b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474` supplies independently
described metadata from `CMultiplayRules::ClientCommand` for `voicemenu <menu> <item>`.
Its `atoi` calls establish integer arguments; the actual menus are game data, so there
are no guessed menu bounds. `client/tf/clientmode_tf.cpp` declares `fov_desired` with
minimum 20 and `MAX_FOV`; `shared/shareddefs.h` defines that maximum as 90. This is SDK
evidence, not proof of the current retail build or runtime values. In particular, a UI
slider minimum of 75 must not be presented as the sourced engine bound.

Defaults never imply a type or range. Missing metadata remains absent. Both sources are
retained when dumps overlap: flags are the union of observed flags and differing help
texts are preserved with a separator. Conflicting defaults are omitted and disclosed in
applicability (for example `sv_backspeed`); incompatible kinds fail generation. Identical
duplicate dump rows are coalesced. Engine records take precedence over same-name comfig
aliases. Windows coverage is explicitly distinguished from unverified Linux and current
retail availability. Source review dates are not game build dates.

License review: mastercomfig's MIT attribution applies to the generated dump and alias
metadata. The SDK has Valve's own Source SDK license; no SDK implementation is copied or
vendored. Only command names, argument facts, numeric bounds and provenance are recorded
with independently authored descriptions. See the pinned repository LICENSE files before
expanding the supplement to include any implementation or quoted SDK material.

Tests cover all app-generated bind actions, both button edges, source provenance, missing
metadata, conflicts and malformed input. A network regeneration followed by comparing
the generated file hash validates that the checked-in pinned baseline is reproducible.
