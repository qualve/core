import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Format, { JsonFormat } from "../src/format.js";

/**
 * Stub text format: JS expression evaluation / stringification.
 * Uses a unique extension (`.stubfmt`) to avoid colliding with real formats.
 */
const StubTextFormat = new Format({
	extensions: ["stubfmt"],
	mimeType: "application/x-stub",
	parse: text => ({ parsed: text.trim() }),
	serialize: data => `stub:${data.value ?? ""}`,
});

/** Stub binary format that prefixes a magic byte. */
const StubBinaryFormat = new Format({
	extensions: ["stubbin"],
	mimeType: "application/x-stub-binary",
	binary: true,
	parse: buffer => ({ magic: buffer[0], rest: buffer.subarray(1).toString("utf8") }),
	serialize: data => Buffer.concat([Buffer.from([0xaa]), Buffer.from(data.rest ?? "", "utf8")]),
});

/** Unregistered format — for testing that extensions: [] skips registration. */
const unregisteredFormat = new Format({
	mimeType: "text/x-unregistered",
	parse: text => ({ raw: text }),
	serialize: data => data.raw,
});

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
					run: () => [...Format.byExtension.values()].includes(unregisteredFormat),
					expect: false,
				},
				{
					name: "Unknown extension returns undefined",
					run: () => Format.byExtension.get("nonexistent"),
					expect: undefined,
				},
				{
					name: "Built-in JsonFormat is registered under .json",
					run: () => Format.byExtension.get("json"),
					expect: JsonFormat,
				},
			],
		},
		{
			name: "Constructor validation",
			throws: true,
			tests: [
				{
					name: "Throws if parse missing",
					run: () => new Format({ serialize: () => "" }),
				},
				{
					name: "Throws if serialize missing",
					run: () => new Format({ parse: () => "" }),
				},
				{
					name: "Throws if both missing",
					run: () => new Format({}),
				},
			],
		},
		{
			name: "binary flag",
			tests: [
				{
					name: "Text format reports binary: false",
					run: () => StubTextFormat.binary,
					expect: false,
				},
				{
					name: "Binary format reports binary: true",
					run: () => StubBinaryFormat.binary,
					expect: true,
				},
				{
					name: "binary defaults to false when omitted",
					run: () => JsonFormat.binary,
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
			name: "JsonFormat",
			tests: [
				{
					name: "Default serialize uses tab indentation",
					run: () => JsonFormat.serialize({ a: 1 }),
					expect: '{\n\t"a": 1\n}',
				},
				{
					name: "compact: true produces no indentation",
					run: () => JsonFormat.serialize({ a: 1, b: 2 }, { compact: true }),
					expect: '{"a":1,"b":2}',
				},
				{
					name: "compact: true strips null values",
					run: () => JsonFormat.serialize({ a: 1, b: null, c: 3 }, { compact: true }),
					expect: '{"a":1,"c":3}',
				},
				{
					name: "compact: true strips undefined values",
					run: () =>
						JsonFormat.serialize({ a: 1, b: undefined, c: 3 }, { compact: true }),
					expect: '{"a":1,"c":3}',
				},
				{
					name: "Non-compact keeps null values",
					run: () => JsonFormat.serialize({ a: 1, b: null }, { indent: "" }),
					expect: '{"a":1,"b":null}',
				},
				{
					name: "parse round-trips JSON",
					run: () => JsonFormat.parse('{"a":1,"b":[2,3]}'),
					expect: { a: 1, b: [2, 3] },
				},
			],
		},
	],
};
