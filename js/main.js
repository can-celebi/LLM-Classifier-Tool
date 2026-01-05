// Global State
let state = {
    csvData: [],
    results: [], // Array of { id, success, output, error, ... }
    isRunning: false,
    processedCount: 0,
    errorCount: 0,
    limiter: null,
    client: null,
    reviewIndex: 0,
    // Charts
    chartConf: null,
    chartMargin: null,
    confBins: new Array(10).fill(0),
    marginBins: new Array(10).fill(0)
};

const TEST_DATA_BASE = 'test-data';

const TEST_CASES = {
    l1: {
        label: 'L1 Level (Subsample)',
        csv: `${TEST_DATA_BASE}/l1/l1_subsample.csv`,
        prompt: `${TEST_DATA_BASE}/l1/prompt.txt`,
        schema: `${TEST_DATA_BASE}/l1/schema.json`
    },
    p1: {
        label: 'P1 Promise (Sample)',
        csv: `${TEST_DATA_BASE}/p1/p1_test.csv`,
        prompt: `${TEST_DATA_BASE}/p1/prompt.txt`,
        schema: `${TEST_DATA_BASE}/p1/schema.json`
    }
};

// Prevent global drag/drop
window.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; });
window.addEventListener('drop', e => e.preventDefault());

// Safety warning
window.addEventListener('beforeunload', (e) => {
    if (state.isRunning || state.results.length > 0 || state.csvData.length > 0) {
        e.preventDefault();
        e.returnValue = ''; 
    }
});

