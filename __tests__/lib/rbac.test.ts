import { describe, it, expect } from "vitest";
import { hasPermission, getRequiredRole } from "@/lib/rbac";

describe("hasPermission", () => {
  it("ADMIN can access everything", () => {
    expect(hasPermission("ADMIN", "VIEWER")).toBe(true);
    expect(hasPermission("ADMIN", "CONVERTER")).toBe(true);
    expect(hasPermission("ADMIN", "DEPLOYER")).toBe(true);
    expect(hasPermission("ADMIN", "ADMIN")).toBe(true);
  });

  it("DEPLOYER can convert but not admin", () => {
    expect(hasPermission("DEPLOYER", "CONVERTER")).toBe(true);
    expect(hasPermission("DEPLOYER", "DEPLOYER")).toBe(true);
    expect(hasPermission("DEPLOYER", "ADMIN")).toBe(false);
  });

  it("CONVERTER cannot deploy", () => {
    expect(hasPermission("CONVERTER", "CONVERTER")).toBe(true);
    expect(hasPermission("CONVERTER", "DEPLOYER")).toBe(false);
  });

  it("VIEWER can only view", () => {
    expect(hasPermission("VIEWER", "VIEWER")).toBe(true);
    expect(hasPermission("VIEWER", "CONVERTER")).toBe(false);
  });

  it("unknown role has no permissions", () => {
    expect(hasPermission("UNKNOWN", "VIEWER")).toBe(false);
  });
});

describe("getRequiredRole", () => {
  it("returns CONVERTER for convert route", () => {
    expect(getRequiredRole("/api/convert")).toBe("CONVERTER");
  });

  it("returns DEPLOYER for deploy routes", () => {
    expect(getRequiredRole("/api/deploy")).toBe("DEPLOYER");
    expect(getRequiredRole("/api/deploy/setup")).toBe("DEPLOYER");
    expect(getRequiredRole("/api/deploy/destroy")).toBe("DEPLOYER");
  });

  it("returns ADMIN for audit route", () => {
    expect(getRequiredRole("/api/admin/audit")).toBe("ADMIN");
  });

  it("returns VIEWER for history", () => {
    expect(getRequiredRole("/api/history")).toBe("VIEWER");
  });

  it("handles sub-paths via prefix matching", () => {
    expect(getRequiredRole("/api/history/some-id")).toBe("VIEWER");
  });

  it("returns null for unknown routes", () => {
    expect(getRequiredRole("/api/auth/callback")).toBeNull();
    expect(getRequiredRole("/some/page")).toBeNull();
  });
});
