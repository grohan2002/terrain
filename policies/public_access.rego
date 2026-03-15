package bicep.public_access

# Deny resources with public network access enabled

deny[msg] {
    resource := input.resource_changes[_]
    resource.properties.public_network_access_enabled == "true"
    msg := sprintf("Resource '%s' (%s) has public network access enabled", [resource.name, resource.type])
}

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_storage_account"
    resource.properties.allow_nested_items_to_be_public == "true"
    msg := sprintf("Storage account '%s' allows public blob access", [resource.name])
}

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_storage_account"
    resource.properties.network_rules_default_action == "Allow"
    msg := sprintf("Storage account '%s' network rules default to Allow (should be Deny)", [resource.name])
}

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_container_registry"
    resource.properties.admin_enabled == "true"
    msg := sprintf("Container registry '%s' has admin access enabled", [resource.name])
}

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_key_vault"
    not resource.properties.purge_protection_enabled
    msg := sprintf("Key Vault '%s' does not have purge protection enabled", [resource.name])
}
