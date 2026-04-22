import { parse, stringify } from "yaml";
import Format, { TextFormat } from "qualve/format";

/** YAML format — handles both .yaml and .yml extensions. */
class YamlFormat extends TextFormat {
	static extensions = ["yaml", "yml"];
	static mimeType = "application/yaml";

	static parse (text) {
		return parse(text);
	}

	static serialize (data) {
		return stringify(data);
	}
}

Format.register(YamlFormat);

export { YamlFormat as yaml };
