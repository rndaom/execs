# Inactive library entry point

The native `10-inactive-library-before.jpg` finding is reachable because an initialized library with saved profiles enters `ReadyPanel`, while settings require an active profile. Import leaves the new profile inactive; deleting an active profile with Keep installed can also leave other saved profiles without an active selection.

The fallback now gives that specific state a Foundry heading, a short explanation of switching, and one **Choose profile** action. It opens the existing header menu and focuses the first enabled action in its saved-profile list. It never activates a profile on its own. Profiles requiring repair focus their repair action; while TF2 runs, switching remains disabled and focus reaches an available row action. Escape uses the menu's existing close-and-restore behavior.

Root mismatch, unusable or empty libraries, an active profile, and pending switch recovery retain their previous paths. No shared menu reflow CSS changed. Import review now says “Your TF2 setup stays unchanged until you switch,” which also applies when no profile is active.

## Verification

- ReadyPanel interaction coverage: 10 tests passed, including opening, first-profile focus, Escape/reopen, no implicit activation, repair focus, running-game behavior, write-in-flight state and fallback/recovery distinctions.
- Existing import dialog, preview and first-run tests: 16 passed. The new inactive browser fixture has two saved profiles and no active profile. Import copy retains its trust, cancellation and HUD-choice behavior.
- `pnpm exec tsc --noEmit` and targeted Biome checks: passed.
- Browser-only `?preview=inactive-library`, Chrome at its existing 1920 × 945 viewport: pointer and Enter activation opened the existing menu; the first profile had keyboard-visible focus; Escape closed it and focused the header summary. No profile was activated. Import review showed the corrected sentence and Cancel returned to the same inactive state.

## Screenshots

- `01-choose-profile.png`: clear inactive-library entry point.
- `02-menu-open-profile-focused.png`: existing profile menu opened by keyboard; Main has focus and remains inactive.
- `03-import-review-no-active-profile.png`: truthful import copy without an active profile.

These captures use only browser preview data. This change did not build `dist`, launch or manipulate the native application, or access player files. Native re-verification belongs to the separate parent run.
