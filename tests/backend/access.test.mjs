import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { generateKeyPair, SignJWT } from "jose";
import { resolveMailboxAccess } from "../../workers/lib/access.ts";

const require = createRequire(import.meta.url);
const { publicKey, privateKey } = await generateKeyPair("ES256");
globalThis.__inboxAccessTestKey = publicKey;

// Keep real signature/issuer/audience validation; replace only remote key discovery and SSR.
async function loadApp(dev = false) {
	const result = await build({ entryPoints: ["workers/app.ts"], bundle: true, write: false, format: "esm", platform: "node",
		define: { "import.meta.env.DEV": String(dev), "import.meta.env.MODE": '"test"' },
		plugins: [{ name: "test-runtime", setup(b) {
			b.onResolve({ filter: /^(jose|react-router|cloudflare:workers|virtual:react-router\/server-build)$/ }, args => ({ path: args.path, namespace: "fixture" }));
			b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
				if (path === "jose") return { resolveDir: process.cwd(), contents: 'export { jwtVerify } from ' + JSON.stringify(require.resolve("jose")) + '; export const createRemoteJWKSet = () => globalThis.__inboxAccessTestKey;' };
				if (path === "react-router") return { contents: 'export const createRequestHandler = () => () => new Response("SSR fixture");' };
				if (path === "cloudflare:workers") return { contents: 'export class DurableObject {}' };
				return { contents: 'export default {};' };
			});
		} }],
	});
	return (await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"))).default;
}
const app = await loadApp();
const clientId = "service-fixture.access";
const allowed = "allowed@example.com";
const denied = "other@example.net";
const mapping = { [clientId]: ["ALLOWED@EXAMPLE.COM", "new@example.com"] };
const issuer = "https://access.example.com";
const audience = "fixture-audience";
async function token(payload, key = privateKey) {
	return new SignJWT(payload).setProtectedHeader({ alg: "ES256" }).setIssuedAt().setExpirationTime("5m").setIssuer(issuer).setAudience(audience).sign(key);
}
const serviceJwt = await token({ common_name: clientId, sub: "", type: "app" });
const browserJwt = await token({ email: "owner@example.com", sub: "browser-user" });
function fixture() {
	const accesses = [];
	const objects = new Map([["mailboxes/" + allowed + ".json", "{}"], ["mailboxes/" + denied + ".json", "{}"], ["raw/allowed%40example.com/msg.eml", "raw fixture"], ["attachments/msg/att/file.txt", "attachment fixture"]]);
	const mailbox = {
		async getFolders() { return []; }, async getEmails() { return []; }, async countEmails() { return 0; },
		async getThreadedEmails() { return []; }, async countThreadedEmails() { return 0; },
		async getEmail() { return { id: "msg", body: "fixture" }; }, async updateEmail() { return { id: "msg", read: true }; },
		async getThreadEmails() { return []; }, async markThreadRead() {}, async moveEmail() { return true; },
		async searchEmails() { return []; }, async countSearchResults() { return 0; },
		async getAttachment() { return { id: "att", email_id: "msg", filename: "file.txt", mimetype: "text/plain" }; },
		async createFolder() { return { id: "custom" }; }, async updateFolder() { return { id: "custom" }; },
	};
	const env = {
		POLICY_AUD: audience, TEAM_DOMAIN: issuer, SERVICE_TOKEN_MAILBOXES: mapping,
		DOMAINS: "example.com,example.net", EMAIL_ADDRESSES: [allowed, denied, "new@example.com"],
		BUCKET: {
			async head(k) { accesses.push(k); return objects.has(k) ? {} : null; },
			async get(k) { accesses.push(k); return objects.has(k) ? { body: objects.get(k), async json() { return JSON.parse(objects.get(k)); } } : null; },
			async put(k, v) { accesses.push(k); objects.set(k, v); },
			async list() { accesses.push("list"); return { objects: [...objects.keys()].filter(k => k.startsWith("mailboxes/")).map(key => ({ key })), truncated: false }; },
		},
		MAILBOX: { idFromName(id) { accesses.push("DO:" + id); return id; }, get() { return mailbox; } },
	};
	return { env, accesses, objects };
}
async function request(path, { jwt = serviceJwt, method = "GET", body, headers = {} } = {}, f = fixture(), target = app) {
	const h = new Headers(headers);
	if (jwt) h.set("cf-access-jwt-assertion", jwt);
	if (body) h.set("content-type", "application/json");
	return target.fetch(new Request("https://inbox.example.com/api/v1" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), f.env, {});
}

