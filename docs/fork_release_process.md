# Fork Release Process

This repository owns releases from this point forward. Do not pull or merge
upstream AWX code during a release unless that is the explicit goal of a
separate development task.

## Release Contract

Each release must produce:

- A signed-off version bump commit on `devel`.
- A pushed git tag named exactly like the version, for example `25.1.2`.
- A pushed linux/amd64 deployment image, by default
  `docker.io/ziadsaleemi/awx:<version>`.

The deployment roles consume `awx_image` and `awx_image_tag`; the default tag is
bumped during release prep so new installs use the new image.

## Version Prep

Before tagging, bump these files to the target version:

- `awx/ui/src/frontend/common/AboutModal.tsx`
- `awx/ui/src/package.json`
- `VERSION`
- `tools/awx-deploy/ansible/roles/awx_deploy_common/defaults/main.yml`
- `tools/awx-deploy/ansible/group_vars/all.yml.example`

Commit and push that change first:

```bash
git add awx/ui/src/frontend/common/AboutModal.tsx \
  awx/ui/src/package.json \
  VERSION \
  tools/awx-deploy/ansible/roles/awx_deploy_common/defaults/main.yml \
  tools/awx-deploy/ansible/group_vars/all.yml.example \
  ENHANCEMENTS.md docs/fork_release_process.md tools/scripts/release-awx.sh
git commit --signoff -m "Prepare AWX 25.1.2 release"
git push origin devel
```

## Build and Tag

The release script validates the branch, checks that the release files match the
version, runs deploy syntax checks, builds/pushes the linux/amd64 image, then
creates and pushes the git tag.

```bash
docker login docker.io
tools/scripts/release-awx.sh 25.1.2
```

Optional flags:

```bash
tools/scripts/release-awx.sh 25.1.2 --image docker.io/ziadsaleemi/awx --platforms linux/amd64
tools/scripts/release-awx.sh 25.1.2 --skip-build
tools/scripts/release-awx.sh 25.1.2 --skip-tag
tools/scripts/release-awx.sh 25.1.2 --latest
```

## Builder Machine

Local Apple Silicon can build `linux/amd64` through Docker buildx, but AWX image
builds are heavy. If local build time or memory is poor, use a dedicated
linux/amd64 vCenter builder VM with at least:

- 16 vCPU
- 32 GB RAM
- 200 GB disk
- Docker Engine with buildx
- SSH access from the workstation

VMware provisioning must stay separate from the AWX deployment roles. Use the
vCenter-specific playbooks and vars under `tools/awx-deploy/ansible` to create
builder or lab VMs, then run the same `tools/scripts/release-awx.sh` command on
that VM.

## Verification

After the script finishes:

```bash
git ls-remote --tags origin 25.1.2
docker buildx imagetools inspect docker.io/ziadsaleemi/awx:25.1.2
```

Then deploy with:

```bash
ansible-playbook -i inventories/example.ini playbooks/deploy-server.yml \
  -e awx_image=docker.io/ziadsaleemi/awx \
  -e awx_image_tag=25.1.2
```
