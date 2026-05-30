output "vm_id" {
  description = "Azure resource ID of the created VM."
  value       = azurerm_linux_virtual_machine.vm.id
}

output "vm_name" {
  description = "Name of the created VM."
  value       = azurerm_linux_virtual_machine.vm.name
}

output "private_ip_address" {
  description = "Private IP address assigned to the VM NIC."
  value       = azurerm_network_interface.vm_nic.private_ip_address
}

output "public_ip_address" {
  description = "Public IP address assigned to the VM. Empty string if assign_public_ip is false."
  value       = var.assign_public_ip ? azurerm_public_ip.vm_pip[0].ip_address : ""
}

output "resource_group_name" {
  description = "Resource group the VM was deployed into."
  value       = var.resource_group_name
}

output "host_ip_azure_vm" {
  description = "Routable IP registered in AWX inventory. Uses the public IP when assigned, otherwise falls back to the private IP."
  value       = var.assign_public_ip ? azurerm_public_ip.vm_pip[0].ip_address : azurerm_network_interface.vm_nic.private_ip_address
}
