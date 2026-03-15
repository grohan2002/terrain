import { describe, it, expect } from "vitest";
import {
  RESOURCE_TYPE_MAP,
  PROPERTY_DECOMPOSITIONS,
  PROPERTY_NAME_OVERRIDES,
  extractStorageTier,
  extractStorageReplication,
} from "@/lib/mappings";

// ---------------------------------------------------------------------------
// RESOURCE_TYPE_MAP completeness
// ---------------------------------------------------------------------------

describe("RESOURCE_TYPE_MAP", () => {
  it("has at least 100 entries", () => {
    const count = Object.keys(RESOURCE_TYPE_MAP).length;
    expect(count).toBeGreaterThanOrEqual(100);
  });

  it("maps core compute resources", () => {
    expect(RESOURCE_TYPE_MAP["Microsoft.Compute/virtualMachines"]).toBe(
      "azurerm_linux_virtual_machine",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Compute/virtualMachineScaleSets"]).toBe(
      "azurerm_linux_virtual_machine_scale_set",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Compute/disks"]).toBe("azurerm_managed_disk");
    expect(RESOURCE_TYPE_MAP["Microsoft.Compute/availabilitySets"]).toBe(
      "azurerm_availability_set",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Compute/snapshots"]).toBe("azurerm_snapshot");
    expect(RESOURCE_TYPE_MAP["Microsoft.Compute/sshPublicKeys"]).toBe(
      "azurerm_ssh_public_key",
    );
  });

  it("maps core storage resources", () => {
    expect(RESOURCE_TYPE_MAP["Microsoft.Storage/storageAccounts"]).toBe(
      "azurerm_storage_account",
    );
    expect(
      RESOURCE_TYPE_MAP["Microsoft.Storage/storageAccounts/blobServices/containers"],
    ).toBe("azurerm_storage_container");
    expect(
      RESOURCE_TYPE_MAP["Microsoft.Storage/storageAccounts/managementPolicies"],
    ).toBe("azurerm_storage_management_policy");
  });

  it("maps core networking resources", () => {
    expect(RESOURCE_TYPE_MAP["Microsoft.Network/virtualNetworks"]).toBe(
      "azurerm_virtual_network",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Network/publicIPAddresses"]).toBe(
      "azurerm_public_ip",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Network/privateEndpoints"]).toBe(
      "azurerm_private_endpoint",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Network/azureFirewalls"]).toBe(
      "azurerm_firewall",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Network/bastionHosts"]).toBe(
      "azurerm_bastion_host",
    );
  });

  it("maps database resources", () => {
    expect(RESOURCE_TYPE_MAP["Microsoft.Sql/servers"]).toBe("azurerm_mssql_server");
    expect(RESOURCE_TYPE_MAP["Microsoft.Sql/servers/databases"]).toBe(
      "azurerm_mssql_database",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Sql/managedInstances"]).toBe(
      "azurerm_mssql_managed_instance",
    );
    expect(
      RESOURCE_TYPE_MAP["Microsoft.DBforPostgreSQL/flexibleServers"],
    ).toBe("azurerm_postgresql_flexible_server");
    expect(RESOURCE_TYPE_MAP["Microsoft.DocumentDB/databaseAccounts"]).toBe(
      "azurerm_cosmosdb_account",
    );
  });

  it("maps CosmosDB sub-resources", () => {
    expect(
      RESOURCE_TYPE_MAP["Microsoft.DocumentDB/databaseAccounts/sqlDatabases"],
    ).toBe("azurerm_cosmosdb_sql_database");
    expect(
      RESOURCE_TYPE_MAP[
        "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers"
      ],
    ).toBe("azurerm_cosmosdb_sql_container");
    expect(
      RESOURCE_TYPE_MAP[
        "Microsoft.DocumentDB/databaseAccounts/mongodbDatabases"
      ],
    ).toBe("azurerm_cosmosdb_mongo_database");
  });

  it("maps container resources", () => {
    expect(
      RESOURCE_TYPE_MAP["Microsoft.ContainerService/managedClusters"],
    ).toBe("azurerm_kubernetes_cluster");
    expect(
      RESOURCE_TYPE_MAP["Microsoft.ContainerService/managedClusters/agentPools"],
    ).toBe("azurerm_kubernetes_cluster_node_pool");
    expect(RESOURCE_TYPE_MAP["Microsoft.App/containerApps"]).toBe(
      "azurerm_container_app",
    );
  });

  it("maps identity and security resources", () => {
    expect(RESOURCE_TYPE_MAP["Microsoft.KeyVault/vaults"]).toBe(
      "azurerm_key_vault",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.KeyVault/vaults/secrets"]).toBe(
      "azurerm_key_vault_secret",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.KeyVault/vaults/certificates"]).toBe(
      "azurerm_key_vault_certificate",
    );
    expect(
      RESOURCE_TYPE_MAP["Microsoft.ManagedIdentity/userAssignedIdentities"],
    ).toBe("azurerm_user_assigned_identity");
  });

  it("maps monitoring resources", () => {
    expect(RESOURCE_TYPE_MAP["Microsoft.Insights/components"]).toBe(
      "azurerm_application_insights",
    );
    expect(
      RESOURCE_TYPE_MAP["Microsoft.Insights/scheduledQueryRules"],
    ).toBe("azurerm_monitor_scheduled_query_rules_alert_v2");
    expect(
      RESOURCE_TYPE_MAP["Microsoft.Insights/activityLogAlerts"],
    ).toBe("azurerm_monitor_activity_log_alert");
  });

  it("maps enterprise resources (policy, automation, search, batch)", () => {
    expect(
      RESOURCE_TYPE_MAP["Microsoft.Authorization/policyAssignments"],
    ).toBe("azurerm_policy_assignment");
    expect(
      RESOURCE_TYPE_MAP["Microsoft.Authorization/policyDefinitions"],
    ).toBe("azurerm_policy_definition");
    expect(RESOURCE_TYPE_MAP["Microsoft.Automation/automationAccounts"]).toBe(
      "azurerm_automation_account",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Search/searchServices"]).toBe(
      "azurerm_search_service",
    );
    expect(RESOURCE_TYPE_MAP["Microsoft.Batch/batchAccounts"]).toBe(
      "azurerm_batch_account",
    );
  });

  it("marks merged resources as null", () => {
    expect(RESOURCE_TYPE_MAP["Microsoft.Web/sites/config"]).toBeNull();
    expect(RESOURCE_TYPE_MAP["Microsoft.Web/sites/functions"]).toBeNull();
    expect(RESOURCE_TYPE_MAP["Microsoft.Resources/deployments"]).toBeNull();
  });

  it("every non-null value starts with azurerm_", () => {
    for (const [key, value] of Object.entries(RESOURCE_TYPE_MAP)) {
      if (value !== null) {
        expect(value, `${key} → ${value}`).toMatch(/^azurerm_/);
      }
    }
  });

  it("has no duplicate Bicep type keys", () => {
    const keys = Object.keys(RESOURCE_TYPE_MAP);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });
});

// ---------------------------------------------------------------------------
// PROPERTY_DECOMPOSITIONS
// ---------------------------------------------------------------------------

describe("PROPERTY_DECOMPOSITIONS", () => {
  it("decomposes storage SKU name into tier and replication", () => {
    const entry =
      PROPERTY_DECOMPOSITIONS["Microsoft.Storage/storageAccounts::sku.name"];
    expect(entry).toBeDefined();
    expect(entry).toHaveLength(2);

    const attrs = entry.map(([attr]) => attr);
    expect(attrs).toContain("account_tier");
    expect(attrs).toContain("account_replication_type");
  });

  it("passes through App Service SKU name", () => {
    const entry =
      PROPERTY_DECOMPOSITIONS["Microsoft.Web/serverfarms::sku.name"];
    expect(entry).toBeDefined();
    expect(entry).toHaveLength(1);
    expect(entry[0][0]).toBe("sku_name");
    expect(entry[0][1]).toBe("passthrough");
  });
});

// ---------------------------------------------------------------------------
// PROPERTY_NAME_OVERRIDES
// ---------------------------------------------------------------------------

describe("PROPERTY_NAME_OVERRIDES", () => {
  it("maps common camelCase to snake_case overrides", () => {
    expect(PROPERTY_NAME_OVERRIDES.osDisk).toBe("os_disk");
    expect(PROPERTY_NAME_OVERRIDES.imageReference).toBe(
      "source_image_reference",
    );
    expect(PROPERTY_NAME_OVERRIDES.vmSize).toBe("size");
    expect(PROPERTY_NAME_OVERRIDES.adminUsername).toBe("admin_username");
    expect(PROPERTY_NAME_OVERRIDES.ipConfigurations).toBe("ip_configuration");
  });
});

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

describe("extractStorageTier", () => {
  it("extracts Standard from Standard_LRS", () => {
    expect(extractStorageTier("Standard_LRS")).toBe("Standard");
  });

  it("extracts Premium from Premium_LRS", () => {
    expect(extractStorageTier("Premium_LRS")).toBe("Premium");
  });

  it("returns the string as-is if no underscore", () => {
    expect(extractStorageTier("Standard")).toBe("Standard");
  });
});

describe("extractStorageReplication", () => {
  it("extracts LRS from Standard_LRS", () => {
    expect(extractStorageReplication("Standard_LRS")).toBe("LRS");
  });

  it("extracts GRS from Standard_GRS", () => {
    expect(extractStorageReplication("Standard_GRS")).toBe("GRS");
  });

  it("extracts ZRS from Standard_ZRS", () => {
    expect(extractStorageReplication("Standard_ZRS")).toBe("ZRS");
  });

  it("extracts RAGRS from Standard_RAGRS", () => {
    expect(extractStorageReplication("Standard_RAGRS")).toBe("RAGRS");
  });

  it("returns the string as-is if no underscore", () => {
    expect(extractStorageReplication("LRS")).toBe("LRS");
  });
});
