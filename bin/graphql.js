#!/usr/bin/env node
import * as runner from "../src/run/graphql.js";
import { run } from "./util/run.js";

const availableOptions = {
	questionId: {
		long: "question",
		short: "q",
	},
};

await run(runner, availableOptions);
