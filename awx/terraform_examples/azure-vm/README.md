# azure-vm — Azure Linux VM Terraform Template

Provisions an Azure Linux virtual machine into an existing Virtual Network / subnet,
using an Azure RM (Terraform) credential stored in AWX.

## How it works

| Step | Detail |
|------|--------|
| **Credential** | AWX injects `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_SUBSCRIPTION_ID`, `ARM_TENANT_ID` from an **Azure RM (Terraform)** credential type. |
| **State backend** | Remote state stored in Azure Blob Storage (`awxtfstate3557c3c/tfstate/awx/terraform_examples/azure-vm.tfstate`). |
| **Networking** | Attaches to existing VNet + subnet. Optionally creates a Standard public IP. |
| **OS image** | Defaults to `Canonical:ubuntu-24_04-lts:server:latest`. Override via `vm_image_id` (custom/gallery URN) or the four `image_*` marketplace fields. |
| **Auth** | SSH public key preferred; password auth disabled when key is provided. |

## Dynamic field sources

The following survey variables can be sourced dynamically from AWX's Azure cloud connector:

| Survey variable | Source path | Admin setting |
|-----------------|-------------|---------------|
| `vm_size` | `vm_sizes.name` | `allowedVMSizeNames` |
| `vm_image_id` | `vm_images.urn` | `allowedVMImageUrns` |
| `resource_group_name` | `resource_groups.name` | — |
| `vnet_name` | `vnets.name` | — |
| Location (read-only context) | `locations.name` | `allowedLocationNames` |

## Required variables

| Variable | Description |
|----------|-------------|
| `vm_name` | Name for the new VM |
| `resource_group_name` | Existing resource group to deploy into |
| `vnet_name` | Existing Virtual Network name |
| `subnet_name` | Existing subnet name within the VNet |

## Optional variables (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `vm_size` | `Standard_B2ms` | Azure VM SKU |
| `image_publisher` | `Canonical` | Marketplace publisher |
| `image_offer` | `ubuntu-24_04-lts` | Marketplace offer |
| `image_sku` | `server` | Marketplace SKU |
| `image_version` | `latest` | Marketplace version |
| `vm_image_id` | `""` | Custom/gallery image resource ID (overrides marketplace fields) |
| `admin_username` | `azureuser` | Admin username |
| `admin_password` | `""` | Admin password (unused when `ssh_public_key` is set) |
| `ssh_public_key` | `""` | SSH public key (disables password auth when set) |
| `assign_public_ip` | `true` | Create and attach a public IP |
| `os_disk_type` | `Standard_LRS` | OS disk storage type |
| `os_disk_size_gb` | `0` | OS disk size in GB (0 = image default) |
| `tags` | `{}` | Tags to apply to all resources |

## Outputs

| Output | Description |
|--------|-------------|
| `vm_id` | Azure resource ID of the VM |
| `vm_name` | Name of the VM |
| `private_ip_address` | Private IP address |
| `public_ip_address` | Public IP address (empty if `assign_public_ip = false`) |
| `resource_group_name` | Resource group the VM was deployed into |
