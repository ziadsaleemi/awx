# After a successful apply with the QEMU guest agent enabled, bpg/proxmox
# exposes the VM's actual network addresses via ipv4_addresses.
# Collect addresses from all NIC entries and pick the first usable IPv4.
# Falls back to var.ip_address if the agent has not reported an address yet.
locals {
  _all_ipv4 = try(proxmox_virtual_environment_vm.vm.ipv4_addresses, [])
  _raw_ips = flatten([
    for iface_ips in local._all_ipv4 : [for ip in iface_ips : trimspace(tostring(ip))]
  ])
  _routable_ips = [for ip in local._raw_ips : ip if ip != "127.0.0.1" && ip != "" && !startswith(ip, "169.254.")]
  resolved_ip   = length(local._routable_ips) > 0 ? local._routable_ips[0] : var.ip_address
}

output "host_ip_proxmox_vm" {
  description = "IPv4 address of the provisioned VM — consumed by AWX to add a host to the target inventory and propagated as a workflow artifact."
  value       = local.resolved_ip
}

output "cloud_init_user" {
  description = "SSH user created by cloud-init — consumed by AWX when populating host connection variables."
  value       = var.cloud_init_user
}

output "vm_name" {
  description = "Name of the provisioned VM."
  value       = proxmox_virtual_environment_vm.vm.name
}

output "vm_id" {
  description = "Proxmox VM ID assigned by the cluster."
  value       = proxmox_virtual_environment_vm.vm.vm_id
}
