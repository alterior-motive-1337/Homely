const viewerPersonalActions = new Set([
  "POST /api/homes/active",
  "POST /api/homes/invitations/accept",
  "POST /api/alerts/acknowledge",
  "POST /api/agent/respond",
  "POST /api/agent/conversations",
  "DELETE /api/account/delete",
  "DELETE /api/agent/history"
]);

export function viewerMayWrite(method: string, pathname: string): boolean {
  if (viewerPersonalActions.has(`${method} ${pathname}`)) return true;
  return method === "PATCH" && /^\/api\/agent\/conversations\/[^/]+$/.test(pathname);
}
