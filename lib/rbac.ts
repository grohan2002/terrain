// ---------------------------------------------------------------------------
// Role-Based Access Control (RBAC) — role hierarchy and permission checks.
// ---------------------------------------------------------------------------

/** Role hierarchy: VIEWER < CONVERTER < DEPLOYER < ADMIN */
const ROLE_HIERARCHY: Record<string, number> = {
  VIEWER: 0,
  CONVERTER: 1,
  DEPLOYER: 2,
  ADMIN: 3,
};

export type Role = keyof typeof ROLE_HIERARCHY;

/** Minimum role required for each protected action. */
const ROUTE_ROLES: Record<string, Role> = {
  "/api/convert": "CONVERTER",
  "/api/deploy": "DEPLOYER",
  "/api/deploy/setup": "DEPLOYER",
  "/api/deploy/destroy": "DEPLOYER",
  "/api/scan": "CONVERTER",
  "/api/cost-estimate": "CONVERTER",
  "/api/policy": "CONVERTER",
  "/api/history": "VIEWER",
  "/api/admin/audit": "ADMIN",
};

/** Returns true if `userRole` meets or exceeds `requiredRole`. */
export function hasPermission(userRole: string, requiredRole: Role): boolean {
  const userLevel = ROLE_HIERARCHY[userRole] ?? -1;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? Infinity;
  return userLevel >= requiredLevel;
}

/** Look up the minimum role for a given API path. Returns null if unprotected. */
export function getRequiredRole(pathname: string): Role | null {
  // Exact match first
  if (ROUTE_ROLES[pathname]) return ROUTE_ROLES[pathname];
  // Check prefix matches (e.g. /api/history/[id])
  for (const [route, role] of Object.entries(ROUTE_ROLES)) {
    if (pathname.startsWith(route + "/")) return role;
  }
  return null;
}
