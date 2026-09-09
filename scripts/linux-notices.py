"""Include Debian copyright records for the builder's system-library inventory.

The AppImage copies system libraries at bundle time. Keeping the full installed
package inventory includes the source and license notices for those libraries;
the .deb may also rely on libraries supplied by the user's distribution.
"""
import pathlib
import subprocess

packages = subprocess.check_output(
    ["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\n"], text=True
).splitlines()
sections = []
for package in sorted(packages):
    name = package.split("\t", 1)[0].split(":", 1)[0]
    copyright_file = pathlib.Path("/usr/share/doc") / name / "copyright"
    if copyright_file.is_file():
        sections.append(package + "\n\n" + copyright_file.read_text(errors="replace"))
for license_file in sorted(pathlib.Path("/usr/share/common-licenses").glob("*")):
    if license_file.is_file():
        sections.append(str(license_file) + "\n\n" + license_file.read_text(errors="replace"))
output = pathlib.Path("apps/desktop/src-tauri/notices/LINUX-SYSTEM.txt")
output.write_text(
    "Linux builder system-package notices (an inclusive inventory).\n"
    "Bundled libraries remain unmodified shared libraries under their upstream licenses.\n"
    "Source is available from the Ubuntu 22.04 source archive for each package/version\n"
    "listed below (https://launchpad.net/ubuntu/jammy/+source/<package>).\n"
    "Source can be retrieved using: apt-get source <source-package>=<version>.\n"
    "Individual source locations and license terms follow.\n\n"
    + ("\n\n" + "=" * 78 + "\n\n").join(sections), encoding="utf8"
)
print(f"Included {len(sections)} system-package and common-license records")
