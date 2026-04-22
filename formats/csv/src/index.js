import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { TextFormat } from "qualve/format";

/** CSV format (comma-delimited). */
class CsvFormat extends TextFormat {
	extensions = ["csv"];
	mimeTypes = ["text/csv"];

	parse (text) {
		return parse(text, { columns: true, skip_empty_lines: true });
	}

	serialize (data) {
		return stringify(data, { header: true });
	}
}

export const csv = CsvFormat.default;

/** TSV format (tab-delimited). */
class TsvFormat extends TextFormat {
	extensions = ["tsv"];
	mimeTypes = ["text/tab-separated-values"];

	parse (text) {
		return parse(text, { columns: true, delimiter: "\t", skip_empty_lines: true });
	}

	serialize (data) {
		return stringify(data, { header: true, delimiter: "\t" });
	}
}

export const tsv = TsvFormat.default;
