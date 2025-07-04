// server/utils/erlang.js
export function erlangC(A, N) {
  // A = offered traffic (calls/hour * AHT in hours)
  // N = number of agents
  let invFact = 1;
  let sum = 1;
  for (let k = 1; k < N; k++) {
    invFact = invFact * (A / k);
    sum += invFact;
  }
  const P0 = 1 / (sum + invFact * (A / N) / (1 - A / N));
  const PC = (invFact * (A / N) * P0) / (1 - A / N);
  return PC; // probability a caller waits
}

export function requiredAgents({
  callsPerHour,
  ahtSeconds,
  targetServiceLevel, // e.g. 0.8 → 80% answered within threshold
  serviceThresholdSeconds,
  shrinkage,          // e.g. 0.3 for 30%
}) {
  // 1) compute traffic intensity A
  const A = callsPerHour * (ahtSeconds / 3600);
  // 2) brute-force search for smallest N where the SL is met:
  for (let N = 1; N < 500; N++) {
    const PC = erlangC(A, N);
    // P(wait ≤ T) = 1 – P(wait > T)
    // P(wait > T) = PC * exp(-(N – A) * T / (AHT hours * 3600))
    const expTerm = Math.exp(- (N - A) * (serviceThresholdSeconds / ahtSeconds));
    const SL = 1 - PC * expTerm;
    // adjust for shrinkage
    if (SL >= targetServiceLevel) {
      return Math.ceil(N / (1 - shrinkage));
    }
  }
  throw new Error("Couldn't meet service level with N<500");
}
