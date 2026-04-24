import { Format, TextFormat } from "./format.js";

/** JSON format. */
class JsonFormat extends TextFormat {
	extensions = ["json"];
	mimeTypes = ["application/json"];

	parse (text) {
		return JSON.parse(text);
	}

	serialize (data, { compact = false, indent, replacer } = {}) {
		indent ??= compact ? null : "\t";
		replacer ??= compact ? (k, v) => v ?? undefined : null;
		return JSON.stringify(data, replacer, indent);
	}
}

export const json = JsonFormat.default;

/**
 * JSON with `compact: true` baked into `serializeOptions` — no indentation,
 * null/undefined values stripped. Intended for LLM uploads and any other
 * token-sensitive or size-sensitive context. Not registered by extension
 * (`latent: true`) so it doesn't shadow {@link json} for `.json` files.
 */
export const compactJson = new JsonFormat({ compact: true, latent: true });

/** Generic plain-text format (`.txt`). */
export const text = new TextFormat({
	extension: "txt",
	mimeType: "text/plain",
});

export * from "./format.js";
export default Format;
