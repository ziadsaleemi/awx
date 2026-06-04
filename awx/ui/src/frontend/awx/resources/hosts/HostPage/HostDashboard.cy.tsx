import mockAwxHost from '../../../../../cypress/fixtures/awxHost.json';
import { HostDashboard } from './HostDashboard';

describe('HostDashboard', () => {
  beforeEach(() => {
    cy.intercept({ method: 'GET', url: '/api/v2/hosts/435/' }, mockAwxHost);
    cy.intercept(
      { method: 'GET', url: '/api/v2/credentials/*' },
      {
        count: 1,
        results: [
          {
            id: 7,
            name: 'Demo Machine Credential',
            credential_type__namespace: 'ssh',
          },
        ],
      }
    );
    cy.intercept(
      { method: 'GET', url: '/api/v2/hosts/435/ansible_facts/' },
      {
        ansible_distribution: 'RedHat',
        ansible_distribution_version: '9.4',
        ansible_kernel: '5.14.0',
        ansible_architecture: 'x86_64',
        ansible_virtualization_type: 'kvm',
        ansible_processor_vcpus: 8,
        ansible_memtotal_mb: 32768,
        ansible_memfree_mb: 16384,
        ansible_default_ipv4: {
          address: '10.0.0.10',
          interface: 'ens18',
          gateway: '10.0.0.1',
        },
        ansible_interfaces: ['ens18', 'lo'],
        ansible_python_version: '3.12.1',
        ansible_pkg_mgr: 'dnf',
        ansible_service_mgr: 'systemd',
        ansible_uptime_seconds: 90061,
        ansible_mounts: [
          {
            mount: '/',
            device: '/dev/sda1',
            size_total: 107374182400,
            size_available: 53687091200,
          },
        ],
      }
    );
  });

  it('renders host fact cards', () => {
    cy.mount(<HostDashboard page="host" />, {
      path: '/hosts/:id/dashboard',
      initialEntries: ['/hosts/435/dashboard'],
    });

    cy.contains(/^System summary$/).should('exist');
    cy.contains(/^Compute$/).should('exist');
    cy.contains(/^Storage$/).should('exist');
    cy.contains('RedHat').should('exist');
    cy.contains('10.0.0.10').should('exist');
    cy.contains('8').should('exist');
  });

  it('launches host fact collection', () => {
    cy.intercept({ method: 'POST', url: '/api/v2/hosts/435/ad_hoc_commands/' }, { id: 225 }).as(
      'launchFacts'
    );
    cy.mount(<HostDashboard page="host" />, {
      path: '/hosts/:id/dashboard',
      initialEntries: ['/hosts/435/dashboard'],
    });

    cy.getByDataCy('pull-host-facts').click();
    cy.wait('@launchFacts').its('request.body').should('include', {
      credential: 7,
      module_name: 'setup',
      module_args: '',
      forks: 0,
      verbosity: 0,
      become_enabled: false,
      diff_mode: false,
      extra_vars: '',
    });
  });
});
