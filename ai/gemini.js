import { loadEnvFile } from "node:process";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

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
			systemInstruction: "Do not include any other text than the JSON array of physicists.",
			responseMimeType: "application/json",
			responseJsonSchema: {
				// See https://ai.google.dev/gemini-api/docs/structured-output?example=recipe#json_schema_support
				title: "Famous Physicists",
				type: Type.ARRAY,
				items: {
					type: Type.OBJECT,
					properties: {
						first_name: {
							type: Type.STRING,
						},
						middle_name: {
							type: Type.STRING,
						},
						last_name: {
							type: Type.STRING,
						},
					},
					required: ["first_name", "last_name"],
					additionalProperties: false,
				},
			},
			thinkingConfig: {
				// See https://ai.google.dev/gemini-api/docs/thinking#levels-budgets
				thinkingLevel: ThinkingLevel.LOW,
			},
		},
	});

	// Stream the response
	for await (const chunk of stream) {
		let text = chunk.candidates[0].content.parts[0].text;
		console.log(text, "\n");
	}

	// One of possible outputs (in the console):
	// 	[{"first_name":"Albert","last_name 
	//
	// ":"Einstein"},{"first_name":"Isaac","last_name":"Newton"},{"first_name":"Richard","middle_name 
	//
	// ":"Phillips","last_name":"Feynman"}] 
}

await main();
