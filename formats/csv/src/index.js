import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { TextFormat } from "qualve/format";

const isPrimitive = value =>
	value === null || (typeof value !== "object" && typeof value !== "function");

// CSV has no notion of a multi-value cell. Join an array of primitives into a
// human-friendly delimited string; leave every other value untouched so
// csv-stringify applies its own defaults (nested arrays/objects → JSON, etc.).
const joinCell = value =>
	Array.isArray(value) && value.every(isPrimitive) ? value.join(", ") : value;

const joinArrayCells = record =>
	Array.isArray(record)
		? record.map(joinCell)
		: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, joinCell(value)]));

/** CSV format (comma-delimited). */
class CsvFormat extends TextFormat {
	extensions = ["csv"];
	mimeTypes = ["text/csv"];
	delimiter = ",";

	parse (text, options) {
		return parse(text, { columns: true, skip_empty_lines: true, delimiter: this.delimiter, ...options });
	}

	serialize (data, options) {
		return stringify(data.map(joinArrayCells), { header: true, delimiter: this.delimiter, ...options });
	}
}

export const csv = CsvFormat.default;

/** TSV format: CSV with a tab delimiter. */
class TsvFormat extends CsvFormat {
	extensions = ["tsv"];
	mimeTypes = ["text/tab-separated-values"];
	delimiter = "\t";
}

export const tsv = TsvFormat.default;