// UI Helpers
const ui = {
    log: (msg, type = 'info') => {
        const logEl = document.getElementById('activity-log');
        const timestamp = new Date().toLocaleTimeString();
        const safeMsg = escapeHtml(String(msg));
        logEl.innerHTML += `<div class="log-${type}">[${timestamp}] ${safeMsg}</div>`;
        logEl.scrollTop = logEl.scrollHeight;
    },
    toggleSection: (id) => {
        const el = document.getElementById(id);
        el.classList.toggle('hidden');
    },
    updateStats: () => {
        // Calculate real progress based on total vs results
        const total = state.csvData.length;
        const completed = state.results.length;
        
        document.getElementById('stat-progress').innerText = `${completed} / ${total}`;
        document.getElementById('stat-errors').innerText = state.errorCount;
        
        if (state.limiter) {
            document.getElementById('stat-concurrency').innerText = state.limiter.getEffectiveConcurrency();
            document.getElementById('stat-rpm').innerText = state.limiter.getCurrentRPM();
        } else {
            document.getElementById('stat-concurrency').innerText = '0';
            document.getElementById('stat-rpm').innerText = '0';
        }

        const pct = total > 0 ? (completed / total) * 100 : 0;
        document.getElementById('progress-bar').style.width = `${pct}%`;
    },
    addResultRow: (result) => {
        const container = document.getElementById('results-table-body');
        const div = document.createElement('div');
        div.className = 'result-row';
        
        const safeId = escapeHtml(String(result.id ?? ""));
        const durationSec = typeof result.duration === 'number' ? (result.duration / 1000).toFixed(2) + 's' : 'N/A';
        const costText = typeof result.cost === 'number' ? `$${result.cost.toFixed(4)}` : 'N/A';
        let statusHtml = result.success 
            ? `<span class="status-badge status-success">200 OK</span>` 
            : `<span class="status-badge status-error">ERR</span>`;

        let classVal = "N/A";
        let top1 = "N/A";
        let margin = "N/A";
        let alternativesHtml = "<em>No logprobs available</em>";

        if (result.success && result.output) {
            classVal = extractClassificationValue(result.output);
            
            // Get current schema string from UI for context
            const schemaStr = document.getElementById('json-schema').value;

            // Smart extraction using utils.js with schema awareness
            if (result.logprobs) {
                const confData = getConfidenceData(result.logprobs, classVal, schemaStr);
                if (confData) {
                    top1 = confData.top1;
                    margin = confData.margin;
                }
            }
        }

        const schemaProbs = getSchemaTokenProbabilities(
            result.logprobs,
            classVal,
            document.getElementById('json-schema').value
        );
        if (schemaProbs.length > 0) {
            alternativesHtml = `<table style="width:100%; font-size:0.8rem; border-collapse: collapse;">
                <tr style="border-bottom:1px solid #ddd; text-align:left;"><th>Token</th><th>Prob</th></tr>`;
            schemaProbs.forEach(item => {
                const prob = typeof item.prob === 'number' ? item.prob.toFixed(4) : 'Below top-k';
                alternativesHtml += `<tr>
                    <td style="padding:2px; font-family:monospace;">${escapeHtml(item.token)}</td>
                    <td style="padding:2px;">${prob}</td>
                </tr>`;
            });
            alternativesHtml += `</table>`;
        }

        const safeClassVal = escapeHtml(String(classVal));
        const displayTop1 = typeof top1 === 'number' ? top1.toFixed(3) : top1;
        const displayMargin = typeof margin === 'number' ? margin.toFixed(3) : margin;
        const safeOutput = escapeHtml(JSON.stringify(result.output));
        const safeError = result.error ? escapeHtml(String(result.error)) : '';
        const safeFingerprint = escapeHtml(String(result.system_fingerprint || 'N/A'));
        const safeModel = escapeHtml(String(result.model || state.client?.model || 'N/A'));

        div.innerHTML = `
            <div>${statusHtml}</div>
            <div style="font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${safeId}">${safeId}</div>
            <div style="font-weight:600;">${safeClassVal}</div>
            <div>${displayTop1}</div>
            <div>${displayMargin}</div>
            <div>${durationSec}</div>
            <div>${costText}</div>
            <div><button type="button" class="secondary-btn" style="padding:2px 8px; font-size:0.7rem;" onclick="toggleDetails(this)">Details</button></div>
            <div class="result-details hidden">
                <div style="margin-bottom:10px;">
                    <strong>Input:</strong>
                    <div style="background:#fff; padding:5px; border:1px solid #eee; margin-top:2px; max-height:100px; overflow-y:auto; font-family:sans-serif;">${escapeHtml(result.input)}</div>
                </div>
                <div class="row">
                    <div class="half">
                        <strong>Model:</strong> ${safeModel}<br>
                        <strong>Fingerprint:</strong> ${safeFingerprint}<br>
                        <strong>Duration:</strong> ${durationSec}<br>
                        <strong>Cost:</strong> ${costText}
                    </div>
                    <div class="half">
                        <strong>Schema Token Probabilities:</strong>
                        <div style="background:#fff; border:1px solid #eee; margin-top:2px;">
                            ${alternativesHtml}
                        </div>
                    </div>
                </div>
                <div style="margin-top:10px;">
                    <strong>Output:</strong> ${safeOutput} <br>
                    ${result.error ? `<strong style="color:red">Error: ${safeError}</strong>` : ''}
                </div>
            </div>
        `;
        container.insertBefore(div, container.firstChild);
        
        if (typeof top1 === 'number') updateCharts(top1, typeof margin === 'number' ? margin : 0);
    }
};

window.toggleSection = ui.toggleSection;
window.toggleDetails = (btn) => {
    const details = btn.parentElement.nextElementSibling;
    details.classList.toggle('hidden');
};

// ... Drop Zone Setup (same as before) ...
function setupDropZone(zoneId, inputId, textId, type) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    
    if (!zone || !input) return; // Safety check

    input.addEventListener('change', (e) => handleFile(e.target.files[0], textId, type));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('dragover'); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation(); zone.classList.remove('dragover');
        handleFile(e.dataTransfer.files[0], textId, type);
    });
}
function handleFile(file, textId, type) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        let content = e.target.result;
        if (type === 'api') document.getElementById('api-key').value = content.trim();
        else if (type === 'prompt') document.getElementById('system-prompt').value = content;
        else if (type === 'schema') document.getElementById('json-schema').value = content;
        if (textId) {
            const textEl = document.getElementById(textId);
            if (textEl) textEl.textContent = file.name;
        }
        ui.log(`Loaded ${file.name}`, 'success');
    };
    reader.readAsText(file);
}
setupDropZone('drop-api-key', 'file-api-key', 'api-key-text', 'api');
setupDropZone('drop-prompt', 'file-prompt', 'prompt-text', 'prompt');
setupDropZone('drop-schema', 'file-schema', 'schema-text', 'schema');


