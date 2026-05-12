import minimist from "minimist";
import { camelToKebab, matchPositionals } from "../../src/options.js";

/**
 * Parse argv against a schema. Runs minimist, then canonicalize, then matchPositionals.
 * Returns a flat object `{ ...canonicalFlags, _: unmatchedPositionals }`.
 * Pure: argv and schema are not mutated. Multiple calls with different schemas
 * produce independent results.
 */
export function parseArgs (argv = process.argv.slice(2), schema = {}) {
	let parsed = minimist(argv);
	let positionals = parsed._ ?? [];
	let flags = { ...parsed };
	delete flags._;
	flags = canonicalize(flags, schema);
	let matched = matchPositionals({ flags, _: positionals }, schema);
	return { ...matched.flags, _: matched._ };
}

/**
 * Move every flag from its alias key (long, short, kebab variant) to the canonical
 * option key declared in `schema`. Returns a new object; `flags` is not mutated.
 */
export function canonicalize (flags, schema) {
	let out = { ...flags };
	for (let key in schema) {
		if (key in out) {
			continue;
		}
		let { long, short } = schema[key];
		let alias = [long, short, camelToKebab(key)].find(a => a && a in out);
		if (alias) {
			out[key] = out[alias];
			delete out[alias];
		}
	}
	return out;
}
