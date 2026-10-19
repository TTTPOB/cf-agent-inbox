#!/usr/bin/env bash
set -euo pipefail

# Download a prebuilt CLI; never install a runtime or request elevated privileges.
command -v node >/dev/null || { echo "请先安装 Node.js 22.18 或更新版本。" >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22||(major===22&&minor<18))process.exit(1)' || { echo "需要 Node.js >=22.18。" >&2; exit 1; }
command -v curl >/dev/null || { echo "需要 curl。" >&2; exit 1; }
command -v tar >/dev/null || { echo "需要 tar。" >&2; exit 1; }
repo="${INBOX_REPOSITORY:-TTTPOB/cf-agent-inbox}"
base="${INBOX_DOWNLOAD_BASE:-https://github.com/$repo/releases/latest/download}"
api="${INBOX_RELEASE_API:-https://api.github.com/repos/$repo/releases/latest}"
prefix="${INBOX_INSTALL_PREFIX:-$HOME/.local}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/cf-agent-inbox.XXXXXXXX")"
cleanup() {
  rm -f -- "$tmp/cf-agent-inbox-cli.tar.gz" "$tmp/release.json" "$tmp/inbox.mjs"
  rmdir -- "$tmp" 2>/dev/null || true
}
trap cleanup EXIT
curl --fail --silent --show-error --location "$base/cf-agent-inbox-cli.tar.gz" -o "$tmp/cf-agent-inbox-cli.tar.gz"
curl --fail --silent --show-error --location "$api" -o "$tmp/release.json"
node --input-type=commonjs - "$tmp/release.json" "$tmp/cf-agent-inbox-cli.tar.gz" <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const asset = release.assets?.find((item) => item.name === "cf-agent-inbox-cli.tar.gz");
const digest = "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(process.argv[3])).digest("hex");
if (!asset?.digest || asset.digest !== digest) {
  console.error("GitHub Release 附件校验失败；请重新下载。");
  process.exit(1);
}
console.log("GitHub Release 附件校验通过。");
NODE
tar -xzf "$tmp/cf-agent-inbox-cli.tar.gz" -C "$tmp" inbox.mjs
mkdir -p "$prefix/lib/cf-agent-inbox" "$prefix/bin"
install -m 755 "$tmp/inbox.mjs" "$prefix/lib/cf-agent-inbox/inbox.mjs"
ln -sfn "$prefix/lib/cf-agent-inbox/inbox.mjs" "$prefix/bin/inbox"
"$prefix/bin/inbox" --help
printf "\n已安装：%s/bin/inbox\n请确保 %s/bin 在 PATH 中。下一步：inbox help config\n" "$prefix" "$prefix"