// CSV Upload
document.getElementById('csv-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
        header: true,
        skipEmptyLines: 'greedy', // Better filtering of empty rows
        complete: (results) => {
            if (results.data.length > 0) {
                // Sanitization: Keep rows that have at least one non-empty cell
                state.csvData = results.data.filter(row => {
                    if (!row) return false;
                    return Object.values(row).some(val => String(val ?? '').trim() !== '');
                });
                if (state.csvData.length === 0) {
                    ui.log('CSV appears empty or invalid after filtering.', 'error');
                    return;
                }
                resetRunState();
                ui.log(`Loaded ${state.csvData.length} valid rows from CSV.`, 'success');
                populateColumnSelectors(Object.keys(state.csvData[0]));
            } else {
                ui.log('CSV appears empty or invalid.', 'error');
            }
        },
        error: (err) => {
            ui.log(`CSV Parse Error: ${err.message}`, 'error');
        }
    });
});

function populateColumnSelectors(headers) {
    const idSelect = document.getElementById('col-id');
    const textSelect = document.getElementById('col-text');
    idSelect.innerHTML = '';
    textSelect.innerHTML = '';
    headers.forEach(h => {
        idSelect.add(new Option(h, h));
        textSelect.add(new Option(h, h));
    });
    if (headers.includes('localId')) idSelect.value = 'localId';
    else if (headers.includes('id')) idSelect.value = 'id';
    if (headers.includes('input')) textSelect.value = 'input';
    else if (headers.includes('text')) textSelect.value = 'text';
    else if (headers.includes('message')) textSelect.value = 'message';
    document.getElementById('column-mapping').classList.remove('hidden');
    document.getElementById('section-review').classList.remove('hidden');
    checkStartReady();
    state.reviewIndex = 0;
    updateReviewPanel();
}

function checkStartReady() {
    const hasData = state.csvData.length > 0;
    document.getElementById('btn-start').disabled = !hasData;
}

function resetRunState() {
    state.results = [];
    state.processedCount = 0;
    state.errorCount = 0;
    state.isRunning = false;
    state.limiter = null;
    if (state.chartConf) state.chartConf.destroy();
    if (state.chartMargin) state.chartMargin.destroy();
    state.chartConf = null;
    state.chartMargin = null;
    state.confBins = new Array(10).fill(0);
    state.marginBins = new Array(10).fill(0);
    document.getElementById('results-table-body').innerHTML = '';
    document.getElementById('section-results').classList.add('hidden');
    const startBtn = document.getElementById('btn-start');
    startBtn.classList.remove('hidden');
    startBtn.innerText = 'Start Classification';
    document.getElementById('btn-stop').classList.add('hidden');
    document.getElementById('btn-download').disabled = true;
    document.getElementById('progress-bar').style.width = '0%';
    ui.updateStats();
    updateResultsSummary();
}

function updateReviewPanel() {
    const total = state.csvData.length;
    const reviewSection = document.getElementById('section-review');
    if (!total) {
        reviewSection.classList.add('hidden');
        return;
    }
    reviewSection.classList.remove('hidden');
    if (state.reviewIndex < 0) state.reviewIndex = 0;
    if (state.reviewIndex >= total) state.reviewIndex = total - 1;
    const row = state.csvData[state.reviewIndex];
    const idCol = document.getElementById('col-id').value;
    const textCol = document.getElementById('col-text').value;
    document.getElementById('review-index').innerText = String(state.reviewIndex + 1);
    document.getElementById('review-total').innerText = String(total);
    document.getElementById('review-id').value = row?.[idCol] ?? '';
    document.getElementById('review-text').value = row?.[textCol] ?? '';
    const disabled = state.isRunning;
    document.getElementById('review-id').disabled = disabled;
    document.getElementById('review-text').disabled = disabled;
    document.getElementById('btn-review-prev').disabled = disabled || state.reviewIndex === 0;
    document.getElementById('btn-review-next').disabled = disabled || state.reviewIndex === total - 1;
    document.getElementById('btn-review-delete').disabled = disabled;
}

