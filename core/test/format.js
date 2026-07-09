import Format, { TextFormat, BinaryFormat, json } from "../src/formats.js";

// Stub text format using instance class fields (registered on first lookup)
class StubTextFormat extends TextFormat {
	extensions = ["stubfmt"];
	mimeTypes = ["application/x-stub"];
	parse (text) {
		return { parsed: text.trim() };
	}
	serialize (data) {
		return `stub:${data.value ?? ""}`;
	}
}
const stubText = new StubTextFormat();

// Stub binary format using constructor options
class StubBinaryFormat extends BinaryFormat {
	parse (buffer) {
		return { magic: buffer[0], rest: buffer.subarray(1).toString("utf8") };
	}
	serialize (data) {
		return Buffer.concat([Buffer.from([0xaa]), Buffer.from(data.rest ?? "", "utf8")]);
	}
}
const stubBinary = new StubBinaryFormat({
	extensions: ["stubbin"],
	mimeType: "application/x-stub-binary",
});

// Latent format — no registration
const unregistered = new TextFormat({
	extension: "x-unregistered",
	mimeType: "text/x-unregistered",
	latent: true,
});

export default {
	name: "Format",
	tests: [
		{
			name: "Registration (lazy via lookup)",
			tests: [
				{
					name: "Text format registered by extension",
					run: () => Format.byExtension("stubfmt"),
					expect: stubText,
				},
				{
					name: "Binary format registered by extension",
					run: () => Format.byExtension("stubbin"),
					expect: stubBinary,
				},
				{
					name: "Text format registered by MIME type",
					run: () => Format.byMimeType("application/x-stub"),
					expect: stubText,
				},
				{
					name: "Binary format registered by MIME type",
					run: () => Format.byMimeType("application/x-stub-binary"),
					expect: stubBinary,
				},
				{
					name: "latent: true skips registration",
					run: () => Format.byExtension("x-unregistered"),
					expect: undefined,
				},
				{
					name: "Unknown extension returns undefined",
					run: () => Format.byExtension("nonexistent"),
					expect: undefined,
				},
				{
					name: "Built-in json is registered",
					run: () => Format.byExtension("json"),
					expect: json,
				},
				{
					name: "Format.all returns registered instances",
					run: () => Format.all.has(json) && Format.all.has(stubText) && !Format.all.has(unregistered),
					expect: true,
				},
			],
		},
		{
			name: "Base Format defaults (instance)",
			tests: [
				{
					name: "mimeType is undefined until set",
					run: () => new Format({ latent: true }).mimeType,
					expect: undefined,
				},
				{
					name: "binary is undefined (auto-detect)",
					run: () => new Format({ latent: true }).binary,
					expect: undefined,
				},
				{
					name: "parse is identity",
					run: () => new Format({ latent: true }).parse("hello"),
					expect: "hello",
				},
				{
					name: "serialize is identity",
					run: () => new Format({ latent: true }).serialize("hello"),
					expect: "hello",
				},
			],
		},
		{
			name: "binary flag",
			tests: [
				{
					name: "TextFormat instance has binary: false",
					run: () => new TextFormat({ latent: true }).binary,
					expect: false,
				},
				{
					name: "BinaryFormat instance has binary: true",
					run: () => new BinaryFormat({ latent: true }).binary,
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
					run: () => stubText.parse("  hello  "),
					expect: { parsed: "hello" },
				},
				{
					name: "Stub text format serializes output",
					run: () => stubText.serialize({ value: "world" }),
					expect: "stub:world",
				},
			],
		},
		{
			name: "parse / serialize (binary)",
			tests: [
				{
					name: "Binary format parses Buffer input",
					run: () => stubBinary.parse(Buffer.from([0xaa, 0x68, 0x69])),
					expect: { magic: 0xaa, rest: "hi" },
				},
				{
					name: "Binary format serializes to Buffer",
					run: () =>
						stubBinary.serialize({ rest: "hi" }).equals(Buffer.from([0xaa, 0x68, 0x69])),
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
					name: "indent: null produces no indentation",
					run: () => json.serialize({ a: 1, b: 2 }, { indent: null }),
					expect: '{"a":1,"b":2}',
				},
				{
					name: "replacer option is passed to JSON.stringify",
					run: () =>
						json.serialize(
							{ a: 1, b: null, c: 3 },
							{ indent: null, replacer: (k, v) => v ?? undefined },
						),
					expect: '{"a":1,"c":3}',
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
