#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const TEST_CASES = {
    l1: {
        label: "L1 Level (Subsample)",
        csv: path.join(__dirname, "..", "test-data", "l1", "l1_subsample.csv"),
        prompt: path.join(__dirname, "..", "test-data", "l1", "prompt.txt"),
        schema: path.join(__dirname, "..", "test-data", "l1", "schema.json")
    },
    p1: {
        label: "P1 Promise (Sample)",
        csv: path.join(__dirname, "..", "test-data", "p1", "p1_test.csv"),
        prompt: path.join(__dirname, "..", "test-data", "p1", "prompt.txt"),
        schema: path.join(__dirname, "..", "test-data", "p1", "schema.json")
    }
};

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_RPM = 60;

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) {
            args._.push(arg);
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
            args[key] = true;
        } else {
            args[key] = next;
            i++;
        }
    }
    return args;
}

function printUsage() {
    const usage = `Usage:
  node classify.js --key ../test-data/key.txt --testcase l1
  node classify.js --key ../test-data/key.txt --prompt <path> --schema <path> --csv <path>

Options:
  --key <path>           Path to API key text file (or use OPENAI_API_KEY env var)
  --testcase <l1|p1>     Use bundled test cases
  --prompt <path>        System prompt file
  --schema <path>        JSON schema or response_format file
  --csv <path>           CSV input file
  --id-col <name>        ID column name (default: localId/id/first column)
  --text-col <name>      Text column name (default: input/text/message)
  --model <name>         Model name (default: ${DEFAULT_MODEL})
  --temperature <num>    Sampling temperature (default: ${DEFAULT_TEMPERATURE})
  --seed <num>           Seed for reproducibility
  --top-logprobs <num>   Enable logprobs with top-k
  --rpm <num>            Target requests per minute (default: ${DEFAULT_RPM})
  --limit <num>          Max rows to process
  --out <path>           Output JSONL path (default: ./classification_results_<timestamp>.jsonl)
  --help                 Show this help
`;
    console.log(usage);
}

function readText(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

function parseJson(text, label) {
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(`Invalid JSON in ${label}: ${err.message}`);
    }
}

function normalizeSchema(schemaObj) {
    if (schemaObj && schemaObj.type === "json_schema" && schemaObj.json_schema) {
        return schemaObj;
    }
    if (schemaObj && schemaObj.json_schema && schemaObj.json_schema.schema) {
        return {
            type: "json_schema",
            json_schema: schemaObj.json_schema
        };
    }
    return {
        type: "json_schema",
        json_schema: {
            name: "classification",
            strict: true,
            schema: schemaObj
        }
    };
}

function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    const cleanText = text.replace(/^\uFEFF/, "");

    for (let i = 0; i < cleanText.length; i++) {
        const ch = cleanText[i];
        if (inQuotes) {
            if (ch === '"') {
                if (cleanText[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ",") {
                row.push(field);
                field = "";
            } else if (ch === "\n") {
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
            } else if (ch === "\r") {
                continue;
            } else {
                field += ch;
            }
        }
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

function parseCsv(text) {
    const rows = parseCsvRows(text);
    if (rows.length === 0) return { headers: [], data: [] };

    const headers = rows[0].map(h => String(h || "").trim());
    const data = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, idx) => {
            obj[h] = row[idx] ?? "";
        });
        return obj;
    }).filter(row => Object.values(row).some(val => String(val ?? "").trim() !== ""));

    return { headers, data };
}

