// @ts-nocheck -- Node-only regression runner; the application tsconfig targets Workers/DOM.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../..");
async function load(relative) {
 const result = await build({ entryPoints: [path.join(root, relative)], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", tsconfig: path.join(root, "tsconfig.cloudflare.json"), alias: { shared: path.join(root, "shared") } });
 const filename = path.join(root, "app/tests/fixture.cjs");
 const mod = new Module(filename);
 mod.filename = filename;
 mod.paths = createRequire(import.meta.url).resolve.paths("react");
 mod._compile(result.outputFiles[0].text, filename);
 return mod.exports;
}
const utils = await load("app/lib/utils.ts");
const parser = await load("app/lib/search-parser.ts");

test("explicit MIME bodies preserve plain text and legacy HTML", () => {
 assert.equal(utils.getEmailBodyHtml({ body_html: "<p>HTML</p>", body_text: "text", body: "old" }), "<p>HTML</p>");
 assert.equal(utils.getEmailBodyHtml({ body_text: "<tag>&\nnext" }), '<pre style="white-space: pre-wrap">&lt;tag&gt;&amp;\nnext</pre>');
 assert.equal(utils.getEmailBodyHtml({ body: "<b>old</b>" }), "<b>old</b>");
 assert.equal(utils.getEmailBodyHtml({ body_text: "", body: "old" }), '<pre style="white-space: pre-wrap"></pre>');
});

test("CID images resolve only to private attachment URLs", () => {
 const attachments = [{ id: "img/1", content_id: "<image@example.com>" }];
 const html = utils.rewriteInlineImages('<img src="cid:image@example.com"><img src="data:image/png;base64,AA">', "inbox@example.com", "msg/1", attachments);
 assert.ok(html.includes('/api/v1/mailboxes/inbox%40example.com/emails/msg%2F1/attachments/img%2F1'));
 assert.ok(html.includes('src="data:image/png;base64,AA"'));
});

test("before is exclusive and after is inclusive ISO time", () => {
 const parsed = parser.parseSearchQuery('from:sender@example.com after:2025-01-01 before:2025-02-01 report');
 assert.equal(parsed.date_start, "2025-01-01T00:00:00.000Z");
 assert.equal(parsed.date_before, "2025-02-01T00:00:00.000Z");
 assert.equal(parsed.date_end, undefined);
 assert.equal(parsed.query, "report");
 assert.equal(parser.parseSearchQuery("before:invalid").date_before, undefined);
});

test("reading selection and mobile navigation remain independent", async () => {
 const { useUIStore } = await load("app/hooks/useUIStore.ts");
 const store = useUIStore;
 store.getState().selectEmail("one");
 store.getState().toggleSidebar();
 assert.equal(store.getState().selectedEmailId, "one");
 assert.equal(store.getState().isSidebarOpen, true);
 store.getState().closePanel();
 assert.equal(store.getState().selectedEmailId, null);
 assert.equal("startCompose" in store.getState(), false);
 assert.equal("isAgentPanelOpen" in store.getState(), false);
});

test("API retains receive-only mutations but no removed endpoints", async () => {
 const api = (await load("app/services/api.ts")).default;
 for (const name of ["listMailboxes", "createMailbox", "getEmail", "getThread", "markThreadRead", "updateEmail", "moveEmail", "getAttachment", "searchEmails", "createFolder"]) assert.equal(typeof api[name], "function", name);
 for (const name of ["sendEmail", "replyToEmail", "forwardEmail", "saveDraft", "deleteEmail", "deleteMailbox", "deleteFolder"]) assert.equal(name in api, false, name);
});

test("remote image permission is explicit and scoped to the displayed body", async () => {
 const source = await readFile(path.join(root, "app/components/EmailIframe.tsx"), "utf8");
 assert.ok(source.includes('useState<string | null>(null)'));
 assert.ok(source.includes('loadedBody === body'));
 assert.ok(source.includes('loadRemoteImages ? " http: https:" : ""'));
 assert.ok(source.includes('img-src \u0024{imageSources}'));
 assert.ok(source.includes('加载外部图片'));
 assert.ok(source.includes('referrerPolicy="no-referrer"'));
 assert.ok(!source.includes('sandbox="allow-same-origin'));
});

test("deleted feature modules have no consumers or actions left in app sources", async () => {
 async function sources(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
   const file = path.join(dir, entry.name);
   if (entry.isDirectory()) return entry.name === "tests" ? [] : sources(file);
   return /\.(ts|tsx)$/.test(file) ? [[file, await readFile(file, "utf8")]] : [];
  }))).flat();
 }
 for (const [file, content] of await sources(path.join(root, "app"))) {
  assert.doesNotMatch(content, /ComposeEmail|ComposePanel|RichTextEditor|useComposeForm|AgentSidebar|AgentPanel|MCPPanel|useDeleteEmail|useDeleteMailbox|useDeleteFolder|startCompose|agentSystemPrompt|method: "DELETE"/, file);
 }
});