function handleReviewEdit() {
    const row = state.csvData[state.reviewIndex];
    if (!row) return;
    const idCol = document.getElementById('col-id').value;
    const textCol = document.getElementById('col-text').value;
    row[idCol] = document.getElementById('review-id').value;
    row[textCol] = document.getElementById('review-text').value;
    if (state.results.length > 0) resetRunState();
}

document.getElementById('btn-review-prev').addEventListener('click', () => {
    state.reviewIndex = Math.max(0, state.reviewIndex - 1);
    updateReviewPanel();
});
document.getElementById('btn-review-next').addEventListener('click', () => {
    state.reviewIndex = Math.min(state.csvData.length - 1, state.reviewIndex + 1);
    updateReviewPanel();
});
document.getElementById('btn-review-delete').addEventListener('click', () => {
    if (state.csvData.length === 0) return;
    state.csvData.splice(state.reviewIndex, 1);
    if (state.reviewIndex >= state.csvData.length) state.reviewIndex = state.csvData.length - 1;
    if (state.results.length > 0) resetRunState();
    checkStartReady();
    updateReviewPanel();
});
document.getElementById('review-id').addEventListener('input', handleReviewEdit);
document.getElementById('review-text').addEventListener('input', handleReviewEdit);
document.getElementById('col-id').addEventListener('change', updateReviewPanel);
document.getElementById('col-text').addEventListener('change', updateReviewPanel);

document.getElementById('btn-load-testcase').addEventListener('click', async () => {
    const key = document.getElementById('testcase-select').value;
    if (!key || !TEST_CASES[key]) return;
    const tc = TEST_CASES[key];
    try {
        const [promptText, schemaText, csvText] = await Promise.all([
            fetch(tc.prompt).then(r => r.text()),
            fetch(tc.schema).then(r => r.text()),
            fetch(tc.csv).then(r => r.text())
        ]);

        document.getElementById('system-prompt').value = promptText;
        document.getElementById('json-schema').value = schemaText;
        const promptLabel = document.getElementById('prompt-text');
        const schemaLabel = document.getElementById('schema-text');
        if (promptLabel) promptLabel.textContent = tc.prompt.split('/').pop();
        if (schemaLabel) schemaLabel.textContent = tc.schema.split('/').pop();

        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: 'greedy',
            complete: (results) => {
                state.csvData = results.data.filter(row => {
                    if (!row) return false;
                    return Object.values(row).some(val => String(val ?? '').trim() !== '');
                });
                if (state.csvData.length === 0) {
                    ui.log('Test case CSV appears empty after filtering.', 'error');
                    return;
                }
                resetRunState();
                ui.log(`Loaded test case: ${tc.label} (${state.csvData.length} rows).`, 'success');
                populateColumnSelectors(Object.keys(state.csvData[0]));
            },
            error: (err) => {
                ui.log(`CSV Parse Error: ${err.message}`, 'error');
            }
        });
    } catch (err) {
        ui.log(`Failed to load test case: ${err.message}`, 'error');
    }
});

// Cost & Model Listeners (same as before)
document.getElementById('btn-calc-cost').addEventListener('click', () => {
    if (state.csvData.length === 0) return alert("Please upload a CSV file first.");
    const model = document.getElementById('model-select').value;
    const sysPrompt = document.getElementById('system-prompt').value;
    const textCol = document.getElementById('col-text').value;
    const est = calculateCostEstimate(model, sysPrompt, state.csvData, textCol, 20);
    if (est) {
        document.getElementById('est-input-tokens').innerText = est.totalInputTokens.toLocaleString();
        document.getElementById('est-output-tokens').innerText = est.totalOutputTokens.toLocaleString();
        document.getElementById('est-total-cost').innerText = '$' + est.totalCost.toFixed(4);
        document.getElementById('cost-results').classList.remove('hidden');
        if (RATE_LIMITS[model]) document.getElementById('rpm-limit').value = RATE_LIMITS[model];
    } else alert("Could not calculate pricing for this model.");
});
document.getElementById('model-select').addEventListener('change', (e) => {
    if (RATE_LIMITS[e.target.value]) document.getElementById('rpm-limit').value = RATE_LIMITS[e.target.value];
});

