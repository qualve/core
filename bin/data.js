#!/usr/bin/env node
import * as runner from "../src/run/data.js";
import { run } from "./util/run.js";

const availableOptions = {
	questionId: {
		long: "question",
		short: "q",
	},
	input: {
		short: "i",
	},
	output: {
		short: "o",
	},
};

await run(runner, availableOptions);
