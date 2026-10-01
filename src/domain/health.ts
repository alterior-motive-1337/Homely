export type HealthState = "HEALTHY" | "ATTENTION" | "DEGRADED" | "FAILED" | "UNKNOWN";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AssetHealthInput {
  activeSeverities: Severity[];
  hasOverdueMaintenance: boolean;
  hasObservation: boolean;
}

export function deriveAssetHealth(input: AssetHealthInput): HealthState {
  if (input.activeSeverities.includes("CRITICAL")) return "FAILED";
  if (input.activeSeverities.includes("HIGH")) return "DEGRADED";
  if (
    input.activeSeverities.includes("MEDIUM") ||
    input.activeSeverities.includes("LOW") ||
    input.hasOverdueMaintenance
  ) return "ATTENTION";
  if (!input.hasObservation) return "UNKNOWN";
  return "HEALTHY";
}

const priority: Record<HealthState, number> = {
  FAILED: 5,
  DEGRADED: 4,
  ATTENTION: 3,
  UNKNOWN: 2,
  HEALTHY: 1
};

export function deriveSystemHealth(states: HealthState[]): HealthState {
  if (states.length === 0) return "UNKNOWN";
  return states.reduce((worst, current) =>
    priority[current] > priority[worst] ? current : worst
  );
}
