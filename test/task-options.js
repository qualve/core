import { Task } from "../src/index.js";

// Construct a data task with a raw option bag, without running it.
let build = bag => Task.create({ type: "data", title: "T" }, { info: () => {}, options: bag });

export default {
	name: "Non-task options don't leak onto tasks",
	tests: [
		{
			name: "cli (help) and config (tasks) options are not applied as task fields; undeclared ones still are",
			run: () => {
				let task = build({ help: true, tasks: "x/**", custom: "v" });
				return {
					help: task.help,
					tasks: task.tasks,
					custom: task.custom,
					unknown: task.unknownOptions,
				};
			},
			expect: { help: undefined, tasks: undefined, custom: "v", unknown: { custom: "v" } },
		},
	],
};