const routes = [
	["GET", ""], ["PUT", "", { settings: {} }],
	["GET", "/emails"], ["GET", "/emails?folder=Inbox&threaded=true"], ["GET", "/emails/msg"], ["PUT", "/emails/msg", { read: true, starred: true }],
	["GET", "/emails/msg/raw"], ["GET", "/emails/msg/attachments/att"], ["POST", "/emails/msg/move", { folderId: "archive" }],
	["GET", "/threads/thread"], ["POST", "/threads/thread/read"], ["GET", "/search?query=fixture"],
	["GET", "/folders"], ["POST", "/folders", { name: "custom" }], ["PUT", "/folders/custom", { name: "renamed" }],
];

test("verified common_name maps exact client ID; unknown and malformed identities fail closed", () => {
	assert.deepEqual(resolveMailboxAccess({ common_name: clientId, sub: "" }, mapping), { allowedMailboxes: [allowed, "new@example.com"] });
	for (const payload of [{}, { sub: "user" }, { common_name: "unmapped" }, { common_name: clientId.toUpperCase() }, { common_name: "unmapped", email: "owner@example.com" }]) assert.equal(resolveMailboxAccess(payload, mapping), null);
	assert.equal(resolveMailboxAccess({ common_name: clientId }, { [clientId]: "not-an-array" }), null);
	assert.deepEqual(resolveMailboxAccess({ common_name: clientId }, { [clientId]: [] }), { allowedMailboxes: [] });
});

test("service identity allows every API only for its mapped mailbox, with encoded/case-normalized paths", async () => {
	for (const [method, suffix, body] of routes) {
		const f = fixture();
		const ok = await request("/mailboxes/ALLOWED%40EXAMPLE.COM" + suffix, { method, body }, f);
		assert.ok(ok.status >= 200 && ok.status < 300, method + " allowed " + suffix + ": " + ok.status);
		assert.ok(f.accesses.some(a => a === "mailboxes/" + allowed + ".json"));
		for (const mailbox of [denied, "OTHER%40EXAMPLE.NET", "missing%40example.net", "other%2540example.net"]) {
			const blocked = fixture();
			const response = await request("/mailboxes/" + mailbox + suffix, { method, body }, blocked);
			assert.equal(response.status, 403, method + " denied " + mailbox + suffix);
			assert.deepEqual(blocked.accesses, [], "must reject before any R2/DO resource access");
		}
	}
});

test("mailbox list and config expose no unallowed addresses/domains; create checks body.email", async () => {
	const f = fixture();
	assert.deepEqual((await (await request("/mailboxes", {}, f)).json()).map(m => m.email), [allowed]);
	assert.deepEqual(await (await request("/config", {}, f)).json(), { domains: ["example.com"], emailAddresses: [allowed, "new@example.com"] });
	const blocked = fixture();
	assert.equal((await request("/mailboxes", { method: "POST", body: { name: "Other", email: denied } }, blocked)).status, 403);
	assert.deepEqual(blocked.accesses, []);
	assert.equal((await request("/mailboxes", { method: "POST", body: { name: "New", email: "NEW@EXAMPLE.COM" } }, f)).status, 201);
	const empty = fixture(); empty.env.SERVICE_TOKEN_MAILBOXES = { [clientId]: [] };
	assert.deepEqual(await (await request("/mailboxes", {}, empty)).json(), []);
	assert.deepEqual(await (await request("/config", {}, empty)).json(), { domains: [], emailAddresses: [] });
});

test("unmapped tokens, unknown identities, forged headers and invalid signatures never authorize", async () => {
	for (const jwt of [undefined, await token({ common_name: "unknown.access" }), await token({ sub: "", type: "app" }), await token({ common_name: clientId }, (await generateKeyPair("ES256")).privateKey)]) {
		const f = fixture();
		const response = await request("/mailboxes/" + allowed + "/emails", { jwt: jwt ?? "", headers: { "CF-Access-Client-Id": clientId } }, f);
		assert.equal(response.status, 403);
		assert.deepEqual(f.accesses, []);
	}
	// An unauthorized signed common_name cannot be replaced by a header for a mapped client.
	assert.equal((await request("/mailboxes/" + allowed, { jwt: await token({ common_name: "unknown.access" }), headers: { "CF-Access-Client-Id": clientId } })).status, 403);
});

test("verified browser email retains all mailboxes; local dev needs no authentication", async () => {
	const f = fixture();
	assert.equal((await request("/mailboxes/" + denied + "/emails", { jwt: browserJwt }, f)).status, 200);
	assert.equal((await (await request("/mailboxes", { jwt: browserJwt }, f)).json()).length, 2);
	assert.deepEqual((await (await request("/config", { jwt: browserJwt }, f)).json()).domains, ["example.com", "example.net"]);
	const dev = await loadApp(true);
	assert.equal((await request("/mailboxes/" + denied + "/emails", { jwt: "" }, fixture(), dev)).status, 200);
});
