# Security

execs writes into a Team Fortress 2 install. A bug that writes the wrong
file, writes while the game is running, or bypasses the lock is a
security report, not a public issue.

**Do not open a public GitHub issue** for anything that could damage an
install, write outside the documented surface (`tf/custom/`,
`tf/cfg/overrides/` or the vanilla user cfg files, and the Steam Cloud
`config.cfg` copy), or skip the write lock.

Use [Report a vulnerability](https://github.com/rndaom/execs/security/advisories/new)
on this repository. If that form is missing, use the email on the
[owner's GitHub profile](https://github.com/rndaom).

Please include the execs version (footer of the app), the OS, and
whether you have a crash log
(`%AppData%\execs\logs\panic.log` or `~/.local/share/execs/logs/panic.log`).

The in-app updater is signed with minisign. Installers are not
Authenticode-signed yet; Windows SmartScreen will warn on first run.
Verify the SHA-256 listed on the GitHub release if you want to check the
file before you run it.
