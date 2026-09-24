import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ),
);
const supported = new Set();
for (const target of ["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"]) {
  const graph = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--locked",
        "--format-version",
        "1",
        "--filter-platform",
        target,
        "--manifest-path",
        "apps/desktop/src-tauri/Cargo.toml",
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    ),
  );
  const nodes = new Map(graph.resolve.nodes.map((node) => [node.id, node]));
  const seen = new Set();
  function visit(id) {
    if (seen.has(id)) return;
    seen.add(id);
    supported.add(id);
    for (const dependency of nodes.get(id)?.deps || []) visit(dependency.pkg);
  }
  visit(graph.resolve.root);
}
const normalize = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
const texts = new Map();
const missing = [];
const supplemental = JSON.parse(readFileSync("scripts/third-party-supplemental.json", "utf8"));
function addPackage(name, version, source, directory, license, explicit) {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^(licen[cs]e|copying|notice|copyright)([._-]|$)/i.test(entry.name),
    )
    .map((entry) => join(directory, entry.name));
  if (explicit && existsSync(resolve(directory, explicit)))
    files.push(resolve(directory, explicit));
  for (const child of ["LICENSES", "licenses"]) {
    if (existsSync(join(directory, child))) {
      for (const entry of readdirSync(join(directory, child), { withFileTypes: true }))
        if (entry.isFile()) files.push(join(directory, child, entry.name));
    }
  }
  const contents = [...new Set(files)].sort().map((file) => normalize(readFileSync(file, "utf8")));
  const extra = supplemental[`${name}@${version}`];
  if (!contents.length && extra)
    contents.push(
      `Notice source: ${extra.source}\n\n${extra.notices.map((notice) => normalize(notice.text)).join("\n\n")}`,
    );
  if (name === "curl-sys") {
    // The static-curl feature includes the C libcurl source inside curl-sys.
    // Its COPYING notice is separate from the binding crate's MIT license.
    if (version !== "0.4.90+curl-8.21.0")
      throw new Error(`Review the vendored libcurl notice for curl-sys ${version}`);
    const copying = join(directory, "curl", "COPYING");
    if (!existsSync(copying)) throw new Error("Vendored libcurl COPYING is missing");
    const bytes = readFileSync(copying);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== "82f2f4427d6545ee5aaac4f0b80428da6cc8ba41c2cf5da3a03680ec327b9681")
      throw new Error("Vendored libcurl COPYING changed; review its notice");
    contents.push(`Vendored libcurl 8.21.0 COPYING\n\n${normalize(bytes.toString("utf8"))}`);
  }
  if (name === "libz-sys") {
    // MSVC builds include the bundled zlib C source, whose notice is separate
    // from the Rust wrapper crate's MIT/Apache notices.
    if (version !== "1.1.29")
      throw new Error(`Review the vendored zlib notice for libz-sys ${version}`);
    const licenseFile = join(directory, "src", "zlib", "LICENSE");
    if (!existsSync(licenseFile)) throw new Error("Vendored zlib LICENSE is missing");
    const bytes = readFileSync(licenseFile);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2")
      throw new Error("Vendored zlib LICENSE changed; review its notice");
    contents.push(`Vendored zlib 1.3.2 LICENSE\n\n${normalize(bytes.toString("utf8"))}`);
  }
  if (!contents.length) missing.push({ name, version, license, directory });
  const title = `${name} ${version}`;
  texts.set(
    title,
    `${title}\nSource: ${source}\nDeclared license: ${license || "See source notices"}\n\n${[...new Set(contents)].join("\n\n")}`,
  );
}
for (const pkg of metadata.packages.filter((pkg) => pkg.source && supported.has(pkg.id))) {
  addPackage(
    pkg.name,
    pkg.version,
    pkg.repository || `https://crates.io/crates/${pkg.name}/${pkg.version}`,
    dirname(pkg.manifest_path),
    pkg.license,
    pkg.license_file,
  );
}
const visited = new Set();
function npmPackage(name, from) {
  let directory = from;
  while (true) {
    const candidates = [
      join(directory, "node_modules", name),
      // pnpm 11 can hoist transitive packages into the virtual store even
      // when the workspace uses the hoisted linker on Windows.
      join(directory, "node_modules", ".pnpm", "node_modules", name),
    ];
    const found = candidates.find((candidate) => existsSync(join(candidate, "package.json")));
    if (found) {
      directory = found;
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot resolve ${name}`);
    directory = parent;
  }
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (visited.has(`${pkg.name}@${pkg.version}`)) return;
  visited.add(`${pkg.name}@${pkg.version}`);
  if (!pkg.private)
    addPackage(
      pkg.name,
      pkg.version,
      pkg.homepage || `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
      directory,
      pkg.license,
    );
  for (const [dependency, spec] of Object.entries(pkg.dependencies || {}))
    if (!spec.startsWith("workspace:")) npmPackage(dependency, directory);
}
const desktop = JSON.parse(readFileSync("apps/desktop/package.json", "utf8"));
for (const [name, spec] of Object.entries(desktop.dependencies))
  if (!spec.startsWith("workspace:")) npmPackage(name, join(root, "apps/desktop"));

const output = "apps/desktop/src-tauri/notices";
mkdirSync(output, { recursive: true });
const credits = readFileSync("THIRD_PARTY.md", "utf8").replace(/\r\n/g, "\n");
if (process.argv.includes("--check")) {
  if (readFileSync(join(output, "CREDITS.txt"), "utf8") !== credits)
    throw new Error("Regenerate packaged credits");
} else writeFileSync(join(output, "CREDITS.txt"), credits);
if (missing.length) {
  console.error(JSON.stringify(missing, null, 2));
  throw new Error(`${missing.length} dependency packages need explicit license evidence`);
}
const header =
  "execs third-party dependency notices\n\nThis inventory includes the locked Rust dependencies for all supported targets,\nincluding build tools, and production JavaScript dependencies. Inclusion does\nnot mean every listed package is linked into every installer. Source projects\nretain their licenses; execs does not relicense them.\n\n";
const result = `${header}${[...texts]
  .sort(([a], [b]) => a.localeCompare(b, "en"))
  .map(([, value]) => value)
  .join(`\n\n${"=".repeat(78)}\n\n`)}\n`;
const file = join(output, "DEPENDENCIES.txt");
if (process.argv.includes("--check")) {
  if (!existsSync(file) || readFileSync(file, "utf8") !== result)
    throw new Error(`Regenerate ${relative(root, resolve(file))}`);
} else {
  writeFileSync(file, result);
}
console.log(`Verified full notices for ${texts.size} dependency packages`);
