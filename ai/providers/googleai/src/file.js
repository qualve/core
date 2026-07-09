import { createHash } from "node:crypto";
import LLMFile from "@qualve/llm/file";

export default class GeminiFile extends LLMFile {
	get remoteFilename () {
		let name = super.remoteFilename;
		// Gemini file ID: lowercase alphanumeric or dashes, no leading/trailing dashes.
		name = name.replace(/[_.]/g, "-").replace(/^-|-$/g, "");

		// Gemini file IDs are limited to 40 chars.
		// Batch slice inputs can exceed this (e.g. "ba-answers-normalized-unique-500-999-json").
		// Truncate with a hash suffix to preserve uniqueness.
		let maxLength = 40;
		if (name.length > maxLength) {
			let hash = createHash("sha256").update(name).digest("hex").slice(0, 6);
			name = name.slice(0, maxLength - 7) + "-" + hash;
		}

		return name;
	}

	/** Display name for the Gemini API (preserves original filename format). */
	get displayName () {
		return super.remoteFilename;
	}

	async doUpload () {
		let { client } = this.context;
		return client.files.upload({
			file: this.toBlob(),
			config: {
				name: this.remoteFilename,
				displayName: this.displayName,
				mimeType: this.mimeType,
			},
		});
	}

	/**
	 * Look up this file on Gemini, with error handling for not-found cases.
	 * Gemini returns 403 (not 404) when a file doesn't exist, so we disambiguate
	 * by listing files to check whether it's a real permission error.
	 * @returns {Promise<object|null>}
	 */
	async getRemote () {
		let name = "files/" + this.remoteFilename;

		try {
			// If we don't await here, the error is unhandled
			return await this.context.client.files.get({ name });
		}
		catch (e) {
			if (e.status === 403 || e.status === 404) {
				// 403 can mean "not found" on Gemini — verify by listing files.
				// 404 is a straightforward not-found.
				if (e.status === 403) {
					let files = await this.context.client.files.list();
					for await (let file of files) {
						if (file.name === name) {
							throw new Error(
								`You don't have permission to access file ${this.path}`,
								{ cause: e },
							);
						}
					}
				}
			}
			else {
				throw new Error(`Failed to get file ${this.path}`, { cause: e });
			}
		}

		// Not found
		return null;
	}
}
