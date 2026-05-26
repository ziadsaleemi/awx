# ------------------------------------------------------------------ #
# Outputs consumed by AWX inventory population                        #
# ------------------------------------------------------------------ #

# AWX reads any output whose key starts with "host_ip_" and creates a
# Host record in the target inventory for each one.  The part after
# "host_ip_" becomes the hostname; the value becomes the ansible_host
# variable for that host.
output "host_ip_proxmox_vm" {
  description = "IPv4 address of the provisioned VM — consumed by AWX to add a host to the target inventory."
  value       = var.ip_address
}

# ------------------------------------------------------------------ #
# Informational outputs                                               #
# ------------------------------------------------------------------ #

output "vm_name" {
  description = "Name of the provisioned VM."
  value       = proxmox_vm_qemu.vm.name
}

output "vm_id" {
  description = "Proxmox VM ID assigned by the cluster."
  value       = proxmox_vm_qemu.vm.vmid
}
