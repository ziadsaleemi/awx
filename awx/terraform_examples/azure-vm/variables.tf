# ------------------------------------------------------------------ #
# Required variables                                                  #
# ------------------------------------------------------------------ #

variable "vm_name" {
  description = "Name to assign to the new Azure VM."
  type        = string
}

variable "resource_group_name" {
  description = "Name of the existing Azure Resource Group to deploy into."
  type        = string
}

variable "vnet_name" {
  description = "Name of the existing Virtual Network to attach the VM to."
  type        = string
}

variable "subnet_name" {
  description = "Name of the existing subnet within the Virtual Network."
  type        = string
}

# ------------------------------------------------------------------ #
# VM sizing                                                           #
# ------------------------------------------------------------------ #

variable "vm_size" {
  description = "Azure VM size (SKU), e.g. Standard_B2ms. Sourced dynamically from vm_sizes.name."
  type        = string
  default     = "Standard_B2ms"
}

# ------------------------------------------------------------------ #
# OS Image — marketplace (default) or custom/gallery                  #
# ------------------------------------------------------------------ #

variable "image_publisher" {
  description = "Marketplace image publisher. Used when vm_image_id is empty."
  type        = string
  default     = "Canonical"
}

variable "image_offer" {
  description = "Marketplace image offer. Used when vm_image_id is empty."
  type        = string
  default     = "ubuntu-24_04-lts"
}

variable "image_sku" {
  description = "Marketplace image SKU. Used when vm_image_id is empty."
  type        = string
  default     = "server"
}

variable "image_version" {
  description = "Marketplace image version. Used when vm_image_id is empty."
  type        = string
  default     = "latest"
}

variable "vm_image_id" {
  description = "Full resource ID of a custom or gallery image. When set, overrides marketplace image fields. Sourced dynamically from vm_images.urn."
  type        = string
  default     = ""
}

# ------------------------------------------------------------------ #
# OS disk                                                             #
# ------------------------------------------------------------------ #

variable "os_disk_type" {
  description = "Storage account type for the OS disk (Standard_LRS, Premium_LRS, StandardSSD_LRS)."
  type        = string
  default     = "Standard_LRS"
}

variable "os_disk_size_gb" {
  description = "OS disk size in GB. Set to 0 to use the image default."
  type        = number
  default     = 0
}

# ------------------------------------------------------------------ #
# Authentication                                                      #
# ------------------------------------------------------------------ #

variable "admin_username" {
  description = "Admin username for the VM."
  type        = string
  default     = "azureuser"
}

variable "admin_password" {
  description = "Admin password. Used only when ssh_public_key is empty. Leave blank to rely on SSH keys."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ssh_public_key" {
  description = "SSH public key to authorize for the admin user. When provided, password auth is disabled."
  type        = string
  default     = ""
}

# ------------------------------------------------------------------ #
# Networking options                                                  #
# ------------------------------------------------------------------ #

variable "assign_public_ip" {
  description = "Whether to create and assign a public IP address to the VM."
  type        = bool
  default     = true
}

# ------------------------------------------------------------------ #
# Tagging                                                             #
# ------------------------------------------------------------------ #

variable "tags" {
  description = "Map of tags to apply to all created resources."
  type        = map(string)
  default     = {}
}
