import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Format, { TextFormat, BinaryFormat, json } from "../src/format.js";

/** Stub text format — unique extension to avoid colliding with real formats. */
class StubTextFormat extends TextFormat {
	static extensions = ["stubfmt"];
	static mimeType = "application/x-stub";
	static parse (text) {
		return { parsed: text.trim() };
	}
	static serialize (data) {
		return `stub:${data.value ?? ""}`;
	}
}
Format.register(StubTextFormat);

/** Stub binary format that prefixes a magic byte. */
class StubBinaryFormat extends BinaryFormat {
	static extensions = ["stubbin"];
	static mimeType = "application/x-stub-binary";
	static parse (buffer) {
		return { magic: buffer[0], rest: buffer.subarray(1).toString("utf8") };
	}
	static serialize (data) {
		return Buffer.concat([Buffer.from([0xaa]), Buffer.from(data.rest ?? "", "utf8")]);
	}
}
Format.register(StubBinaryFormat);

/** Unregistered format — extensions: [] means no registration. */
class UnregisteredFormat extends TextFormat {
	static extensions = [];
	static mimeType = "text/x-unregistered";
	static parse (text) {
		return { raw: text };
	}
	static serialize (data) {
		return data.raw;
	}
}
Format.register(UnregisteredFormat);

function tmpPath (suffix) {
	return join(
		tmpdir(),
		`qualve-format-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
	);
}

export default {
	name: "Format",
	tests: [
		{
			name: "Registration",
			tests: [
				{
					name: "Registered format is looked up by extension",
					run: () => Format.byExtension.get("stubfmt"),
					expect: StubTextFormat,
				},
				{
					name: "Binary format is also registered",
					run: () => Format.byExtension.get("stubbin"),
					expect: StubBinaryFormat,
				},
				{
					name: "Format with extensions: [] is not registered",
					run: () => [...Format.byExtension.values()].includes(UnregisteredFormat),
					expect: false,
				},
				{
					name: "Unknown extension returns undefined",
					run: () => Format.byExtension.get("nonexistent"),
					expect: undefined,
				},
				{
					name: "Built-in json is registered under .json",
					run: () => Format.byExtension.get("json"),
					expect: json,
				},
			],
		},
		{
			name: "Base Format defaults",
			tests: [
				{
					name: "mimeType defaults to text/plain",
					run: () => Format.mimeType,
					expect: "text/plain",
				},
				{
					name: "binary is undefined (auto-detect)",
					run: () => Format.binary,
					expect: undefined,
				},
				{
					name: "parse is identity",
					run: () => Format.parse("hello"),
					expect: "hello",
				},
				{
					name: "serialize passes strings through",
					run: () => Format.serialize("hello"),
					expect: "hello",
				},
				{
					name: "serialize passes Buffers through",
					run: () =>
						Format.serialize(Buffer.from([1, 2, 3])).equals(Buffer.from([1, 2, 3])),
					expect: true,
				},
				{
					name: "serialize throws for non-string, non-Buffer data",
					throws: true,
					run: () => Format.serialize({ foo: "bar" }),
				},
			],
		},
		{
			name: "Base Format auto-detects binary vs text on read",
			tests: [
				{
					name: "Reads text file as UTF-8 string",
					run () {
						let path = tmpPath(".anytext");
						try {
							writeFileSync(path, "hello world");
							return Format.readSync(path);
						}
						finally {
							rmSync(path, { force: true });
						}
					},
					expect: "hello world",
				},
				{
					name: "Reads file with null bytes as Buffer",
					run () {
						let path = tmpPath(".anybin");
						try {
							writeFileSync(path, Buffer.from([0x89, 0x00, 0x01, 0x02]));
							let result = Format.readSync(path);
							return Buffer.isBuffer(result) && result[1] === 0;
						}
						finally {
							rmSync(path, { force: true });
						}
					},
					expect: true,
				},
			],
		},
		{
			name: "binary flag",
			tests: [
				{
					name: "TextFormat sets binary: false",
					run: () => TextFormat.binary,
					expect: false,
				},
				{
					name: "BinaryFormat sets binary: true",
					run: () => BinaryFormat.binary,
					expect: true,
				},
				{
					name: "Text format reports binary: false (via TextFormat)",
					run: () => StubTextFormat.binary,
					expect: false,
				},
				{
					name: "Binary format reports binary: true (via BinaryFormat)",
					run: () => StubBinaryFormat.binary,
					expect: true,
				},
				{
					name: "json inherits binary: false from TextFormat",
					run: () => json.binary,
					expect: false,
				},
			],
		},
		{
			name: "parse / serialize round-trip (text)",
			tests: [
				{
					name: "Stub text format parses input",
					run: () => StubTextFormat.parse("  hello  "),
					expect: { parsed: "hello" },
				},
				{
					name: "Stub text format serializes output",
					run: () => StubTextFormat.serialize({ value: "world" }),
					expect: "stub:world",
				},
			],
		},
		{
			name: "parse / serialize (binary)",
			tests: [
				{
					name: "Binary format parses Buffer input",
					run: () => StubBinaryFormat.parse(Buffer.from([0xaa, 0x68, 0x69])),
					expect: { magic: 0xaa, rest: "hi" },
				},
				{
					name: "Binary format serializes to Buffer",
					run: () =>
						StubBinaryFormat.serialize({ rest: "hi" }).equals(
							Buffer.from([0xaa, 0x68, 0x69]),
						),
					expect: true,
				},
			],
		},
		{
			name: "readSync / writeSync (text)",
			run () {
				let path = tmpPath(".stubfmt");
				try {
					StubTextFormat.writeSync(path, { value: "abc" });
					let onDisk = readFileSync(path, "utf8");
					let parsed = StubTextFormat.readSync(path);
					return { onDisk, parsed };
				}
				finally {
					rmSync(path, { force: true });
				}
			},
			expect: { onDisk: "stub:abc", parsed: { parsed: "stub:abc" } },
		},
		{
			name: "readSync / writeSync (binary)",
			run () {
				let path = tmpPath(".stubbin");
				try {
					StubBinaryFormat.writeSync(path, { rest: "hi" });
					let onDisk = readFileSync(path); // raw Buffer
					let parsed = StubBinaryFormat.readSync(path);
					return { firstByte: onDisk[0], length: onDisk.length, parsed };
				}
				finally {
					rmSync(path, { force: true });
				}
			},
			expect: { firstByte: 0xaa, length: 3, parsed: { magic: 0xaa, rest: "hi" } },
		},
		{
			name: "toBlob",
			tests: [
				{
					name: "Serializes object and wraps with mime type (text format)",
					async run () {
						let blob = StubTextFormat.toBlob({ value: "hi" });
						return { type: blob.type, text: await blob.text() };
					},
					expect: { type: "application/x-stub", text: "stub:hi" },
				},
				{
					name: "Serializes object and uses raw Buffer (binary format)",
					async run () {
						let blob = StubBinaryFormat.toBlob({ rest: "hi" });
						let bytes = [...new Uint8Array(await blob.arrayBuffer())];
						return { type: blob.type, bytes };
					},
					expect: { type: "application/x-stub-binary", bytes: [0xaa, 0x68, 0x69] },
				},
				{
					name: "String data passes through without re-serialization",
					async run () {
						let blob = json.toBlob("already a string");
						return { type: blob.type, text: await blob.text() };
					},
					expect: { type: "application/json", text: "already a string" },
				},
				{
					name: "Buffer data passes through without re-serialization",
					async run () {
						let blob = StubBinaryFormat.toBlob(Buffer.from([1, 2, 3]));
						let bytes = [...new Uint8Array(await blob.arrayBuffer())];
						return { type: blob.type, bytes };
					},
					expect: { type: "application/x-stub-binary", bytes: [1, 2, 3] },
				},
				{
					name: "Base Format uses text/plain mime type",
					async run () {
						let blob = Format.toBlob("hello");
						return { type: blob.type, text: await blob.text() };
					},
					expect: { type: "text/plain", text: "hello" },
				},
			],
		},
		{
			name: "json",
			tests: [
				{
					name: "Default serialize uses tab indentation",
					run: () => json.serialize({ a: 1 }),
					expect: '{\n\t"a": 1\n}',
				},
				{
					name: "compact: true produces no indentation",
					run: () => json.serialize({ a: 1, b: 2 }, { compact: true }),
					expect: '{"a":1,"b":2}',
				},
				{
					name: "compact: true strips null values",
					run: () => json.serialize({ a: 1, b: null, c: 3 }, { compact: true }),
					expect: '{"a":1,"c":3}',
				},
				{
					name: "compact: true strips undefined values",
					run: () => json.serialize({ a: 1, b: undefined, c: 3 }, { compact: true }),
					expect: '{"a":1,"c":3}',
				},
				{
					name: "Non-compact keeps null values",
					run: () => json.serialize({ a: 1, b: null }, { indent: "" }),
					expect: '{"a":1,"b":null}',
				},
				{
					name: "parse round-trips JSON",
					run: () => json.parse('{"a":1,"b":[2,3]}'),
					expect: { a: 1, b: [2, 3] },
				},
			],
		},
	],
};
