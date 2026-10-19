// Generated in memory: no real messages or large binary fixtures are stored in the repository.
export const EMAIL_SIZES = [
	["small", 4096],
	["1MiB", 1024 * 1024],
	["5MiB", 5 * 1024 * 1024],
	["near25MiB", 25 * 1024 * 1024 - 65536],
];

export function generateEmail(size) {
	// Keep the text body small; increase the attachment to reach each raw email size.
	const attachment = Buffer.alloc(Math.floor((size - 1024) * 3 / 4));
	for (let i = 0; i < attachment.length; i++) attachment[i] = i % 251;
	const head = "From: sender@example.com\r\nTo: original@example.com\r\nSubject: Generated attachment\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=fixture-boundary\r\n\r\n--fixture-boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n";
	const tail = "\r\n--fixture-boundary\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=fixture.bin\r\nContent-Transfer-Encoding: base64\r\n\r\n" + attachment.toString("base64") + "\r\n--fixture-boundary--\r\n";
	const bodyLength = size - Buffer.byteLength(head) - Buffer.byteLength(tail);
	if (bodyLength < 1) throw new RangeError("Fixture size is too small");
	const raw = Buffer.from(head + "x".repeat(bodyLength) + tail);
	return { raw, attachment, bodyLength };
}
