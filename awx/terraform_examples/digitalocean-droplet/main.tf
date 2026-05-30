terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
  required_version = ">= 1.5"

  # Shared backend keeps state outside AWX's per-job working directory.
  # Authenticate with ARM_* env vars from an AWX Azure RM (Terraform) credential.
  backend "azurerm" {
    resource_group_name  = "rg-ziad-3557_ai"
    storage_account_name = "awxtfstate3557c3c"
    container_name       = "tfstate"
    key                  = "awx/terraform_examples/digitalocean-droplet.tfstate"
    use_azuread_auth     = true
  }
}

# DIGITALOCEAN_TOKEN is injected automatically by AWX from the
# DigitalOcean (Terraform) credential attached to the job template.
provider "digitalocean" {}

# ---------------------------------------------------------------------------
# SSH Key lookup (optional) – if do_ssh_key_name is set, look it up
# ---------------------------------------------------------------------------
data "digitalocean_ssh_key" "key" {
  count = var.do_ssh_key_name != "" ? 1 : 0
  name  = var.do_ssh_key_name
}

# ---------------------------------------------------------------------------
# Droplet
# ---------------------------------------------------------------------------
resource "digitalocean_droplet" "vm" {
  name   = var.droplet_name
  region = var.do_region
  size   = var.do_droplet_size
  image  = var.do_image

  # SSH keys: either by looked-up name or by explicit IDs
  ssh_keys = var.do_ssh_key_name != "" ? [data.digitalocean_ssh_key.key[0].id] : var.do_ssh_key_ids

  # Optional: place in a VPC
  vpc_uuid = var.do_vpc_uuid != "" ? var.do_vpc_uuid : null

  # cloud-init user-data
  user_data = var.user_data != "" ? var.user_data : null

  tags = var.tags
}
