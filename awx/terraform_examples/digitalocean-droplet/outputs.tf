output "vm_name" {
  description = "Name of the created Droplet."
  value       = digitalocean_droplet.vm.name
}

output "droplet_id" {
  description = "DigitalOcean resource ID of the Droplet."
  value       = digitalocean_droplet.vm.id
}

output "host_ip_digitalocean_vm" {
  description = "Public IPv4 address of the Droplet. Registered in AWX inventory by the Terraform executor."
  value       = digitalocean_droplet.vm.ipv4_address
}

output "do_region" {
  description = "Region where the Droplet was created."
  value       = digitalocean_droplet.vm.region
}
