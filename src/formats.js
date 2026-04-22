import { Format, TextFormat, BinaryFormat } from "./format.js";

/** Built-in JSON format. */
class JsonFormat extends TextFormat {
	static extensions = ["json"];
	static mimeType = "application/json";

	static parse (text) {
		return JSON.parse(text);
	}

	static serialize (data, { compact = false, indent, replacer } = {}) {
		indent ??= compact ? null : "\t";
		replacer ??= compact ? (k, v) => v ?? undefined : null;
		return JSON.stringify(data, replacer, indent);
	}
}

export const json = new JsonFormat();

export const text = new TextFormat({
	extension: "txt",
	mimeType: "text/plain",
});

export * from "./format.js";
export default Format;
