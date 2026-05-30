# ------------------------------------------------------------------ #
# Required variables                                                  #
# ------------------------------------------------------------------ #

variable "droplet_name" {
  description = "Name to assign to the new DigitalOcean Droplet."
  type        = string
}

# ------------------------------------------------------------------ #
# Region / size / image                                               #
# ------------------------------------------------------------------ #

variable "do_region" {
  description = "DigitalOcean region slug (e.g. nyc3, sfo3, lon1). Sourced from DO_REGION env var injected by the AWX credential."
  type        = string
  default     = "nyc3"
}

variable "do_droplet_size" {
  description = "Droplet size slug (e.g. s-1vcpu-1gb, s-2vcpu-4gb)."
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "do_image" {
  description = "Droplet image slug or snapshot ID (e.g. ubuntu-22-04-x64)."
  type        = string
  default     = "ubuntu-22-04-x64"
}

# ------------------------------------------------------------------ #
# Networking                                                          #
# ------------------------------------------------------------------ #

variable "do_vpc_uuid" {
  description = "UUID of the VPC to place the Droplet in. Leave empty to use the region default."
  type        = string
  default     = ""
}

# ------------------------------------------------------------------ #
# SSH access                                                          #
# ------------------------------------------------------------------ #

variable "do_ssh_key_name" {
  description = "Name of an SSH key already registered in DigitalOcean to attach to the Droplet. Takes precedence over do_ssh_key_ids."
  type        = string
  default     = ""
}

variable "do_ssh_key_ids" {
  description = "List of DigitalOcean SSH key IDs (integers) to attach when do_ssh_key_name is empty."
  type        = list(number)
  default     = []
}

# ------------------------------------------------------------------ #
# Cloud-init                                                          #
# ------------------------------------------------------------------ #

variable "user_data" {
  description = "Cloud-init user-data script. Leave empty to skip."
  type        = string
  default     = ""
}

# ------------------------------------------------------------------ #
# Tags                                                                #
# ------------------------------------------------------------------ #

variable "tags" {
  description = "Tags to apply to the Droplet."
  type        = list(string)
  default     = ["awx-managed"]
}
