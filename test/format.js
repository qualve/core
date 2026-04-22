import Format from "../src/format.js";
import { TextFormat, BinaryFormat, json } from "../src/formats.js";

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
					name: "serialize passes other data types through unchanged",
					run: () => Format.serialize({ foo: "bar" }),
					expect: { foo: "bar" },
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