// Charts
function initCharts() {
    const ctxConf = document.getElementById('chart-conf').getContext('2d');
    const ctxMargin = document.getElementById('chart-margin').getContext('2d');
    if (state.chartConf) state.chartConf.destroy();
    if (state.chartMargin) state.chartMargin.destroy();
    state.confBins = new Array(10).fill(0);
    state.marginBins = new Array(10).fill(0);
    const labels = ['0.0-0.1', '0.1-0.2', '0.2-0.3', '0.3-0.4', '0.4-0.5', '0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9', '0.9-1.0'];

    state.chartConf = new Chart(ctxConf, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Confidence Count',
                data: state.confBins,
                backgroundColor: 'rgba(37, 99, 235, 0.6)',
                borderColor: 'rgba(37, 99, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { title: { display: true, text: 'Confidence Distribution' } },
            scales: { y: { beginAtZero: true } }
        }
    });

    state.chartMargin = new Chart(ctxMargin, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Margin Count',
                data: state.marginBins,
                backgroundColor: 'rgba(34, 197, 94, 0.6)',
                borderColor: 'rgba(34, 197, 94, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { title: { display: true, text: 'Margin Distribution' } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function updateCharts(conf, margin) {
    if (!state.chartConf) initCharts();
    let confBin = Math.floor(conf * 10);
    if (confBin >= 10) confBin = 9; if (confBin < 0) confBin = 0;
    let marginBin = Math.floor(margin * 10);
    if (marginBin >= 10) marginBin = 9; if (marginBin < 0) marginBin = 0;
    state.confBins[confBin]++;
    state.marginBins[marginBin]++;
    state.chartConf.update('none');
    state.chartMargin.update('none');
}

// EXECUTION LOGIC with RETRY
document.getElementById('btn-start').addEventListener('click', async () => {
    const apiKey = document.getElementById('api-key').value.trim();
    if (!apiKey) return alert('Please enter an API Key.');
    
    const idCol = document.getElementById('col-id').value;
    const textCol = document.getElementById('col-text').value;
    const systemPrompt = document.getElementById('system-prompt').value;
    const jsonSchemaStr = document.getElementById('json-schema').value;
    const rpmLimit = parseInt(document.getElementById('rpm-limit').value);
    
    let jsonSchema;
    try { JSON.parse(jsonSchemaStr); jsonSchema = jsonSchemaStr; } 
    catch (e) { return alert('Invalid JSON Schema.'); }

    // Check if we are retrying or starting fresh
    // If state.results has items and we have errors, we define "todo list" as items not in results or items with error
    
    // Set of IDs that are successfully completed
    const completedIds = new Set(
        state.results
            .filter(r => r.success)
            .map(r => String(r.id))
    );

    // Filter CSV data to find what's left
    const todoList = state.csvData.filter(row => {
        if (!row) return false; // Skip empty/null rows
        const id = String(row[idCol]);
        return !completedIds.has(id);
    });

    if (todoList.length === 0) {
        return alert("All items have been successfully classified!");
    }

    if (state.results.length > 0) {
        ui.log(`Resuming/Retrying. ${todoList.length} items remaining.`, 'info');
    } else {
        ui.log(`Starting fresh run with ${todoList.length} items.`, 'info');
        document.getElementById('results-table-body').innerHTML = '';
        initCharts();
    }

    state.isRunning = true;
    state.limiter = new AdaptiveLimiter(rpmLimit);
    state.client = new OpenAIClient(
        apiKey,
        document.getElementById('model-select').value,
        document.getElementById('temperature').value,
        document.getElementById('seed').value,
        document.getElementById('top-logprobs').value
    );
    
    document.getElementById('section-results').classList.remove('hidden');
    document.getElementById('btn-start').classList.add('hidden');
    document.getElementById('btn-stop').classList.remove('hidden');
    document.getElementById('btn-download').disabled = true;
    updateReviewPanel();

    // Execution Loop
    let currentIndex = 0;
    const total = todoList.length;
    const activePromises = new Set();

    const processNext = async () => {
        if (!state.isRunning) return;
        if (currentIndex >= total && activePromises.size === 0) {
            finishRun();
            return;
        }

        const maxConcurrency = state.limiter.getEffectiveConcurrency();
        
        while (activePromises.size < maxConcurrency && currentIndex < total && state.isRunning) {
            const index = currentIndex++;
            const row = todoList[index];
            const id = row[idCol];
            const text = row[textCol];

            if (!text) {
                handleResult({
                    success: false,
                    duration: 0,
                    id: id,
                    input: text,
                    error: 'Input text is empty'
                });
                ui.updateStats();
                continue;
            }

            const p = state.client.classify(id, text, systemPrompt, jsonSchema)
                .then(result => {
                    handleResult(result);
                    state.limiter.recordLatency(result.duration);
                })
                .finally(() => {
                    activePromises.delete(p);
                    processNext(); 
                    ui.updateStats();
                });

            activePromises.add(p);
        }

        if (state.isRunning && currentIndex < total) {
            setTimeout(processNext, 200);
        }
    };

    processNext();
});

