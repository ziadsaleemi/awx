# ------------------------------------------------------------------ #
# Required variables                                                  #
# ------------------------------------------------------------------ #

variable "vm_name" {
  description = "Name to assign to the new VM."
  type        = string
}

variable "ip_address" {
  description = "Static IPv4 address for the VM (without prefix length), e.g. 192.168.1.100"
  type        = string
}

variable "gateway" {
  description = "Default gateway IPv4 address, e.g. 192.168.1.1"
  type        = string
}

variable "proxmox_template_name" {
  description = "Name of the Proxmox VM template to clone (must be a cloud-init-enabled template)."
  type        = string
}

# ------------------------------------------------------------------ #
# Optional hardware sizing                                            #
# ------------------------------------------------------------------ #

variable "cores" {
  description = "Number of vCPU cores."
  type        = number
  default     = 2
}

variable "memory" {
  description = "Memory in MiB."
  type        = number
  default     = 2048
}

variable "disk_gb" {
  description = "Disk size in GiB."
  type        = number
  default     = 20
}

variable "storage_pool" {
  description = "Proxmox storage pool for the VM disk."
  type        = string
  default     = "local-lvm"
}

variable "network_bridge" {
  description = "Proxmox network bridge to attach the VM NIC to."
  type        = string
  default     = "vmbr0"
}

# ------------------------------------------------------------------ #
# Cloud-init / SSH access                                             #
# ------------------------------------------------------------------ #

variable "cloud_init_user" {
  description = "Username to create via cloud-init."
  type        = string
  default     = "ansible"
}

variable "cloud_init_password" {
  description = "Password for the cloud-init user (leave blank to rely solely on SSH keys)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ssh_public_key" {
  description = "SSH public key(s) to inject into the VM via cloud-init (one per line)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ssh_private_key" {
  description = "SSH private key used by the Terraform provisioner to wait for the VM to boot."
  type        = string
  default     = ""
  sensitive   = true
}

# ------------------------------------------------------------------ #
# Provider overrides (normally injected via env vars by AWX)          #
# ------------------------------------------------------------------ #

variable "pm_api_url" {
  description = "Proxmox API URL override (normally set via PM_API_URL env var)."
  type        = string
  default     = ""
}

variable "pm_api_token_id" {
  description = "Proxmox API token ID override (normally set via PM_API_TOKEN_ID env var)."
  type        = string
  default     = ""
}

variable "pm_api_token_secret" {
  description = "Proxmox API token secret override (normally set via PM_API_TOKEN_SECRET env var)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "pm_node" {
  description = "Proxmox target node override (normally set via PM_NODE env var)."
  type        = string
  default     = ""
}

variable "pm_tls_insecure" {
  description = "Disable TLS verification (set to true only in lab environments)."
  type        = bool
  default     = false
}
