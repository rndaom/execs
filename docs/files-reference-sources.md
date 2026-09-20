# Offline Files reference sources

Reviewed 2026-09-20. Prose and the two minimal example snippets are authored for execs, not copied upstream templates. No external page is loaded into the editor or granted IPC. The guides and catalog remain available offline. Catalog snapshot provenance and MIT attribution remain with the cfglint catalog; its documented defaults are never presented as runtime measurements.

Primary evidence:

- [mastercomfig Custom Configs](https://docs.comfig.app/latest/customization/custom_configs/): supported overrides directory, launch/class hooks, class filenames, cfg-relative helper examples, modules and setup hooks. The page was accessible during research (page revision dated 2026-07-02). Guides summarize behavior without vendoring template code.
- [Valve clientmode_tf.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/tf/clientmode_tf.cpp): TF2 class config execution and example cvar flags/defaults.
- [Valve in_main.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/in_main.cpp): press/release input handling.
- [Valve commandbuffer.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/tier1/commandbuffer.cpp): command delimiters and quotation handling.

Valve SDK source was read as evidence only; none of its source code or assets is incorporated. Its Source SDK license does not license arbitrary code copying into execs. Valve Developer Community Bind and Alias pages were blocked during research and are **not verified evidence**. Recheck those pages in a future documentation refresh; the UI deliberately avoids claiming that the static graph proves runtime execution or fully implements engine parsing.

Local product behavior (profile projections, draft-only insertion, managed panes and engine configuration warnings) follows AGENTS.md and the existing native write pipeline. Static navigation uses the shared cfglint resolver. Alias links are candidate definitions and deferred payload references stay marked deferred. Missing targets, omitted VPKs and partial inventories remain unknown, not proof of absence. Credential preview masking hides complete matching lines including comments and quoted payloads.
