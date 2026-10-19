import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { EMAIL_SIZES, generateEmail } from "./mail-fixtures.mjs";
import { parsePagination, parseDateFilters, rawEmailKey } from "../../workers/lib/inbox.ts";

const load = async (entry) => {
	const result = await build({
		entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node",
		plugins: [{ name: "cloudflare-runtime", setup(builder) {
			builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "runtime", namespace: "test" }));
			builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }" }));
		} }],
	});
	return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
};
const { app, receiveEmail } = await load("workers/index.ts");
const { MailboxDO } = await load("workers/durableObject/index.ts");

// This adapter runs the real DO migration and queries against SQLite, without a Cloudflare service.
function makeStorage() {
	const db = new DatabaseSync(":memory:");
	const sql = { exec(query, ...params) {
		let values = params;
		if (/\?\d+/.test(query)) {
			values = [];
			query = query.replace(/\?(\d+)/g, (_, i) => { values.push(params[Number(i) - 1]); return "?"; });
		}
		let rows;
		if (query.trim().split(";").filter(s => s.trim()).length > 1) { db.exec(query); rows = []; }
		else rows = db.prepare(query).all(...values);
		const cursor = rows[Symbol.iterator]();
		cursor.toArray = () => rows;
		cursor.raw = () => ({ toArray: () => rows.map(row => Object.values(row)) });
		return cursor;
	} };
	return { sql, transactionSync(fn) { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}
function fixture() {
	const objects = new Map([["mailboxes/inbox@example.com.json", new TextEncoder().encode("{}")]]);
	const storage = makeStorage();
	const mailbox = new MailboxDO({ storage }, {});
	const routed = [];
	const env = {
		EMAIL_ADDRESSES: ["inbox@example.com"],
		BUCKET: {
			async head(key) { return objects.has(key) ? {} : null; },
			async put(key, value) { objects.set(key, typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)); },
			async get(key) { const bytes = objects.get(key); return bytes ? { body: bytes } : null; },
		},
		MAILBOX: { idFromName(id) { routed.push(id); return id; }, get() { return mailbox; } },
	};
	const ctx = { waitUntil() { throw new Error("No automatic background actions expected"); } };
	return { env, mailbox, objects, storage, routed, ctx };
}
function event(bytes, to = "inbox@example.com") {
	return { to, rawSize: bytes.length, raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) };
}
const endpoint = "/api/v1/mailboxes/inbox@example.com";
const ids = rows => rows.map(r => r.id);

test("positive integer pagination and ISO timezone normalization", () => {
	assert.deepEqual(parsePagination({}), { page: 1, limit: 25 });
	assert.deepEqual(parsePagination({ page: "2", limit: "200" }), { page: 2, limit: 100 });
	for (const v of ["0", "-1", "1.5", "NaN", "Infinity", "", "1e2"]) assert.throws(() => parsePagination({ page: v }), RangeError);
	assert.equal(parseDateFilters({ date_start: "2026-03-01T01:00:00+01:00" }).date_start, "2026-03-01T00:00:00.000Z");
	assert.throws(() => parseDateFilters({ date_before: "yesterday" }), RangeError);
});

test("envelope routing preserves forwarded To/Cc and raw bytes; BCC without To works", async () => {
	const f = fixture();
	const bytes = new TextEncoder().encode("From: sender@example.com\r\nTo: original@example.com\r\nCc: copy@example.com\r\nSubject: Forwarded\r\nDate: Mon, 01 Jan 2001 00:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOriginal café\r\n");
	await receiveEmail(event(bytes, "INBOX@example.com"), f.env, f.ctx);
	assert.deepEqual(f.routed, ["inbox@example.com"]);
	const [meta] = await f.mailbox.getEmails();
	const email = await f.mailbox.getEmail(meta.id);
	assert.equal(email.recipient, "original@example.com");
	assert.equal(email.cc, "copy@example.com");
	assert.match(email.body_text, /Original café/);
	assert.equal(email.body_html, null);
	assert.equal(email.body, email.body_text);
	assert.ok(email.date.startsWith(new Date().toISOString().slice(0, 10)));
	assert.deepEqual(f.objects.get(rawEmailKey("inbox@example.com", email.id)), bytes);
	const response = await app.request(endpoint + "/emails/" + email.id + "/raw", {}, f.env, f.ctx);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Content-Type"), "message/rfc822");
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
	const bcc = new TextEncoder().encode("From: sender@example.com\r\nSubject: BCC\r\nContent-Type: text/html\r\n\r\n<b>Private</b>");
	await receiveEmail(event(bcc), f.env, f.ctx);
	const bccEmail = (await f.mailbox.getEmails()).find(e => e.subject === "BCC");
	const full = await f.mailbox.getEmail(bccEmail.id);
	assert.equal(full.recipient, "");
	assert.equal(full.body_html.trim(), "<b>Private</b>");
	assert.equal(full.body, full.body_html);
});

test("unknown envelope recipients explicitly reject even if header To matches", async () => {
	const f = fixture();
	const bytes = new TextEncoder().encode("To: inbox@example.com\r\n\r\nRejected");
	let rejection;
	await receiveEmail({ ...event(bytes, "unknown@example.com"), setReject(reason) { rejection = reason; } }, f.env, f.ctx);
	assert.equal(rejection, "Unknown envelope recipient");
	assert.equal(await f.mailbox.countEmails(), 0);
	await assert.rejects(receiveEmail(event(bytes, "unknown@example.com"), f.env, f.ctx), /Unknown envelope/);
	f.env.EMAIL_ADDRESSES = [];
	await assert.rejects(receiveEmail(event(bytes, "missing@example.com"), f.env, f.ctx), /Unknown envelope/);
});

