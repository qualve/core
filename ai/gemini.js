import { loadEnvFile } from "node:process";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

loadEnvFile(".env");

const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY,
});

async function main () {
	const prompt = "Provide a list of 3 famous physicists.";

	const stream = await ai.models.generateContentStream({
		model: "gemini-3-flash-preview",
		contents: prompt,
		config: {
			responseMimeType: "application/json",
			responseJsonSchema: {
				// See https://ai.google.dev/gemini-api/docs/structured-output?example=recipe#json_schema_support
				title: "Famous Physicists",
				type: "array",
				items: {
					type: "object",
					properties: {
						first_name: {
							type: "string",
						},
						middle_name: {
							type: "string",
						},
						last_name: {
							type: "string",
						},
					},
					required: ["first_name", "last_name"],
					additionalProperties: false,
				},
			},
			thinkingConfig: {
				thinkingLevel: ThinkingLevel.LOW,
			},
		},
	});

	// Stream the response
	for await (const chunk of stream) {
		let text = chunk.candidates[0].content.parts[0].text;
		console.log(text, "\n\n");
	}
}

await main();
