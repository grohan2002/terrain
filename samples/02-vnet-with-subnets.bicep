// Virtual network with multiple subnets and NSGs
// Tests: loops, nested resources, dependencies

param location string = resourceGroup().location
param vnetName string = 'vnet-main'
param addressPrefix string = '10.0.0.0/16'

var subnets = [
  { name: 'snet-web', prefix: '10.0.1.0/24' }
  { name: 'snet-app', prefix: '10.0.2.0/24' }
  { name: 'snet-db', prefix: '10.0.3.0/24' }
]

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-05-01' = [for subnet in subnets: {
  name: 'nsg-${subnet.name}'
  location: location
  properties: {
    securityRules: [
      {
        name: 'AllowHTTPS'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'DenyAll'
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
}]

resource vnet 'Microsoft.Network/virtualNetworks@2023-05-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [addressPrefix]
    }
    subnets: [for (subnet, i) in subnets: {
      name: subnet.name
      properties: {
        addressPrefix: subnet.prefix
        networkSecurityGroup: {
          id: nsg[i].id
        }
      }
    }]
  }
}

output vnetId string = vnet.id
output subnetIds array = [for (subnet, i) in subnets: vnet.properties.subnets[i].id]
