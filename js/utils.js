// Pricing Data (USD per 1M tokens) - Updated Jan 2026
const PRICING = {
    "gpt-4o": { input: 2.50, output: 10.00 },
    "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "gpt-4-turbo": { input: 10.00, output: 30.00 },
    "gpt-3.5-turbo": { input: 0.50, output: 1.50 }
};

// Default Rate Limits (RPM) based on Tier 1 usage
const RATE_LIMITS = {
    "gpt-4o": 500,
    "gpt-4o-mini": 500,
    "gpt-4-turbo": 500,
    "gpt-3.5-turbo": 3500
};

// Heuristic Tokenizer
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
}

function calculateCostEstimate(model, systemPrompt, csvRows, textCol, outputTokensPerReq = 20) {
    if (!PRICING[model]) return null;

    const rates = PRICING[model];
    const sysTokens = estimateTokens(systemPrompt);
    
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    csvRows.forEach(row => {
        const text = row[textCol] || ""; // Handle null/undefined
        const inputTokens = estimateTokens(text);
        // Total input = System Prompt + User Message + Overhead (approx 10)
        totalInputTokens += (sysTokens + inputTokens + 10);
        
        // Total output = Estimated response size
        totalOutputTokens += outputTokensPerReq;
    });

    const inputCost = (totalInputTokens / 1_000_000) * rates.input;
    const outputCost = (totalOutputTokens / 1_000_000) * rates.output;
    
    return {
        totalInputTokens,
        totalOutputTokens,
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost,
        currency: "USD"
    };
}

function calculateCostFromUsage(model, usage) {
    if (!PRICING[model] || !usage) return null;
    const rates = PRICING[model];
    const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const inputCost = (inputTokens / 1_000_000) * rates.input;
    const outputCost = (outputTokens / 1_000_000) * rates.output;
    return inputCost + outputCost;
}

// Helper to extract classification from schema-compliant JSON output
function extractClassificationValue(outputObj) {
    if (!outputObj) return "null";
    
    // Check main 'classification' field
    if (outputObj.classification !== undefined) return String(outputObj.classification);
    
    // Check p1/p2/p3 for multi-player
    if (outputObj.p1 !== undefined) {
        let parts = [];
        if (outputObj.p1) parts.push(`p1:${outputObj.p1}`);
        if (outputObj.p2) parts.push(`p2:${outputObj.p2}`);
        if (outputObj.p3) parts.push(`p3:${outputObj.p3}`);
        return parts.join(", ");
    }
    
    // Fallback: try to find the first string value in properties
    if (typeof outputObj === 'object') {
        const keys = Object.keys(outputObj);
        if (keys.length > 0) return String(outputObj[keys[0]]);
    }
    
    return JSON.stringify(outputObj);
}

function processTokenLogprob(item) {
    const top1 = Math.exp(item.logprob);
    let margin = 0;
    let alternatives = [];
    
    if (item.top_logprobs && item.top_logprobs.length > 0) {
        // Sort descending (API usually does this, but be safe)
        const sorted = item.top_logprobs.sort((a,b) => b.logprob - a.logprob);
        
        // Calculate margin
        if (sorted.length > 1) {
            margin = Math.exp(sorted[0].logprob) - Math.exp(sorted[1].logprob);
        } else {
            margin = top1; // If only 1 option exists (rare with temp>0), margin is high
        }

        // Format alternatives for display
        alternatives = sorted.map(t => ({
            token: t.token,
            prob: Math.exp(t.logprob).toFixed(4)
        }));
    }

    return {
        token: item.token,
        top1: top1,
        margin: margin,
        alternatives: alternatives
    };
}

function getSchemaEnumValues(schemaStr) {
    if (!schemaStr) return [];
    try {
        const schemaObj = (typeof schemaStr === 'string') ? JSON.parse(schemaStr) : schemaStr;
        const schema = schemaObj.json_schema?.schema || schemaObj;
        if (schema?.enum && Array.isArray(schema.enum)) return schema.enum.map(String);
        const props = schema?.properties || null;
        if (!props) return [];
        for (const key of Object.keys(props)) {
            const prop = props[key];
            if (prop?.enum && Array.isArray(prop.enum)) return prop.enum.map(String);
        }
    } catch (e) { return []; }
    return [];
}

