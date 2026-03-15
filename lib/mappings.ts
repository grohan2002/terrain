// ---------------------------------------------------------------------------
// Bicep -> Terraform/OpenTofu resource type mappings and property
// transformation rules.
//
// Ported from bicep_converter/mappings.py
//
// The agent uses lookup_resource_mapping to query these tables. For resources
// NOT in these tables the agent falls back to its own knowledge of the
// AzureRM provider.
// ---------------------------------------------------------------------------

/**
 * Bicep resource type (without API version) -> Terraform resource type.
 * `null` means the resource is merged into a parent or has no direct equivalent.
 */
export const RESOURCE_TYPE_MAP: Record<string, string | null> = {
  // Compute — AzureRM v4: use OS-specific resource types (legacy azurerm_virtual_machine removed)
  "Microsoft.Compute/virtualMachines": "azurerm_linux_virtual_machine",
  "Microsoft.Compute/virtualMachineScaleSets":
    "azurerm_linux_virtual_machine_scale_set",
  "Microsoft.Compute/disks": "azurerm_managed_disk",
  "Microsoft.Compute/availabilitySets": "azurerm_availability_set",
  "Microsoft.Compute/images": "azurerm_image",
  "Microsoft.Compute/proximityPlacementGroups":
    "azurerm_proximity_placement_group",
  "Microsoft.Compute/sshPublicKeys": "azurerm_ssh_public_key",
  "Microsoft.Compute/snapshots": "azurerm_snapshot",
  "Microsoft.Compute/galleries": "azurerm_shared_image_gallery",
  "Microsoft.Compute/galleries/images": "azurerm_shared_image",

  // Storage
  "Microsoft.Storage/storageAccounts": "azurerm_storage_account",
  "Microsoft.Storage/storageAccounts/blobServices/containers":
    "azurerm_storage_container",
  "Microsoft.Storage/storageAccounts/fileServices/shares":
    "azurerm_storage_share",
  "Microsoft.Storage/storageAccounts/queueServices/queues":
    "azurerm_storage_queue",
  "Microsoft.Storage/storageAccounts/tableServices/tables":
    "azurerm_storage_table",

  // Networking
  "Microsoft.Network/virtualNetworks": "azurerm_virtual_network",
  "Microsoft.Network/virtualNetworks/subnets": "azurerm_subnet",
  "Microsoft.Network/networkSecurityGroups": "azurerm_network_security_group",
  "Microsoft.Network/networkSecurityGroups/securityRules":
    "azurerm_network_security_rule",
  "Microsoft.Network/publicIPAddresses": "azurerm_public_ip",
  "Microsoft.Network/loadBalancers": "azurerm_lb",
  "Microsoft.Network/applicationGateways": "azurerm_application_gateway",
  "Microsoft.Network/networkInterfaces": "azurerm_network_interface",
  "Microsoft.Network/privateDnsZones": "azurerm_private_dns_zone",
  "Microsoft.Network/privateEndpoints": "azurerm_private_endpoint",
  "Microsoft.Network/routeTables": "azurerm_route_table",
  "Microsoft.Network/natGateways": "azurerm_nat_gateway",
  "Microsoft.Network/dnsZones": "azurerm_dns_zone",
  "Microsoft.Network/frontDoors": "azurerm_frontdoor",

  // Web / App Service
  "Microsoft.Web/serverfarms": "azurerm_service_plan",
  "Microsoft.Web/sites": "azurerm_linux_web_app",
  "Microsoft.Web/sites/config": null, // Merged into parent resource
  "Microsoft.Web/staticSites": "azurerm_static_web_app",

  // Databases
  "Microsoft.Sql/servers": "azurerm_mssql_server",
  "Microsoft.Sql/servers/databases": "azurerm_mssql_database",
  "Microsoft.Sql/servers/firewallRules": "azurerm_mssql_firewall_rule",
  "Microsoft.DBforPostgreSQL/flexibleServers":
    "azurerm_postgresql_flexible_server",
  "Microsoft.DBforPostgreSQL/flexibleServers/databases":
    "azurerm_postgresql_flexible_server_database",
  "Microsoft.DBforMySQL/flexibleServers": "azurerm_mysql_flexible_server",
  "Microsoft.DocumentDB/databaseAccounts": "azurerm_cosmosdb_account",
  "Microsoft.Cache/redis": "azurerm_redis_cache",

  // Containers
  "Microsoft.ContainerService/managedClusters": "azurerm_kubernetes_cluster",
  "Microsoft.ContainerRegistry/registries": "azurerm_container_registry",
  "Microsoft.ContainerInstance/containerGroups": "azurerm_container_group",

  // Identity & Security
  "Microsoft.ManagedIdentity/userAssignedIdentities":
    "azurerm_user_assigned_identity",
  "Microsoft.KeyVault/vaults": "azurerm_key_vault",
  "Microsoft.KeyVault/vaults/secrets": "azurerm_key_vault_secret",
  "Microsoft.KeyVault/vaults/keys": "azurerm_key_vault_key",
  "Microsoft.KeyVault/vaults/accessPolicies": "azurerm_key_vault_access_policy",

  // Monitoring
  "Microsoft.Insights/components": "azurerm_application_insights",
  "Microsoft.OperationalInsights/workspaces":
    "azurerm_log_analytics_workspace",
  "Microsoft.Insights/diagnosticSettings":
    "azurerm_monitor_diagnostic_setting",
  "Microsoft.Insights/actionGroups": "azurerm_monitor_action_group",
  "Microsoft.Insights/metricAlerts": "azurerm_monitor_metric_alert",

  // Messaging
  "Microsoft.ServiceBus/namespaces": "azurerm_servicebus_namespace",
  "Microsoft.ServiceBus/namespaces/queues": "azurerm_servicebus_queue",
  "Microsoft.ServiceBus/namespaces/topics": "azurerm_servicebus_topic",
  "Microsoft.EventHub/namespaces": "azurerm_eventhub_namespace",
  "Microsoft.EventHub/namespaces/eventhubs": "azurerm_eventhub",

  // Container Apps
  "Microsoft.App/containerApps": "azurerm_container_app",
  "Microsoft.App/managedEnvironments": "azurerm_container_app_environment",
  "Microsoft.App/managedEnvironments/daprComponents":
    "azurerm_container_app_environment_dapr_component",

  // AI / Cognitive Services
  "Microsoft.CognitiveServices/accounts": "azurerm_cognitive_account",
  "Microsoft.MachineLearningServices/workspaces":
    "azurerm_machine_learning_workspace",

  // API Management
  "Microsoft.ApiManagement/service": "azurerm_api_management",
  "Microsoft.ApiManagement/service/apis": "azurerm_api_management_api",
  "Microsoft.ApiManagement/service/products":
    "azurerm_api_management_product",

  // Data / Analytics
  "Microsoft.Synapse/workspaces": "azurerm_synapse_workspace",
  "Microsoft.Synapse/workspaces/sqlPools": "azurerm_synapse_sql_pool",
  "Microsoft.DataFactory/factories": "azurerm_data_factory",
  "Microsoft.DataFactory/factories/pipelines":
    "azurerm_data_factory_pipeline",
  "Microsoft.Databricks/workspaces": "azurerm_databricks_workspace",

  // Virtual Desktop
  "Microsoft.DesktopVirtualization/hostPools":
    "azurerm_virtual_desktop_host_pool",
  "Microsoft.DesktopVirtualization/applicationGroups":
    "azurerm_virtual_desktop_application_group",
  "Microsoft.DesktopVirtualization/workspaces":
    "azurerm_virtual_desktop_workspace",

  // Functions / Logic Apps
  "Microsoft.Web/sites/functions": null, // Merged into parent function app
  "Microsoft.Logic/workflows": "azurerm_logic_app_workflow",

  // CDN / Front Door (modern)
  "Microsoft.Cdn/profiles": "azurerm_cdn_profile",
  "Microsoft.Cdn/profiles/endpoints": "azurerm_cdn_endpoint",
  "Microsoft.Cdn/profiles/afdEndpoints": "azurerm_cdn_frontdoor_endpoint",

  // Networking (additional)
  "Microsoft.Network/firewallPolicies": "azurerm_firewall_policy",
  "Microsoft.Network/azureFirewalls": "azurerm_firewall",
  "Microsoft.Network/bastionHosts": "azurerm_bastion_host",
  "Microsoft.Network/virtualNetworkGateways":
    "azurerm_virtual_network_gateway",
  "Microsoft.Network/expressRouteCircuits":
    "azurerm_express_route_circuit",
  "Microsoft.Network/trafficManagerProfiles":
    "azurerm_traffic_manager_profile",
  "Microsoft.Network/privateDnsZones/virtualNetworkLinks":
    "azurerm_private_dns_zone_virtual_network_link",

  // Signal / Communication
  "Microsoft.SignalRService/signalR": "azurerm_signalr_service",
  "Microsoft.Communication/communicationServices":
    "azurerm_communication_service",

  // Recovery / Backup
  "Microsoft.RecoveryServices/vaults": "azurerm_recovery_services_vault",

  // Event Grid
  "Microsoft.EventGrid/topics": "azurerm_eventgrid_topic",
  "Microsoft.EventGrid/systemTopics": "azurerm_eventgrid_system_topic",

  // App Configuration
  "Microsoft.AppConfiguration/configurationStores":
    "azurerm_app_configuration",

  // AKS sub-resources
  "Microsoft.ContainerService/managedClusters/agentPools":
    "azurerm_kubernetes_cluster_node_pool",

  // SQL Managed Instance
  "Microsoft.Sql/managedInstances": "azurerm_mssql_managed_instance",
  "Microsoft.Sql/managedInstances/databases":
    "azurerm_mssql_managed_database",

  // CosmosDB sub-resources
  "Microsoft.DocumentDB/databaseAccounts/sqlDatabases":
    "azurerm_cosmosdb_sql_database",
  "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers":
    "azurerm_cosmosdb_sql_container",
  "Microsoft.DocumentDB/databaseAccounts/mongodbDatabases":
    "azurerm_cosmosdb_mongo_database",
  "Microsoft.DocumentDB/databaseAccounts/mongodbDatabases/collections":
    "azurerm_cosmosdb_mongo_collection",

  // Storage management policies
  "Microsoft.Storage/storageAccounts/managementPolicies":
    "azurerm_storage_management_policy",

  // Key Vault certificates
  "Microsoft.KeyVault/vaults/certificates": "azurerm_key_vault_certificate",

  // Private Link Service
  "Microsoft.Network/privateLinkServices": "azurerm_private_link_service",

  // Monitoring (additional)
  "Microsoft.Insights/scheduledQueryRules":
    "azurerm_monitor_scheduled_query_rules_alert_v2",
  "Microsoft.Insights/activityLogAlerts":
    "azurerm_monitor_activity_log_alert",

  // Application Security Groups
  "Microsoft.Network/applicationSecurityGroups":
    "azurerm_application_security_group",

  // Search
  "Microsoft.Search/searchServices": "azurerm_search_service",

  // Batch
  "Microsoft.Batch/batchAccounts": "azurerm_batch_account",

  // Automation
  "Microsoft.Automation/automationAccounts": "azurerm_automation_account",

  // Policy
  "Microsoft.Authorization/policyAssignments": "azurerm_policy_assignment",
  "Microsoft.Authorization/policyDefinitions":
    "azurerm_policy_definition",

  // Resource Management
  "Microsoft.Resources/resourceGroups": "azurerm_resource_group",
  "Microsoft.Resources/deployments": null, // No direct equivalent
  "Microsoft.Authorization/roleAssignments": "azurerm_role_assignment",
  "Microsoft.Authorization/roleDefinitions": "azurerm_role_definition",
  "Microsoft.Authorization/locks": "azurerm_management_lock",
};

