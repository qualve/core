import { parse, stringify } from "yaml";
import { TextFormat } from "qualve/format";

/** YAML format — handles both .yaml and .yml extensions. */
class YamlFormat extends TextFormat {
	extensions = ["yaml", "yml"];
	mimeTypes = ["application/yaml"];

	parse (text) {
		return parse(text);
	}

	serialize (data) {
		return stringify(data);
	}
}

export const yaml = YamlFormat.default;
