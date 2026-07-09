import path from "node:path";

/**
 * Describe a single input file for inclusion in the prompt.
 * Called with `this` bound to the LLMTask instance.
 * @param {object} file
 * @returns {string}
 */
export function inputFile (file) {
	let ret = [];

	if (file.description && !this.capabilities.inputDescriptions) {
		ret.push(`containing ${file.description}`);
	}

	if (file.schema && !this.capabilities.inputSchema) {
		ret.push(`follows the JSON schema: ${JSON.stringify(file.schema, null, "\t")}`);
	}

	ret = ret.join(" and ");

	if (!ret.startsWith("containing")) {
		ret = "which " + ret;
	}

	ret = `\`${path.basename(file.filePath)}\` ${ret}.`;

	if (file.schema) {
		ret += "\nRead the field descriptions in the JSON schema for details on each field.";
	}

	return ret;
}

/**
 * Describe all input files for inclusion in the prompt.
 * @param {LLMFile[]} files
 * @returns {string}
 */
export function inputFiles (files) {
	if (files.length === 0) {
		return "";
	}

	return `I provide the contents of the following files:
${files.map(file => file.describe()).join("\n")}`;
}

/**
 * Describe the expected output file for inclusion in the prompt.
 * Called with `this` bound to the LLMTask instance.
 * @param {object} file
 * @returns {string}
 */
export function outputFile (file) {
	let ret = [`Produce a JSON file that I’m going to save as \`${path.basename(file.filePath)}\``];

	if (file.description && !this.capabilities.outputDescriptions) {
		ret.push(`containing ${file.description}`);
	}

	if (file.schema && !this.capabilities.outputSchema) {
		ret.push(`following the JSON schema: ${JSON.stringify(file.schema, null, "\t")}`);
	}

	if (ret.length <= 1) {
		ret = ret[0];
	}
	else {
		if (ret.length === 3) {
			ret[2] = "and " + ret[2];
		}

		ret = ret.join(", ");
	}

	if (file.schema) {
		ret += ".\nRead the field descriptions in the JSON schema for details on each field.";
	}

	return ret;
}
