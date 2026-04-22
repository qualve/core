import Format from "./format.js";

/** Abstract base for text formats. */
export class TextFormat extends Format {
	static binary = false;
}

/** Abstract base for binary formats. */
export class BinaryFormat extends Format {
	static binary = true;
}

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

Format.register(JsonFormat);

export { JsonFormat as json };

class TxtFormat extends TextFormat {
	static extensions = ["txt"];
	static mimeType = "text/plain";
}

Format.register(TxtFormat);

export { TxtFormat as text };

export { Format };
export default Format;