document.getElementById('btn-stop').addEventListener('click', () => {
    state.isRunning = false;
    ui.log('Stopping run...', 'warn');
    // Change button text to "Resume/Retry" visually
    const btn = document.getElementById('btn-start');
    btn.innerText = "Resume / Retry Failed";
    btn.classList.remove('hidden');
    document.getElementById('btn-stop').classList.add('hidden');
    document.getElementById('btn-download').disabled = false;
    updateReviewPanel();
});

function handleResult(result) {
    // If retrying, remove old error result for this ID if it exists
    const existingIdx = state.results.findIndex(r => String(r.id) === String(result.id));
    if (existingIdx !== -1) {
        const existing = state.results[existingIdx];
        state.results.splice(existingIdx, 1);
        // Decrease error count if the replaced one was an error
        if (existing && !existing.success && state.errorCount > 0) {
            state.errorCount--;
        }
    }

    if (result.success) {
        result.model = state.client?.model || result.model;
        if (result.usage) {
            result.cost = calculateCostFromUsage(result.model, result.usage);
        }
    }

    if (result.success) {
        state.processedCount++; // Note: this is a bit fuzzy with retries, but acceptable for progress bar
        state.results.push(result);
        ui.addResultRow(result);
    } else {
        state.errorCount++;
        state.results.push(result);
        ui.log(`Error on ID ${result.id}: ${result.error}`, 'error');
        ui.addResultRow(result);
        if (result.error && result.error.includes("429")) {
            state.limiter.currentConcurrency = Math.max(1, state.limiter.currentConcurrency / 2);
            ui.log('Rate limit hit, reducing concurrency.', 'warn');
        }
    }
    updateResultsSummary();
}

function finishRun() {
    state.isRunning = false;
    ui.log(`Run complete. Errors: ${state.errorCount}`, 'success');
    
    const btn = document.getElementById('btn-start');
    if (state.errorCount > 0) {
        btn.innerText = "Retry Failed Items";
    } else {
        btn.innerText = "Start Classification"; // Reset
    }
    
    btn.classList.remove('hidden');
    document.getElementById('btn-stop').classList.add('hidden');
    document.getElementById('btn-download').disabled = false;
    updateReviewPanel();
    updateResultsSummary();
}

function updateResultsSummary() {
    const model = state.client?.model || 'N/A';
    const fingerprints = new Set(state.results.map(r => r.system_fingerprint).filter(Boolean));
    const totalDurationMs = state.results.reduce((sum, r) => sum + (r.duration || 0), 0);
    const totalCost = state.results.reduce((sum, r) => sum + (typeof r.cost === 'number' ? r.cost : 0), 0);
    document.getElementById('stat-model').innerText = model;
    document.getElementById('stat-fingerprints').innerText = String(fingerprints.size);
    document.getElementById('stat-total-time').innerText = (totalDurationMs / 1000).toFixed(2) + 's';
    document.getElementById('stat-total-cost').innerText = `$${totalCost.toFixed(4)}`;
}

// Download... (same as before)
document.getElementById('btn-download').addEventListener('click', () => {
    if (state.results.length === 0) return;
    let jsonl = '';
    state.results.forEach(r => { jsonl += JSON.stringify(r) + '\n'; });
    const blob = new Blob([jsonl], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().slice(0,19).replace(/:/g, '-');
    a.download = `classification_results_${timestamp}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});
