/**
 * Adaptive Rate Limiter
 * Dynamically adjusts concurrency based on response times to maximize throughput
 * without exceeding Target RPM (Requests Per Minute).
 */
class AdaptiveLimiter {
    constructor(targetRPM) {
        this.targetRPM = targetRPM;
        this.minConcurrency = 1;
        this.maxConcurrency = 50; // Hard cap for browser safety
        this.currentConcurrency = 1;
        
        // Sliding window for latency (ms)
        this.latencyHistory = [];
        this.windowSize = 20; // Keep last 20 requests
        
        // Counters
        this.activeRequests = 0;
        this.lastUpdateTime = Date.now();
    }

    setTargetRPM(rpm) {
        this.targetRPM = rpm;
    }

    recordLatency(ms) {
        this.latencyHistory.push(ms);
        if (this.latencyHistory.length > this.windowSize) {
            this.latencyHistory.shift();
        }
        this.updateConcurrency();
    }

    updateConcurrency() {
        if (this.latencyHistory.length < 5) return; // Need some data

        // Average Latency in Seconds
        const avgLatencyMs = this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
        const avgLatencySec = avgLatencyMs / 1000;

        // Little's Law: Concurrency = Throughput (req/sec) * Latency (sec)
        // Target Throughput = RPM / 60
        const targetRPS = this.targetRPM / 60;
        
        // Ideal Concurrency to hit target RPM given current latency
        let idealConcurrency = targetRPS * avgLatencySec;

        // Apply a safety factor (90% utilization) to avoid hitting hard limits
        idealConcurrency *= 0.9;

        // Smoothing: Don't jump too fast. Move 20% towards ideal.
        this.currentConcurrency = this.currentConcurrency * 0.8 + idealConcurrency * 0.2;

        // Clamp
        this.currentConcurrency = Math.max(this.minConcurrency, Math.min(this.maxConcurrency, this.currentConcurrency));
        
        // Round for display/logic (though we keep float for internal smoothing)
        // We use Math.ceil to be slightly aggressive on the integer conversion 
        // because effective RPM is usually lower due to gaps.
    }

    getEffectiveConcurrency() {
        return Math.round(this.currentConcurrency);
    }
    
    getAvgLatency() {
        if (this.latencyHistory.length === 0) return 0;
        return Math.round(this.latencyHistory.reduce((a,b)=>a+b,0) / this.latencyHistory.length);
    }

    getCurrentRPM() {
        const latencySec = this.getAvgLatency() / 1000;
        if (latencySec === 0) return 0;
        return Math.round((this.getEffectiveConcurrency() / latencySec) * 60);
    }
}
