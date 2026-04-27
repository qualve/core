import * as path from "node:path";
import File from "qualve/file";
import { JsonFormat } from "qualve/format";
import * as prompts from "./prompts.js";

/**
 * JSON variant tuned for LLM uploads: no indentation, null/undefined values
 * stripped via a replacer (both saves tokens). Unregistered (`latent: true`)
 * so it doesn't shadow the default JSON format for `.json` files.
 */
export const compactJson = new JsonFormat({
	indent: null,
	replacer: (k, v) => v ?? undefined,
	latent: true,
});

/**
 * File subclass for LLM tasks.
 * Handles serialization, upload, remote file management, and prompt description.
 * Provider subclasses (ClaudeFile, GeminiFile, OpenAIFile) implement the provider-specific methods.
 */
export default class LLMFile extends File {
	/** Remote file object from the provider. Set after upload(). */
	remoteFile;

	/**
	 * Format used for serializing this file for LLM upload.
	 * Defaults to compact JSON (null-stripping, no indentation — token-efficient).
	 * Overridable per-file or per-subclass (e.g. JSONL).
	 */
	get uploadFormat () {
		return compactJson;
	}

	/** Serialize contents for LLM upload using the upload format. */
	toString () {
		let contents = this.contents;
		if (typeof contents === "string") {
			return contents;
		}
		return this.uploadFormat.serialize(contents);
	}

	/** Wrap contents in a Blob using the upload format. */
	toBlob () {
		let f = this.uploadFormat;
		return new Blob([f.serialize(this.contents)], { type: f.mimeType });
	}

	/**
	 * Provider-namespaced remote filename for upload.
	 * Prefixes with the entity's shortest unique ID for uniqueness.
	 * For shared files (not under an entity), no prefix is needed.
	 */
	get remoteFilename () {
		let prefix = this.context?.entity?.uniquePrefix;
		let name = path.basename(this.path);
		return (prefix ? prefix + "-" : "") + name;
	}

	/**
	 * Idempotent upload. No-op if already uploaded. Re-uploads if fresh.
	 * @returns {object} Remote file object (provider-specific)
	 */
	async upload () {
		if (this.remoteFile) {
			return this.remoteFile;
		}

		let fresh = this.fresh ?? this.context?.fresh;

		if (fresh) {
			this.context?.info(`Removing previously uploaded file ${this.path} ...`);
			await this.deleteRemote();
		}

		this.remoteFile = !fresh ? await this.getRemote() : null;

		if (!this.remoteFile) {
			this.context?.info(`Uploading ${this.path} ...`);
			this.remoteFile = await this.doUpload();
		}

		this.context?.info(`Source file ${this.path} ready`);
		return this.remoteFile;
	}

	/**
	 * Describe this file for inclusion in an LLM prompt.
	 * @param {object} [options]
	 * @param {"input" | "output"} [options.role="input"]
	 */
	describe ({ role = "input" } = {}) {
		let fn = role === "output" ? prompts.outputFile : prompts.inputFile;
		return fn.call(this.context, this);
	}

	/** Provider-specific upload implementation. Override in subclass. */
	async doUpload () {
		throw new Error("Not implemented");
	}

	/** Check if this file exists on the provider. Override in subclass. */
	async getRemote () {
		throw new Error("Not implemented");
	}

	/** Delete this file from the provider. Override in subclass. */
	async deleteRemote () {
		throw new Error("Not implemented");
	}
}
