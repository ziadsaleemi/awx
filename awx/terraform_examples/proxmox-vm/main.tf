terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "~> 0.69"
    }
  }
  required_version = ">= 1.5"

  # This shared backend keeps state outside AWX's per-job working directory.
  # Authenticate with ARM_* env vars from an AWX Azure RM (Terraform) credential.
  backend "azurerm" {
    resource_group_name  = "rg-ziad-3557_ai"
    storage_account_name = "awxtfstate3557c3c"
    container_name       = "tfstate"
    key                  = "awx/terraform_examples/proxmox-vm.tfstate"
    use_azuread_auth     = true
  }
}

# Provider credentials are injected via TF_VAR_pm_* environment variables by AWX.
provider "proxmox" {
  endpoint  = var.pm_api_url
  api_token = "${var.pm_api_token_id}=${var.pm_api_token_secret}"
  insecure  = var.pm_tls_insecure
}

locals {
  node = var.pm_node != "" ? var.pm_node : "pve"
}

# Resolve the template VMID by name.
data "proxmox_virtual_environment_vms" "template" {
  node_name = local.node
  filter {
    name   = "name"
    values = [var.proxmox_template_name]
  }
}

resource "proxmox_virtual_environment_vm" "vm" {
  name      = var.vm_name
  node_name = local.node

  clone {
    vm_id     = data.proxmox_virtual_environment_vms.template.vms[0].vm_id
    node_name = local.node
    full      = true
  }

  # Enable QEMU guest agent so bpg/proxmox can read the VM's assigned IP
  # after cloud-init completes (used in the host_ip_proxmox_vm output).
  agent {
    enabled = true
    timeout = "10m"
  }

  cpu {
    cores = var.cores
    type  = "host"
  }

  memory {
    dedicated = var.memory
  }

  disk {
    datastore_id = var.storage_pool
    size         = var.disk_gb
    interface    = "scsi0"
    file_format  = "raw"
  }

  network_device {
    bridge = var.network_bridge
    model  = "virtio"
  }

  initialization {
    ip_config {
      ipv4 {
        address = var.ip_address != "" ? "${var.ip_address}/24" : "dhcp"
        gateway = var.ip_address != "" ? var.gateway : null
      }
    }

    user_account {
      username = var.cloud_init_user
      password = var.cloud_init_password != "" ? var.cloud_init_password : null
      keys     = var.ssh_public_key != "" ? [var.ssh_public_key] : []
    }
  }

  lifecycle {
    ignore_changes = [initialization]
  }
}
