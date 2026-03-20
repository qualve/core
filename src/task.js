import Task from "./types/task.js";

// Side-effect imports: each module self-registers on Task or LLMTask.
import "./types/data.js";
import "./types/graphql.js";
import "./types/llm.js";
import "./llms/gemini.js";
import "./llms/claude.js";
import "./llms/openai.js";

export default Task;
