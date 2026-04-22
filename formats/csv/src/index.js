import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import Format, { TextFormat } from "qualve/format";

/** CSV format (comma-delimited). */
class CsvFormat extends TextFormat {
	static extensions = ["csv"];
	static mimeType = "text/csv";

	static parse (text) {
		return parse(text, { columns: true, skip_empty_lines: true });
	}

	static serialize (data) {
		return stringify(data, { header: true });
	}
}

Format.register(CsvFormat);

/** TSV format (tab-delimited). */
class TsvFormat extends TextFormat {
	static extensions = ["tsv"];
	static mimeType = "text/tab-separated-values";

	static parse (text) {
		return parse(text, { columns: true, delimiter: "\t", skip_empty_lines: true });
	}

	static serialize (data) {
		return stringify(data, { header: true, delimiter: "\t" });
	}
}

Format.register(TsvFormat);

export { CsvFormat as csv, TsvFormat as tsv };
