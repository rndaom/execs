# Linux WebKitGTK / Orca announced-name qualification

Result: **passed for the changed Sounds accessible names** on September 18, 2026.

[GitHub Actions run 35399210696](https://github.com/rndaom/execs/actions/runs/35399210696)
completed successfully and retains the `orca-evidence` artifact. The qualification
commit is `e2e9ef07727ec19aede558707c928c5faef827da`; its product source is
unchanged from candidate `c001e96`. The only additions are the disposable
qualification workflow and its three harness files. No release artifact was
modified, and the runner had no real profiles, TF2 installation or Steam account.

## Environment and method

- Ubuntu 22.04 GitHub-hosted runner, Xvfb and a private D-Bus session.
- Native GTK 3 WebKitGTK 4.1, package version `2.50.4-0ubuntu0.22.04.1`.
- Orca `42.0-1ubuntu2`, AT-SPI and Speech Dispatcher with eSpeak NG.
- The candidate's unchanged React source served by Vite using its existing
  `?preview=settings-sounds` adapter. Production bundles intentionally exclude
  this adapter; this is a native WebKit engine qualification, not another test
  of the packaged AppImage or the live IPC backend.
- Eighty physical Tab events through X11 exercised the ordinary keyboard focus
  path. Orca's real WebKit script generated and dispatched the speech; names
  were not copied from DOM attributes into a mock speech implementation.
- Fixture mode intentionally disables audition. The installed hit/kill Play
  controls and a library Play control were therefore presented using Orca's
  `presentObject` method on the real WebKit AT-SPI objects. This separately
  verifies the disabled controls' spoken names and states; it does not claim
  that disabled controls are Tab stops or that audio audition was exercised.

## Observed speech

The [selected utterances](linux-speech.txt) are extracted from Orca's debug log.
The same log records their delivery to Speech Dispatcher.

- Hit and kill volume sliders announce their distinct slot names and values.
- Fifty-seven keyboard-reached Assign controls announce the clip, source and
  destination slot. Both hit and kill actions were observed for community,
  built-in TF2 and comfig.app entries.
- Installed hit playback announces `Quack`, the hit slot and the community
  installed source. Installed kill playback announces `Default ding`, the kill
  slot and the built-in source.
- Library playback announces `Bababa` and its community source. Orca also
  announces the disabled state and the desktop-app requirement.

The qualification job asserts the presence of actual Orca utterances for Play,
Assign hit, Assign kill and both volume controls. No application changes were
needed. This establishes generated and dispatched screen-reader speech; it is
not a human assessment of voice intelligibility or a complete accessibility audit.

The full final Orca log SHA-256 is
`b90dd48069534ac2d87e767888da9786c3061306e735f2a196337022b1ab8993`.
Harness source is preserved in the
[qualification commit](https://github.com/rndaom/execs/commit/e2e9ef07727ec19aede558707c928c5faef827da).

## Harness corrections

The first exploratory run used the production bundle and reached first run
because preview fixtures are compiled out there. The second reached Sounds
and verified the Tab-driven names, but Orca 42's structural button-navigation
scroll request timed out through AT-SPI. The final run avoided that unrelated
scroll operation by using Orca object presentation only for disabled playback.
It passed all name assertions. An Orca shutdown traceback occurs after the
WebKit process is terminated during runner teardown; it is not an application
or name-generation failure. The earlier runs are not counted as acceptance.

Reference: [Orca's official debugging documentation](https://orca.gnome.org/debugging)
describes debug logs as recording accessibility events and spoken output.
