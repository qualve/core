import * as path from "node:path";
import File from "qualve/file";
import * as prompts from "./prompts.js";

/**
 * File subclass for LLM tasks.
 * Handles serialization, upload, remote file management, and prompt description.
 * Provider subclasses (ClaudeFile, GeminiFile, OpenAIFile) implement the provider-specific methods.
 */
export default class LLMFile extends File {
	/** Remote file object from the provider. Set after upload(). */
	remoteFile;

	/** Null-stripping JSON serialization for token efficiency. */
	toString () {
		let contents = this.contents;
		if (typeof contents === "string") {
			return contents;
		}
		return JSON.stringify(contents, (k, v) => v ?? undefined);
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

	get mimeType () {
		return path.extname(this.filename).toLowerCase() === ".json"
			? "application/json" : "text/plain";
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
	async doUpload () { throw new Error("Not implemented"); }

	/** Check if this file exists on the provider. Override in subclass. */
	async getRemote () { throw new Error("Not implemented"); }

	/** Delete this file from the provider. Override in subclass. */
	async deleteRemote () { throw new Error("Not implemented"); }
}
