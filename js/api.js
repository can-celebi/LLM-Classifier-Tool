/**
 * OpenAI API Client
 * Handles the actual HTTP requests to OpenAI.
 */
class OpenAIClient {
    constructor(apiKey, model, temperature, seed, topLogprobs) {
        this.apiKey = apiKey;
        this.model = model;
        this.temperature = temperature;
        this.seed = seed;
        this.topLogprobs = topLogprobs;
    }

    async classify(id, input, systemPrompt, jsonSchema) {
        const url = "https://api.openai.com/v1/chat/completions";

        const payload = {
            model: this.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: input }
            ],
            temperature: parseFloat(this.temperature),
            response_format: JSON.parse(jsonSchema)
        };

        if (this.seed) {
            payload.seed = parseInt(this.seed);
        }

        if (this.topLogprobs && this.topLogprobs !== "null") {
            payload.logprobs = true;
            payload.top_logprobs = parseInt(this.topLogprobs);
        }

        const start = Date.now();
        
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(payload)
            });

            const duration = Date.now() - start;

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `HTTP ${response.status}`);
            }

            const data = await response.json();
            
            // Extract the relevant parts for our simpler output format
            const choice = data.choices[0];
            const content = choice.message.content;
            
            let parsedContent;
            try {
                parsedContent = JSON.parse(content);
            } catch (e) {
                parsedContent = content; // Fallback if not valid JSON (shouldn't happen with strict schema)
            }

            return {
                success: true,
                duration: duration,
                id: id,
                input: input,
                output: parsedContent,
                logprobs: choice.logprobs ? choice.logprobs.content : null,
                usage: data.usage,
                system_fingerprint: data.system_fingerprint
            };

        } catch (error) {
            return {
                success: false,
                duration: Date.now() - start,
                id: id,
                input: input,
                error: error.message
            };
        }
    }
}
