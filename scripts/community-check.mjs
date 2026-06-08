import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));

const checks = [
  [fs.existsSync("README.md"), "README.md exists at repository root"],
  [fs.existsSync("LICENSE"), "LICENSE exists at repository root"],
  [fs.existsSync("manifest.json"), "manifest.json exists at repository root"],
  [fs.existsSync("main.js"), "main.js exists at repository root"],
  [fs.existsSync("styles.css"), "styles.css exists at repository root"],
  [/^\d+\.\d+\.\d+$/.test(manifest.version), "manifest version uses x.y.z SemVer"],
  [manifest.version === packageJson.version, "manifest and package versions match"],
  [versions[manifest.version] === manifest.minAppVersion, "versions.json maps manifest version to minAppVersion"],
  [/^[a-z-]+$/.test(manifest.id), "manifest id contains only lowercase letters and hyphens"],
  [!manifest.id.includes("obsidian"), "manifest id does not contain obsidian"],
  [!manifest.id.endsWith("plugin"), "manifest id does not end with plugin"],
  [manifest.id === "sql-viewer", "manifest id is sql-viewer"],
  [manifest.name === "SQL Viewer", "manifest name is SQL Viewer"],
  [typeof manifest.description === "string" && manifest.description.length > 0, "manifest description is present"],
  [!manifest.description.toLowerCase().includes("obsidian"), "manifest description avoids redundant product naming"],
  [typeof manifest.author === "string" && manifest.author.length > 0, "manifest author is present"],
  [typeof manifest.minAppVersion === "string" && manifest.minAppVersion.length > 0, "manifest minAppVersion is present"],
  [typeof manifest.isDesktopOnly === "boolean", "manifest isDesktopOnly is boolean"],
  [fs.existsSync("assets/hero.svg"), "repo hero asset exists"],
  [fs.existsSync("assets/screenshot.svg"), "repo screenshot asset exists"],
  [fs.existsSync("assets/social-preview.svg"), "repo social preview asset exists"],
];

const failures = checks.filter(([passes]) => !passes).map(([, label]) => label);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  process.exit(1);
}

console.log("Obsidian community submission checks passed.");
