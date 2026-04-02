import LLMFile from "@qualve/llm/file";
import { toFile } from "@anthropic-ai/sdk";

export default class ClaudeFile extends LLMFile {
	async doUpload () {
		let { client } = this.context;
		return client.beta.files.upload(
			{
				// The Claude Files API doesn't support JSON files directly,
				// so to use them in prompts, we upload them with a text/plain MIME type that Claude supports.
				// See https://platform.claude.com/docs/en/build-with-claude/files#file-types-and-content-blocks
				file: await toFile(new Blob([this.toString()], { type: this.mimeType }), this.remoteFilename, {
					type: "text/plain",
				}),
			},
			{
				betas: ["files-api-2025-04-14"],
			},
		);
	}

	async getRemote () {
		let list = await this.context.listFiles();
		return list.find(f => f.filename === this.remoteFilename);
	}

	async deleteRemote () {
		let file = await this.getRemote();
		if (!file) {
			// Not found
			return;
		}
		return this.context.client.beta.files.delete(file.id, {
			betas: ["files-api-2025-04-14"],
		});
	}
}
