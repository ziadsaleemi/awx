terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
  required_version = ">= 1.5"

  # Shared backend keeps state outside AWX's per-job working directory.
  # Authenticate with ARM_* env vars from an AWX Azure RM (Terraform) credential.
  backend "azurerm" {
    resource_group_name  = "rg-ziad-3557_ai"
    storage_account_name = "awxtfstate3557c3c"
    container_name       = "tfstate"
    key                  = "awx/terraform_examples/azure-vm.tfstate"
    use_azuread_auth     = true
  }
}

# ARM_* environment variables are injected automatically by AWX from the
# Azure RM (Terraform) credential attached to the job template.
provider "azurerm" {
  features {}
}

# ---------------------------------------------------------------------------
# Data: resolve existing networking resources
# ---------------------------------------------------------------------------

data "azurerm_resource_group" "rg" {
  name = var.resource_group_name
}

data "azurerm_virtual_network" "vnet" {
  name                = var.vnet_name
  resource_group_name = var.resource_group_name
}

data "azurerm_subnet" "subnet" {
  name                 = var.subnet_name
  virtual_network_name = var.vnet_name
  resource_group_name  = var.resource_group_name
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

resource "azurerm_public_ip" "vm_pip" {
  count               = var.assign_public_ip ? 1 : 0
  name                = "${var.vm_name}-pip"
  location            = data.azurerm_resource_group.rg.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = var.tags
}

resource "azurerm_network_interface" "vm_nic" {
  name                = "${var.vm_name}-nic"
  location            = data.azurerm_resource_group.rg.location
  resource_group_name = var.resource_group_name

  ip_configuration {
    name                          = "ipconfig1"
    subnet_id                     = data.azurerm_subnet.subnet.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = var.assign_public_ip ? azurerm_public_ip.vm_pip[0].id : null
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Virtual Machine
# ---------------------------------------------------------------------------

resource "azurerm_linux_virtual_machine" "vm" {
  name                = var.vm_name
  location            = data.azurerm_resource_group.rg.location
  resource_group_name = var.resource_group_name
  size                = var.vm_size
  admin_username      = var.admin_username

  # Disable password auth when an SSH public key is provided.
  disable_password_authentication = var.ssh_public_key != ""

  dynamic "admin_password" {
    for_each = var.ssh_public_key == "" && var.admin_password != "" ? [1] : []
    content {}
  }

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key != "" ? var.ssh_public_key : "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC placeholder-replace-me"
  }

  network_interface_ids = [azurerm_network_interface.vm_nic.id]

  os_disk {
    name                 = "${var.vm_name}-osdisk"
    caching              = "ReadWrite"
    storage_account_type = var.os_disk_type
    disk_size_gb         = var.os_disk_size_gb > 0 ? var.os_disk_size_gb : null
  }

  # When vm_image_id is set (custom/gallery image), use it directly.
  # Otherwise use marketplace publisher/offer/sku/version fields.
  dynamic "source_image_reference" {
    for_each = var.vm_image_id == "" ? [1] : []
    content {
      publisher = var.image_publisher
      offer     = var.image_offer
      sku       = var.image_sku
      version   = var.image_version
    }
  }

  source_image_id = var.vm_image_id != "" ? var.vm_image_id : null

  tags = var.tags

  lifecycle {
    ignore_changes = [admin_password]
  }
}
