// Hub-spoke network topology with firewall, bastion, and spoke VNets
// Tests: loops, conditions, dependencies, multiple resource types, outputs
// Expected: ~8 resources, routes to Sonnet, moderate conversion complexity

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Environment name')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'dev'

@description('Enable Azure Firewall in the hub')
param enableFirewall bool = environment == 'prod'

@description('Enable Bastion host for secure RDP/SSH')
param enableBastion bool = true

@description('Spoke VNet configurations')
param spokes array = [
  { name: 'app', addressPrefix: '10.1.0.0/16', subnetPrefix: '10.1.1.0/24' }
  { name: 'data', addressPrefix: '10.2.0.0/16', subnetPrefix: '10.2.1.0/24' }
]

@description('Tags applied to all resources')
param tags object = {
  environment: environment
  managedBy: 'bicep'
  project: 'hub-spoke-network'
}

// ---------------------------------------------------------------------------
// Hub VNet
// ---------------------------------------------------------------------------

var hubAddressPrefix = '10.0.0.0/16'

resource hubVnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: 'vnet-hub-${environment}'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [hubAddressPrefix]
    }
    subnets: [
      {
        name: 'AzureFirewallSubnet'
        properties: {
          addressPrefix: '10.0.1.0/26'
        }
      }
      {
        name: 'AzureBastionSubnet'
        properties: {
          addressPrefix: '10.0.2.0/26'
        }
      }
      {
        name: 'GatewaySubnet'
        properties: {
          addressPrefix: '10.0.3.0/27'
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Spoke VNets (loop)
// ---------------------------------------------------------------------------

resource spokeVnets 'Microsoft.Network/virtualNetworks@2023-09-01' = [
  for spoke in spokes: {
    name: 'vnet-spoke-${spoke.name}-${environment}'
    location: location
    tags: tags
    properties: {
      addressSpace: {
        addressPrefixes: [spoke.addressPrefix]
      }
      subnets: [
        {
          name: 'snet-${spoke.name}-default'
          properties: {
            addressPrefix: spoke.subnetPrefix
            networkSecurityGroup: {
              id: spokeNsgs[indexOf(spokes, spoke)].id
            }
          }
        }
      ]
    }
  }
]

// ---------------------------------------------------------------------------
// NSGs for each spoke
// ---------------------------------------------------------------------------

resource spokeNsgs 'Microsoft.Network/networkSecurityGroups@2023-09-01' = [
  for spoke in spokes: {
    name: 'nsg-${spoke.name}-${environment}'
    location: location
    tags: tags
    properties: {
      securityRules: [
        {
          name: 'AllowHttpsInbound'
          properties: {
            priority: 100
            direction: 'Inbound'
            access: 'Allow'
            protocol: 'Tcp'
            sourcePortRange: '*'
            destinationPortRange: '443'
            sourceAddressPrefix: hubAddressPrefix
            destinationAddressPrefix: spoke.subnetPrefix
          }
        }
        {
          name: 'DenyAllInbound'
          properties: {
            priority: 4096
            direction: 'Inbound'
            access: 'Deny'
            protocol: '*'
            sourcePortRange: '*'
            destinationPortRange: '*'
            sourceAddressPrefix: '*'
            destinationAddressPrefix: '*'
          }
        }
      ]
    }
  }
]

// ---------------------------------------------------------------------------
// VNet peerings (hub ↔ each spoke)
// ---------------------------------------------------------------------------

resource hubToSpokePeerings 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2023-09-01' = [
  for (spoke, i) in spokes: {
    parent: hubVnet
    name: 'peer-hub-to-${spoke.name}'
    properties: {
      remoteVirtualNetwork: {
        id: spokeVnets[i].id
      }
      allowVirtualNetworkAccess: true
      allowForwardedTraffic: true
      allowGatewayTransit: true
    }
  }
]

resource spokeToHubPeerings 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2023-09-01' = [
  for (spoke, i) in spokes: {
    parent: spokeVnets[i]
    name: 'peer-${spoke.name}-to-hub'
    properties: {
      remoteVirtualNetwork: {
        id: hubVnet.id
      }
      allowVirtualNetworkAccess: true
      allowForwardedTraffic: true
      useRemoteGateways: false
    }
  }
]

// ---------------------------------------------------------------------------
// Azure Firewall (conditional)
// ---------------------------------------------------------------------------

resource firewallPip 'Microsoft.Network/publicIPAddresses@2023-09-01' = if (enableFirewall) {
  name: 'pip-fw-${environment}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

resource firewall 'Microsoft.Network/azureFirewalls@2023-09-01' = if (enableFirewall) {
  name: 'fw-hub-${environment}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'AZFW_VNet'
      tier: 'Standard'
    }
    ipConfigurations: [
      {
        name: 'fw-ipconfig'
        properties: {
          subnet: {
            id: hubVnet.properties.subnets[0].id
          }
          publicIPAddress: {
            id: firewallPip.id
          }
        }
      }
    ]
    threatIntelMode: 'Alert'
  }
}

// ---------------------------------------------------------------------------
// Bastion Host (conditional)
// ---------------------------------------------------------------------------

resource bastionPip 'Microsoft.Network/publicIPAddresses@2023-09-01' = if (enableBastion) {
  name: 'pip-bastion-${environment}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource bastion 'Microsoft.Network/bastionHosts@2023-09-01' = if (enableBastion) {
  name: 'bas-hub-${environment}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    ipConfigurations: [
      {
        name: 'bas-ipconfig'
        properties: {
          subnet: {
            id: hubVnet.properties.subnets[1].id
          }
          publicIPAddress: {
            id: bastionPip.id
          }
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Log Analytics Workspace (for diagnostics)
// ---------------------------------------------------------------------------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'law-hub-${environment}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: environment == 'prod' ? 90 : 30
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output hubVnetId string = hubVnet.id
output hubVnetName string = hubVnet.name
output spokeVnetIds array = [for (spoke, i) in spokes: spokeVnets[i].id]
output spokeVnetNames array = [for (spoke, i) in spokes: spokeVnets[i].name]
output firewallPrivateIp string = enableFirewall ? firewall.properties.ipConfigurations[0].properties.privateIPAddress : 'N/A'
output logAnalyticsWorkspaceId string = logAnalytics.properties.customerId
