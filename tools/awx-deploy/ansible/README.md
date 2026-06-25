# AWX Deploy Roles

This tree deploys this repository's AWX build. It does not merge or pull AWX
application code from upstream.

Supported paths:

- `server`: containerized services on VMs, managed by systemd.
- `k3s`: install k3s, then deploy AWX into the cluster.
- `k8s`: deploy AWX into an existing Kubernetes cluster.

Server roles are componentized. A single host can belong to every group, or
components can be split across multiple hosts:

- `awx_database`
- `awx_redis`
- `awx_web`
- `awx_task`
- `awx_receptor`
- `awx_lb`

For a single-node install, put the same host in `awx_database`, `awx_redis`,
`awx_web`, `awx_task`, and `awx_receptor`. The Receptor role runs from the AWX
image so local execution has `ansible-runner` and the same mounted project,
media, and container storage paths as AWX.

Secrets must be passed through environment variables, vault, or extra vars.
Do not commit `group_vars/all.yml` with real passwords.

## Quick Start: Server

```bash
cd tools/awx-deploy/ansible
cp group_vars/all.yml.example group_vars/all.yml
export AWX_ADMIN_PASSWORD='change-me'
export AWX_POSTGRES_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-server.yml
```

## Quick Start: Existing Kubernetes

```bash
cd tools/awx-deploy/ansible
export KUBECONFIG=/path/to/kubeconfig
export AWX_ADMIN_PASSWORD='change-me'
export AWX_POSTGRES_PASSWORD='change-me'
ansible-playbook -i localhost, playbooks/deploy-k8s.yml
```

To expose AWX through a node port instead of an ingress, set:

```bash
ansible-playbook -i localhost, playbooks/deploy-k8s.yml \
  -e awx_k8s_service_type=NodePort \
  -e awx_k8s_node_port=30813
```

## Quick Start: k3s

```bash
cd tools/awx-deploy/ansible
export AWX_ADMIN_PASSWORD='change-me'
export AWX_POSTGRES_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-k3s.yml
```

To install k3s without deploying AWX, use:

```bash
ansible-playbook -i inventories/example.ini playbooks/install-k3s.yml
```

## Backup / Restore

```bash
ansible-playbook -i inventories/example.ini playbooks/backup.yml
ansible-playbook -i inventories/example.ini playbooks/restore.yml \
  -e awx_restore_confirm=true \
  -e awx_restore_path=/var/backups/awx/awx-20260625T010101Z
```

## vCenter Lab

Set credentials only in environment variables. The Ansible control node must
have `community.vmware` and a working `pyVmomi` / `pyVim` import path.

```bash
export VCENTER_HOSTNAME=vcenter.example.com
export VCENTER_USERNAME='administrator@example.local'
read -rsp "vCenter password: " VCENTER_PASSWORD; export VCENTER_PASSWORD
ansible-playbook -i localhost, playbooks/vcenter-lab.yml
```

By default the role writes a generated inventory to
`/tmp/awx-vcenter-lab.ini`. Use that file as the input to `deploy-server.yml`
after the cloned VM template has working SSH access:

```bash
ansible-playbook -i /tmp/awx-vcenter-lab.ini playbooks/deploy-server.yml
```
