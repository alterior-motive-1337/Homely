// Operational state describes an appliance's actual record, not its age or
// an inferred failure probability. Issue/maintenance signals can raise attention,
// but only an explicit failed condition says the item is out of service.
export type OperationalState = "WORKING" | "NEEDS_ATTENTION" | "OUT_OF_SERVICE" | "UNASSESSED";

export function classifyAssetState(condition: unknown, health: unknown): OperationalState {
  const c=String(condition??"UNKNOWN").toUpperCase();
  const h=String(health??"UNKNOWN").toUpperCase();
  if(c==="FAILED")return "OUT_OF_SERVICE";
  if(["FAIR","POOR"].includes(c)||["ATTENTION","DEGRADED","FAILED"].includes(h))
    return "NEEDS_ATTENTION";
  if(["GOOD","WORKING"].includes(c))return "WORKING";
  return "UNASSESSED";
}
