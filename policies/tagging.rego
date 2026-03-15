package bicep.tagging

# Deny resources that are missing required tags

taggable_resources := {
    "azurerm_resource_group",
    "azurerm_virtual_network",
    "azurerm_storage_account",
    "azurerm_linux_virtual_machine",
    "azurerm_windows_virtual_machine",
    "azurerm_kubernetes_cluster",
    "azurerm_key_vault",
    "azurerm_mssql_server",
    "azurerm_cosmosdb_account",
    "azurerm_container_registry",
    "azurerm_service_plan",
    "azurerm_linux_web_app",
    "azurerm_windows_web_app",
    "azurerm_application_insights",
    "azurerm_log_analytics_workspace",
}

deny[msg] {
    resource := input.resource_changes[_]
    taggable_resources[resource.type]
    not resource.properties.tags
    msg := sprintf("Resource '%s' (%s) is missing tags", [resource.name, resource.type])
}