function getSchemaTokenProbabilities(logprobs, classValue, schemaStr) {
    if (!logprobs || !Array.isArray(logprobs)) return [];
    const values = getSchemaEnumValues(schemaStr);
    if (values.length === 0) return [];

    const target = String(classValue ?? "").trim();
    let focusItem = null;

    for (const item of logprobs) {
        const cleanToken = item.token.replace(/["\s]/g, "");
        if (cleanToken === target || target.includes(cleanToken)) {
            focusItem = item;
            break;
        }
    }

    if (!focusItem) {
        for (const item of logprobs) {
            const cleanToken = item.token.replace(/["\s]/g, "");
            if (values.some(val => String(val).replace(/["\s]/g, "") === cleanToken)) {
                focusItem = item;
                break;
            }
        }
    }

    const top = focusItem?.top_logprobs || [];
    const topMap = new Map(
        top.map(t => [t.token.replace(/["\s]/g, ""), Math.exp(t.logprob)])
    );

    return values.map(val => {
        const key = String(val).replace(/["\s]/g, "");
        const prob = topMap.has(key) ? topMap.get(key) : null;
        return {
            token: String(val),
            prob: prob
        };
    });
}

/**
 * Smart Confidence Extraction with Schema Awareness
 * 1. Parses Schema to find expected keys (e.g. "classification", "p1")
 * 2. Scans tokens to find the key
 * 3. Scans forward from key to find the value token
 * 4. Fallback: Scans for value token directly if key-based search fails
 */
function getConfidenceData(logprobs, classValue, schemaStr) {
    if (!logprobs || !Array.isArray(logprobs)) return null;
    
    const target = String(classValue).trim();
    let keyNames = [];

    // 1. Extract keys from Schema
    try {
        if (schemaStr) {
            const schemaObj = (typeof schemaStr === 'string') ? JSON.parse(schemaStr) : schemaStr;
            // Handle standard JSON Schema structure
            const props = schemaObj.json_schema?.schema?.properties || schemaObj.properties;
            if (props) {
                keyNames = Object.keys(props);
            }
        }
    } catch (e) { console.warn("Schema parse error in confidence extraction", e); }

    // If no specific keys found (or simple schema), default to 'classification' or fallback
    if (keyNames.length === 0) keyNames = ["classification"];

    // 2. Strategy A: Key-Anchored Search
    // We look for "key" -> ":" -> "value" sequence
    for (const key of keyNames) {
        // Find key token index
        let keyIdx = -1;
        for (let i = 0; i < logprobs.length; i++) {
            const tok = logprobs[i].token.replace(/["\s]/g, ""); // Strip quotes/space
            if (tok === key) {
                keyIdx = i;
                break;
            }
        }

        if (keyIdx !== -1) {
            // Found key, scan forward for colon and then value
            // Limit scan to next 10 tokens to avoid runaway
            for (let j = keyIdx + 1; j < Math.min(keyIdx + 10, logprobs.length); j++) {
                const tok = logprobs[j].token;
                
                // Skip structural tokens
                if (tok.match(/^\s*[:"{\[,]\s*$/)) continue; 
                
                // Clean token for comparison
                const cleanTok = tok.replace(/["{},:\s]/g, "");
                
                if (cleanTok.length > 0) {
                    // This is the first "meaningful" token after the key.
                    // It SHOULD be our value.
                    // Let's verify if it matches our extracted value (or is a valid part of it)
                    if (target.includes(cleanTok) || cleanTok === target) {
                        return processTokenLogprob(logprobs[j]);
                    }
                }
            }
        }
    }

    // 3. Strategy B: Value Scan (Fallback)
    // Same as before: scan for token matching the value
    for (const item of logprobs) {
        const token = item.token;
        const cleanToken = token.replace(/["{},:\s]/g, ""); 
        
        if (cleanToken === target && cleanToken.length > 0) {
            return processTokenLogprob(item);
        }
    }
    
    // 4. Strategy C: Heuristic Number/Boolean search (Last Resort)
    for (const item of logprobs) {
        const token = item.token;
        if (token.match(/[0-9]|true|false|yes|no/i) && !token.includes(":")) {
             return processTokenLogprob(item);
        }
    }

    return null; 
}

// Helper to escape HTML characters
function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
