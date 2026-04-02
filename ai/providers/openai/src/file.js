import LLMFile from "@qualve/llm/file";

export default class OpenAIFile extends LLMFile {
	async doUpload () {
		let { client } = this.context;
		return client.files.create({
			file: new File([this.toString()], this.remoteFilename, { type: this.mimeType }),
			purpose: "user_data",
		});
	}

	async getRemote () {
		let list = await this.context.listFiles();
		return list.find(f => f.filename === this.remoteFilename);
	}

	async deleteRemote () {
		let file = await this.getRemote();
		if (!file) {
			return null;
		}
		await this.context.client.files.delete(file.id);
	}
}
