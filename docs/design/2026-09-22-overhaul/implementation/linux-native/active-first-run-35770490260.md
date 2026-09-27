# First active Files native run

September 22, 2026. **Active sequence failed before Save.** [Run 35770490260](https://github.com/rndaom/execs/actions/runs/35770490260) built product head `31b38b912f67734f3bb27fec09fef5e6ee64ae84` through merge `7680602a89a3bc630c0902ae5440468b3cecf8d0`. The normal optimized ELF SHA-256 is `05c6b4e14f204dc4c2d48e285616e4b456358079e06f2608965ee82a461be4b4`. The preceding inactive native scenario passed. That result does not turn this active failure into a pass.

## Observed sequence

1. **Passed:** the real native frontend opened the authored active profile and Files helper at 1200×800. Trusted Ctrl+A/C plus an independent X clipboard read returned all 4,848 original bytes, SHA-256 `71f0a601868c061fd5edf6ce2d2ee41d7043e73823f0e274c748f0134eb85333`.
2. **Failed:** after entering the authored append, the trusted-copy assertion did not receive the exact expected draft. The saved failure screenshot shows the comment on line 130 and `Ln 130, Col 33`, with no following empty line. This supports a missing trailing Enter in the input path, but the first runner did not retain the rejected copy payload. The image alone cannot establish the exact mismatched byte.
3. **Passed preservation:** all 12 protected files, both profiles, settings and the synthetic installation remained byte-exact after owned-process cleanup. No Save, native close decision, restart, selection-retention or profile switch ran.

The corrective harness work sends line breaks as explicit native Enter actions and retains bounded copy/input diagnostics on failure. It keeps the original byte assertions unchanged. A subsequent execution must independently pass the entire sequence.

## Inspected images

Both actual PNGs were opened individually and accepted as evidence of their stated states, not as a completed Files workflow:

- [Initial native Files](run-35770490260/linux-native-smoke-7680602a89a3bc630c0902ae5440468b3cecf8d0/execs-linux-native-active-m5r4AM/evidence/01-native-active-files.png): correct profile, helper, enabled editor and complete selection; no blank or loading frame.
- [Failure state](run-35770490260/linux-native-smoke-7680602a89a3bc630c0902ae5440468b3cecf8d0/execs-linux-native-active-m5r4AM/evidence/failure.png): dirty helper, appended comment and Save/Discard visible. It is deliberately retained as failed-run evidence.
- [Raw results](run-35770490260/linux-native-smoke-7680602a89a3bc630c0902ae5440468b3cecf8d0/execs-linux-native-active-m5r4AM/evidence/results.gen.json) include process identity, native origin, three stable frames per image, exact preservation checkpoints and the assertion stack.

The [Foundry workspaces board](../../options/01-foundry/03-workspaces.png) and initial native image were viewed together. Source: 1672×941, four concept panels; implementation: 1200×800 physical/CSS pixels at device scale 1. The different contents and panel sizes preclude a pixel-match claim. At the composition level, the Inter hierarchy, warm surfaces, copper actions, restrained borders, source-font editor and file-list/editor proportions carry the selected direction. Icons are crisp and the actual helper content is legible. The selected-text background and disabled Save express this real read-only observation state; fictitious warnings and concept file names were not reproduced. A focused crop was unnecessary because all relevant native controls were legible at full resolution. No separate visual P0/P1/P2 was found in these two states; functional qualification remains **blocked** by the failed input/copy step.

This run does not qualify native Save, native close behavior, installer/updater operation, Steam Cloud or retail TF2. It retains the original acceptance requirements.