test("list/search/count/threaded apply inclusive start and exclusive before with stable id ties", async () => {
	const f = fixture();
	for (const [id, date] of [["a", "2026-03-01T00:00:00.000Z"], ["b", "2026-03-01T00:00:00.000Z"], ["c", "2026-03-02T00:00:00.000Z"], ["d", "2026-02-28T23:59:59.999Z"]]) {
		await f.mailbox.createEmail("inbox", { id, date, subject: id, sender: "sender@example.com", recipient: "inbox@example.com", body: "text", thread_id: id }, []);
	}
	const dates = { date_start: "2026-03-01T00:00:00.000Z", date_before: "2026-03-02T00:00:00.000Z" };
	assert.deepEqual(ids(await f.mailbox.getEmails(dates)), ["b", "a"]);
	assert.equal(await f.mailbox.countEmails(dates), 2);
	assert.deepEqual(ids(await f.mailbox.searchEmails(dates)), ["b", "a"]);
	assert.equal(await f.mailbox.countSearchResults(dates), 2);
	assert.deepEqual(ids(await f.mailbox.getThreadedEmails({ folder: "inbox", ...dates })), ["b", "a"]);
	assert.equal(await f.mailbox.countThreadedEmails("inbox", dates), 2);
	assert.deepEqual(ids(await f.mailbox.getEmails({ ...dates, limit: 1, page: 2 })), ["a"]);
	assert.deepEqual(ids(await f.mailbox.searchEmails({ ...dates, limit: 1, page: 2 })), ["a"]);
	assert.equal(await f.mailbox.countEmails({ date_end: "2026-03-01T00:00:00.000Z" }), 3);
	for (const route of ["/emails?folder=inbox&", "/search?"]) {
		const response = await app.request(endpoint + route + new URLSearchParams(dates), {}, f.env, f.ctx);
		const result = await response.json();
		assert.equal(response.status, 200);
		assert.deepEqual(ids(result.emails), ["b", "a"]);
		assert.equal(result.totalCount, 2);
	}
	for (const route of ["/emails?page=0", "/search?limit=1.5", "/emails?date_before=nope"]) assert.equal((await app.request(endpoint + route, {}, f.env, f.ctx)).status, 400);
});

test("has_attachment=false excludes attachments in search and its count", async () => {
	const f = fixture();
	for (const id of ["a", "b"]) await f.mailbox.createEmail("inbox", { id, date: "2026-03-01T00:00:00.000Z", subject: id, sender: "sender@example.com", recipient: "inbox@example.com", body: "text" }, id === "a" ? [{ id: "att", email_id: id, filename: "test.txt", mimetype: "text/plain", size: 1 }] : []);
	assert.deepEqual(ids(await f.mailbox.searchEmails({ has_attachment: false })), ["b"]);
	assert.equal(await f.mailbox.countSearchResults({ has_attachment: false }), 1);
	assert.deepEqual(ids(await f.mailbox.searchEmails({ has_attachment: true })), ["a"]);
	assert.equal(await f.mailbox.countSearchResults({ has_attachment: true }), 1);
});

test("removed sending/draft/delete endpoints return 404 and leave data intact", async () => {
	const f = fixture();
	assert.deepEqual((await f.mailbox.getFolders()).map(f => f.id).sort(), ["archive", "inbox", "spam", "trash"]);
	for (const [method, path] of [["POST", "/emails"], ["POST", "/drafts"], ["POST", "/emails/a/reply"], ["POST", "/emails/a/forward"], ["DELETE", ""], ["DELETE", "/emails/a"], ["DELETE", "/folders/inbox"]]) {
		assert.equal((await app.request(endpoint + path, { method }, f.env, f.ctx)).status, 404);
	}
	assert.ok(f.objects.has("mailboxes/inbox@example.com.json"));
});

for (const [label, size] of EMAIL_SIZES) {
	test("generated " + label + " preserves EML, parsed body and attachment bytes", async (t) => {
		const f = fixture();
		const { raw, attachment, bodyLength } = generateEmail(size);
		assert.equal(raw.length, size);
		const start = performance.now();
		await receiveEmail(event(raw), f.env, f.ctx);
		const [meta] = await f.mailbox.getEmails();
		const email = await f.mailbox.getEmail(meta.id);
		assert.equal(email.body_text.trim().length, bodyLength);
		assert.equal(email.attachments.length, 1);
		const att = email.attachments[0];
		assert.equal(att.size, attachment.length);
		const response = await app.request(endpoint + "/emails/" + meta.id + "/attachments/" + att.id, {}, f.env, f.ctx);
		assert.equal(response.status, 200);
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), attachment);
		const eml = await app.request(endpoint + "/emails/" + meta.id + "/raw", {}, f.env, f.ctx);
		assert.deepEqual(Buffer.from(await eml.arrayBuffer()), raw);
		t.diagnostic("Local Node wall time (not Cloudflare CPU): " + Math.round(performance.now() - start) + "ms; raw=" + size);
	});
}

test("deployment binds only private storage and the mailbox DO, never sending or AI", async () => {
	const config = JSON.parse(await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8"));
	assert.equal(config.name, "cf-agent-inbox");
	assert.equal(config.workers_dev, false);
	assert.equal(config.preview_urls, false);
	assert.equal(config.send_email, undefined);
	assert.equal(config.ai, undefined);
	assert.equal(config.routes, undefined);
	assert.deepEqual(config.durable_objects.bindings, [{ name: "MAILBOX", class_name: "MailboxDO" }]);
	assert.deepEqual(config.migrations, [{ tag: "v1", new_sqlite_classes: ["MailboxDO"] }]);
	assert.deepEqual(config.r2_buckets, [{ binding: "BUCKET", bucket_name: "cf-agent-inbox" }]);
});
