# Proxmox VM Terraform Module

Provisions a single Proxmox VM from a cloud-init-enabled template, assigns a
static IP via cloud-init, and exposes the VM's IP address as a Terraform output
so AWX can automatically add the host to an inventory group.

## Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `vm_name` | ✅ | — | Name for the new VM |
| `ip_address` | ✅ | — | Static IPv4 address (no prefix length), e.g. `192.168.1.100` |
| `gateway` | ✅ | — | Default IPv4 gateway |
| `proxmox_template_name` | ✅ | — | Name of the Proxmox template to clone |
| `cores` | | `2` | vCPU count |
| `memory` | | `2048` | Memory in MiB |
| `disk_gb` | | `20` | Disk size in GiB |
| `storage_pool` | | `local-lvm` | Proxmox storage pool |
| `network_bridge` | | `vmbr0` | Proxmox network bridge |
| `cloud_init_user` | | `ansible` | User created by cloud-init |
| `cloud_init_password` | | `""` | Cloud-init user password |
| `ssh_public_key` | | `""` | SSH public key(s) for cloud-init |
| `ssh_private_key` | | `""` | SSH private key for boot-wait provisioner |

## Proxmox credentials

Credentials are **not** stored in variables.tf — they are injected by AWX
through the **Proxmox VE** credential type as environment variables:

| Env var | Purpose |
|---------|---------|
| `PM_API_URL` | Proxmox API endpoint URL |
| `PM_API_TOKEN_ID` | API token in `user@realm!tokenname` format |
| `PM_API_TOKEN_SECRET` | API token UUID secret |
| `PM_NODE` | Target Proxmox node name |
| `PM_TLS_INSECURE` | `true` to skip TLS verification (lab only) |

## AWX inventory population

After a successful `terraform apply`, AWX reads the `host_ip_proxmox_vm` output
and creates a host record in the configured target inventory. The host is added
to the `proxmox_vms` group. The `ansible_host` variable is set to the IP address,
`ansible_user` is set from `cloud_init_user`, and `ansible_remote_tmp` is set to
`/tmp/ansible` so the subsequent Ansible job template can connect to the newly
provisioned VM without using the remote home directory for module temp files.

## Usage outside AWX

```bash
export PM_API_URL=https://proxmox.example.com:8006/api2/json
export PM_API_TOKEN_ID=root@pam!mytoken
export PM_API_TOKEN_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export PM_NODE=pve

terraform init
terraform apply \
  -var="vm_name=test-vm-01" \
  -var="ip_address=192.168.1.100" \
  -var="gateway=192.168.1.1" \
  -var="proxmox_template_name=ubuntu-22.04-cloud"
```
