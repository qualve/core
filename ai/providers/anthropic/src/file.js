import LLMFile from "@qualve/llm/file";
import { toFile } from "@anthropic-ai/sdk";

export default class ClaudeFile extends LLMFile {
	async doUpload () {
		let { client } = this.context;
		// The Claude Files API doesn't support JSON files directly,
		// so we upload JSON content under a text/plain MIME type that Claude accepts.
		// See https://platform.claude.com/docs/en/build-with-claude/files#file-types-and-content-blocks
		return client.beta.files.upload({
			file: await toFile(this.toBlob(), this.remoteFilename, { type: "text/plain" }),
		});
	}

	async getRemote () {
		let list = await this.context.listFiles();
		return list.find(f => f.filename === this.remoteFilename);
	}
}
