// Multi-module Bicep project — entry point
// Deploys a storage account and a virtual network via modular references

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Environment name (dev, staging, prod)')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'dev'

@description('Project name used for resource naming')
param projectName string = 'myapp'

var tags = {
  environment: environment
  project: projectName
  managedBy: 'bicep'
}

// Deploy storage module
module storage './modules/storage.bicep' = {
  name: 'storageDeploy'
  params: {
    location: location
    environment: environment
    projectName: projectName
    tags: tags
  }
}

// Deploy network module
module network './modules/network.bicep' = {
  name: 'networkDeploy'
  params: {
    location: location
    environment: environment
    projectName: projectName
    tags: tags
  }
}

output storageAccountId string = storage.outputs.storageAccountId
output storageAccountName string = storage.outputs.storageAccountName
output vnetId string = network.outputs.vnetId
output subnetIds array = network.outputs.subnetIds
