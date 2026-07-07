"""
awx/main/tasks/terraform_credentials.py
----------------------------------------
Python-level credential injectors for Terraform cloud-provider credential
types that require logic beyond simple Jinja2 env-var templates.

Most providers (AWS, Azure, VMware, Proxmox VE, GCP, OCI) are fully covered
by the ``injectors`` dict on their ``CredentialType`` record (template-based
injection handled by ``CredentialType.inject_credential``).

This module provides a ``TerraformProviderInjector`` base class for future
providers that need imperative Python injection — for example, providers that
must:
  * fetch short-lived tokens from an OAuth endpoint before each run,
  * generate an HMAC signature over multiple fields, or
  * call an external secret store that is not accessible via a Vault lookup.

Usage
-----
Subclass ``TerraformProviderInjector`` and override ``inject``:

    class MyCloudInjector(TerraformProviderInjector):
        credential_type_namespace = 'my_cloud_terraform'

        def inject(self, credential, env, safe_env, private_data_dir):
            token = _fetch_token(credential.inputs['api_url'],
                                 credential.inputs['api_key'])
            env['MY_CLOUD_TOKEN'] = token
            safe_env['MY_CLOUD_TOKEN'] = REPLACE_STR

Register the injector so ``RunTerraformJob`` picks it up automatically:

    TerraformProviderInjector.register(MyCloudInjector)

``RunTerraformJob._build_env`` calls
``TerraformProviderInjector.apply_all(credential, env, safe_env, private_data_dir)``
for each attached credential after the template-based injection pass.
"""

import logging
from urllib.parse import urlparse

from awx.main.redact import REPLACE_STR  # noqa: F401 – re-exported for injectors

logger = logging.getLogger('awx.main.tasks.terraform_credentials')

# Registry: namespace → injector class
_REGISTRY: dict = {}


class TerraformProviderInjector:
    """
    Base class for Python-level Terraform credential injectors.

    Attributes
    ----------
    credential_type_namespace : str
        Must match the ``namespace`` field of the ``CredentialType`` model
        record this injector handles.  Used for registry lookup.
    """

    credential_type_namespace: str = ''

    # ------------------------------------------------------------------
    # Registry
    # ------------------------------------------------------------------

    @classmethod
    def register(cls, injector_cls: 'type[TerraformProviderInjector]') -> None:
        """Register a concrete injector class."""
        ns = injector_cls.credential_type_namespace
        if not ns:
            raise ValueError(f"{injector_cls.__name__} must define credential_type_namespace")
        if ns in _REGISTRY:
            logger.warning('Overriding existing TerraformProviderInjector for namespace %s', ns)
        _REGISTRY[ns] = injector_cls

    @classmethod
    def apply_all(cls, credential, env: dict, safe_env: dict, private_data_dir: str) -> None:
        """
        If a Python injector is registered for *credential*'s type namespace,
        call its ``inject`` method.  This is a no-op when no injector is
        registered (template-based injection suffices for most providers).
        """
        ns = getattr(credential.credential_type, 'namespace', None)
        injector_cls = _REGISTRY.get(ns)
        if injector_cls is None:
            return
        try:
            injector_cls().inject(credential, env, safe_env, private_data_dir)
        except Exception:
            logger.exception('TerraformProviderInjector for namespace %s raised an exception', ns)
            raise

    # ------------------------------------------------------------------
    # Subclass interface
    # ------------------------------------------------------------------

    def inject(
        self,
        credential,
        env: dict,
        safe_env: dict,
        private_data_dir: str,
    ) -> None:
        """
        Mutate *env* and *safe_env* to inject credentials for *credential*.

        Parameters
        ----------
        credential :
            A ``Credential`` model instance.  Access field values via
            ``credential.inputs['field_id']``.  Secrets are already
            decrypted at this point.
        env :
            The process environment dict that will be passed to the
            Terraform subprocess.  Add / modify keys here.
        safe_env :
            A copy of *env* where secret values have been replaced with
            ``REPLACE_STR`` (``"$encrypted$"``).  Keep in sync with *env*
            so logs do not leak secrets.
        private_data_dir :
            The job's isolated data directory.  Write any temporary files
            here so they are cleaned up after the job finishes.
        """
        raise NotImplementedError(f"{self.__class__.__name__} must implement inject()")


def _normalize_vsphere_server(value):
    """
    Return the hostname portion expected by the vSphere Terraform provider.

    The provider constructs its own SDK URL, so passing a full URL can produce
    malformed requests like ``https://https//vcenter.example/sdk``.
    """
    raw = str(value or '').strip().rstrip('/')
    if not raw:
        return ''

    # Repair the common "https//host" typo/mangling before parsing.
    raw = raw.replace('https//', 'https://', 1).replace('http//', 'http://', 1)

    if '://' in raw:
        parsed = urlparse(raw)
        raw = parsed.netloc or parsed.path

    if raw.endswith('/sdk'):
        raw = raw[: -len('/sdk')]

    return raw.strip().strip('/')


class VMwareVsphereTerraformInjector(TerraformProviderInjector):
    credential_type_namespace = 'vmware_vsphere_terraform'

    def inject(self, credential, env, safe_env, private_data_dir):
        server = _normalize_vsphere_server(credential.get_input('vsphere_server', default=''))
        user = credential.get_input('vsphere_user', default='') or ''
        password = credential.get_input('vsphere_password', default='') or ''
        allow_unverified_ssl = str(credential.get_input('vsphere_allow_unverified_ssl', default=False)).lower()

        values = {
            'VSPHERE_SERVER': server,
            'VSPHERE_USER': user,
            'VSPHERE_PASSWORD': password,
            'VSPHERE_ALLOW_UNVERIFIED_SSL': allow_unverified_ssl,
            'TF_VAR_vsphere_server': server,
            'TF_VAR_vsphere_user': user,
            'TF_VAR_vsphere_password': password,
            'TF_VAR_vsphere_allow_unverified_ssl': allow_unverified_ssl,
        }
        env.update(values)
        safe_env.update(values)
        safe_env['VSPHERE_PASSWORD'] = REPLACE_STR
        safe_env['TF_VAR_vsphere_password'] = REPLACE_STR


TerraformProviderInjector.register(VMwareVsphereTerraformInjector)
