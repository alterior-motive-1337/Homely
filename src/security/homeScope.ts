import { AsyncLocalStorage } from "node:async_hooks";

// The home scope is set only after an authenticated membership is verified.
// Domain and agent code share the request context across awaited calls.
const homeContext = new AsyncLocalStorage<string>();
export function activeHomeId(): string | null {
  return homeContext.getStore() ?? null;
}
export function runInHome<T>(homeId: string, fn: () => T): T {
  if (!homeId || !/^home-[a-zA-Z0-9-]+$/.test(homeId)) throw new Error("Invalid home scope.");
  return homeContext.run(homeId,fn);
}
export function enterHome(homeId: string): void {
  if (!homeId || !/^home-[a-zA-Z0-9-]+$/.test(homeId)) throw new Error("Invalid home scope.");
  homeContext.enterWith(homeId);
}