function inferColumns(headers, args) {
    const headerSet = new Set(headers);
    const idCol = args["id-col"] || (headerSet.has("localId") ? "localId" : headerSet.has("id") ? "id" : headers[0]);
    const textCol = args["text-col"] || (headerSet.has("input") ? "input" : headerSet.has("text") ? "text" : headerSet.has("message") ? "message" : headers[1] || headers[0]);

    if (!headerSet.has(idCol)) {
        throw new Error(`ID column not found in CSV headers: ${idCol}`);
    }
    if (!headerSet.has(textCol)) {
        throw new Error(`Text column not found in CSV headers: ${textCol}`);
    }
    return { idCol, textCol };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function callOpenAI(apiKey, payload) {
    const url = "https://api.openai.com/v1/chat/completions";
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    return response.json();
}

async function main() {
    const args = parseArgs(process.argv);

    if (args.help) {
        printUsage();
        return;
    }

    let promptPath = args.prompt;
    let schemaPath = args.schema;
    let csvPath = args.csv;

    if (args.testcase) {
        const tc = TEST_CASES[args.testcase];
        if (!tc) {
            throw new Error(`Unknown testcase: ${args.testcase}`);
        }
        promptPath = promptPath || tc.prompt;
        schemaPath = schemaPath || tc.schema;
        csvPath = csvPath || tc.csv;
    }

    if (!promptPath || !schemaPath || !csvPath) {
        printUsage();
        throw new Error("Missing required file paths. Provide --testcase or --prompt/--schema/--csv.");
    }

    const keyPath = args.key ? path.resolve(args.key) : null;
    const apiKey = keyPath ? readText(keyPath).trim() : (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error("Missing API key. Provide --key or set OPENAI_API_KEY.");
    }

    const promptText = readText(path.resolve(promptPath));
    const schemaText = readText(path.resolve(schemaPath));
    const csvText = readText(path.resolve(csvPath));

    const schemaObj = normalizeSchema(parseJson(schemaText, "schema"));
    const { headers, data } = parseCsv(csvText);

    if (headers.length === 0 || data.length === 0) {
        throw new Error("CSV appears empty or invalid.");
    }

    const { idCol, textCol } = inferColumns(headers, args);

    const model = args.model || DEFAULT_MODEL;
    const temperature = args.temperature !== undefined ? Number(args.temperature) : DEFAULT_TEMPERATURE;
    const seed = args.seed !== undefined ? Number(args.seed) : null;
    const topLogprobs = args["top-logprobs"] !== undefined ? Number(args["top-logprobs"]) : null;
    const rpm = args.rpm !== undefined ? Number(args.rpm) : DEFAULT_RPM;
    const limit = args.limit !== undefined ? Number(args.limit) : null;

    if (!Number.isFinite(temperature)) {
        throw new Error("Temperature must be a number.");
    }
    if (seed !== null && !Number.isFinite(seed)) {
        throw new Error("Seed must be a number.");
    }
    if (topLogprobs !== null && !Number.isFinite(topLogprobs)) {
        throw new Error("Top logprobs must be a number.");
    }
    if (!Number.isFinite(rpm) || rpm <= 0) {
        throw new Error("RPM must be a positive number.");
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const outPath = path.resolve(args.out || `classification_results_${timestamp}.jsonl`);
    const outStream = fs.createWriteStream(outPath, { flags: "w" });

    const rows = limit ? data.slice(0, limit) : data;
    const delayMs = Math.ceil(60000 / rpm);

    console.log(`Running ${rows.length} rows with model ${model}. Output: ${outPath}`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const id = String(row[idCol]);
        const input = String(row[textCol] ?? "");

        const payload = {
            model,
            messages: [
                { role: "system", content: promptText },
                { role: "user", content: input }
            ],
            temperature,
            response_format: schemaObj
        };

        if (seed !== null) payload.seed = seed;
        if (topLogprobs !== null) {
            payload.logprobs = true;
            payload.top_logprobs = topLogprobs;
        }

        const start = Date.now();
        let result;
        try {
            const data = await callOpenAI(apiKey, payload);
            const choice = data.choices[0];
            const content = choice.message.content;
            let parsedContent;
            try {
                parsedContent = JSON.parse(content);
            } catch (err) {
                parsedContent = content;
            }

            result = {
                success: true,
                id,
                input,
                output: parsedContent,
                duration: Date.now() - start,
                model: data.model,
                logprobs: choice.logprobs ? choice.logprobs.content : null,
                usage: data.usage,
                system_fingerprint: data.system_fingerprint
            };
            successCount++;
        } catch (err) {
            result = {
                success: false,
                id,
                input,
                duration: Date.now() - start,
                error: err.message
            };
            errorCount++;
        }

        outStream.write(JSON.stringify(result) + "\n");
        console.log(`[${i + 1}/${rows.length}] ${id} -> ${result.success ? "OK" : "ERR"}`);

        if (i < rows.length - 1) {
            await sleep(delayMs);
        }
    }

    outStream.end();
    console.log(`Done. Success: ${successCount}. Errors: ${errorCount}.`);
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
