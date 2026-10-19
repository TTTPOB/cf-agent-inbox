import { build } from "esbuild";
import { mkdir, chmod, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const out = new URL("../dist/cli/", import.meta.url);
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: root.pathname,
  entryPoints: ["cli/main.ts"],
  outfile: new URL("inbox.mjs", out).pathname,
  bundle: true, platform: "node", format: "esm", target: "node22",
  sourcemap: false, legalComments: "inline",
});
await chmod(new URL("inbox.mjs", out), 0o755);
await copyFile(new URL("LICENSE", root), new URL("LICENSE", out));
await copyFile(new URL("cli/README.md", root), new URL("README.md", out));
const release = new URL("release/", root);
await mkdir(release, { recursive: true });
const name = "cf-agent-inbox-cli.tar.gz";
execFileSync("tar", ["-czf", new URL(name, release).pathname, "-C", out.pathname, "inbox.mjs", "LICENSE", "README.md"]);
console.log(`Built release/${name}`);
