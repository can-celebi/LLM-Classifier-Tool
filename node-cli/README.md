# Node CLI Runner

This is a lightweight, Node-based alternative to the web UI. It reads a prompt, schema, and CSV on disk, then writes JSONL results.

## Requirements
- Node.js 18+ (for built-in `fetch`)

## Quick Start
```bash
node classify.js --key ../test-data/key.txt --testcase l1
```

## Usage
```bash
node classify.js \
  --key ../test-data/key.txt \
  --prompt ../test-data/l1/prompt.txt \
  --schema ../test-data/l1/schema.json \
  --csv ../test-data/l1/l1_subsample.csv \
  --model gpt-4o \
  --temperature 0 \
  --rpm 60
```

## Options
- `--key <path>`: Path to API key text file. You can also set `OPENAI_API_KEY`.
- `--testcase <l1|p1>`: Load bundled test cases from `../test-data`.
- `--prompt <path>`: System prompt file.
- `--schema <path>`: JSON schema or response_format file.
- `--csv <path>`: CSV file with input rows.
- `--id-col <name>`: ID column name (defaults to `localId`, `id`, or first column).
- `--text-col <name>`: Text column name (defaults to `input`, `text`, `message`).
- `--model <name>`: OpenAI model name.
- `--temperature <num>`: Sampling temperature.
- `--seed <num>`: Optional seed.
- `--top-logprobs <num>`: Enable logprobs with top-k.
- `--rpm <num>`: Target requests per minute.
- `--limit <num>`: Max rows to process.
- `--out <path>`: Output JSONL path.

## Output
The script writes a JSONL file with one response per line. Each line includes the input, output, duration, and error details if the request failed.

## Notes
- If your schema file is a raw JSON Schema (object with `properties`), the script wraps it into a `response_format` object automatically.
- If you moved the test data directory, update the paths in `node-cli/classify.js` under `TEST_CASES`.
