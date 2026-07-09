import LLMFile from "@qualve/llm/file";

export default class OpenAIFile extends LLMFile {
	async doUpload () {
		let { client } = this.context;
		return client.files.create({
			file: new File([this.toBlob()], this.remoteFilename, { type: this.mimeType }),
			purpose: "user_data",
		});
	}

	async getRemote () {
		let list = await this.context.listFiles();
		return list.find(f => f.filename === this.remoteFilename);
	}
}