/**
 * Property transformations that require value decomposition.
 *
 * Key format: `"<bicep_resource_type>::<bicep_property_path>"`
 * Value: array of `[terraform_attribute, extraction_function_name]` tuples.
 */
export const PROPERTY_DECOMPOSITIONS: Record<
  string,
  Array<[string, string]>
> = {
  "Microsoft.Storage/storageAccounts::sku.name": [
    ["account_tier", "extract_storage_tier"],
    ["account_replication_type", "extract_storage_replication"],
  ],
  "Microsoft.Web/serverfarms::sku.name": [
    ["sku_name", "passthrough"],
  ],
};

/**
 * Non-obvious camelCase -> snake_case property-name overrides.
 */
export const PROPERTY_NAME_OVERRIDES: Record<string, string> = {
  storageAccountType: "storage_account_type",
  osDisk: "os_disk",
  imageReference: "source_image_reference",
  networkProfile: "network_interface_ids",
  hardwareProfile: "size",
  ipConfigurations: "ip_configuration",
  addressSpace: "address_space",
  addressPrefixes: "address_prefixes",
  enableHttpsTrafficOnly: "enable_https_traffic_only",
  minimumTlsVersion: "min_tls_version",
  allowBlobPublicAccess: "allow_nested_items_to_be_public",
  subnetId: "subnet_id",
  publicIPAddressId: "public_ip_address_id",
  networkSecurityGroupId: "network_security_group_id",
  dnsServers: "dns_servers",
  vmSize: "size",
  adminUsername: "admin_username",
  adminPassword: "admin_password",
  computerName: "computer_name",
};

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** `"Standard_LRS"` -> `"Standard"`, `"Premium_LRS"` -> `"Premium"` */
export function extractStorageTier(skuName: string): string {
  return skuName.includes("_") ? skuName.split("_")[0] : skuName;
}

/** `"Standard_LRS"` -> `"LRS"`, `"Standard_GRS"` -> `"GRS"` */
export function extractStorageReplication(skuName: string): string {
  return skuName.includes("_") ? skuName.split("_")[1] : skuName;
}
