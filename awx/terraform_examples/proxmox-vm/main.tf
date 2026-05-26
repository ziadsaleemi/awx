terraform {
  required_providers {
    proxmox = {
      source  = "telmate/proxmox"
      version = "~> 2.9"
    }
  }
  required_version = ">= 1.5"
}

# Provider credentials are injected via environment variables:
#   PM_API_URL, PM_API_TOKEN_ID, PM_API_TOKEN_SECRET, PM_NODE, PM_TLS_INSECURE
provider "proxmox" {
  pm_api_url          = var.pm_api_url != "" ? var.pm_api_url : null
  pm_api_token_id     = var.pm_api_token_id != "" ? var.pm_api_token_id : null
  pm_api_token_secret = var.pm_api_token_secret != "" ? var.pm_api_token_secret : null
  pm_tls_insecure     = var.pm_tls_insecure
}

resource "proxmox_vm_qemu" "vm" {
  name        = var.vm_name
  target_node = var.pm_node != "" ? var.pm_node : "pve"
  clone       = var.proxmox_template_name
  full_clone  = true

  cores   = var.cores
  memory  = var.memory
  sockets = 1

  disk {
    slot    = 0
    size    = "${var.disk_gb}G"
    type    = "scsi"
    storage = var.storage_pool
  }

  network {
    model  = "virtio"
    bridge = var.network_bridge
  }

  ipconfig0 = var.ip_address != "" ? "ip=${var.ip_address}/24,gw=${var.gateway}" : "ip=dhcp"

  ciuser     = var.cloud_init_user
  cipassword = var.cloud_init_password
  sshkeys    = var.ssh_public_key

  lifecycle {
    ignore_changes = [
      network,
    ]
  }
}
