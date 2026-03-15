package bicep.encryption

# Deny resources that lack encryption configuration

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_storage_account"
    not resource.properties.enable_https_traffic_only
    msg := sprintf("Storage account '%s' does not enforce HTTPS-only traffic", [resource.name])
}

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_storage_account"
    resource.properties.min_tls_version != "TLS1_2"
    msg := sprintf("Storage account '%s' does not enforce TLS 1.2 minimum", [resource.name])
}

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_managed_disk"
    not resource.properties.disk_encryption_set_id
    msg := sprintf("Managed disk '%s' does not have encryption configured", [resource.name])
}

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_redis_cache"
    resource.properties.enable_non_ssl_port == "true"
    msg := sprintf("Redis cache '%s' has non-SSL port enabled", [resource.name])
}
