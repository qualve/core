import { Format, TextFormat } from "./format.js";

/** JSON format. */
export class JsonFormat extends TextFormat {
	extensions = ["json"];
	mimeTypes = ["application/json"];

	parse (text) {
		return JSON.parse(text);
	}

	serialize (data, { indent = "\t", replacer = null } = {}) {
		return JSON.stringify(data, replacer, indent);
	}
}

export const json = JsonFormat.default;

/** Generic plain-text format (`.txt`). */
export const text = new TextFormat({
	extension: "txt",
	mimeType: "text/plain",
});

export * from "./format.js";
export default Format;
