#!/usr/bin/env node
import * as runner from "../src/run/llm.js";
import { run } from "./util/run.js";

const availableOptions = {
	llm: {},
	model: {
		default: undefined,
	},
	fresh: {
		default: false,
		short: "f",
	},
	questionId: {
		long: "question",
		short: "q",
	},
};

await run(runner, availableOptions);
