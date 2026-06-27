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
    ).as('getCredentials');
    cy.intercept(
      { method: 'GET', url: '/api/v2/hosts/435/ansible_facts/' },
      {
        ansible_distribution: 'RedHat',
        ansible_distribution_version: '9.4',
        ansible_kernel: '5.14.0',
        ansible_kernel_version: '#1 SMP Tue May 14 14:00:00 UTC 2024',
        ansible_architecture: 'x86_64',
        ansible_machine: 'x86_64',
        ansible_system: 'Linux',
        ansible_virtualization_type: 'kvm',
        ansible_virtualization_role: 'guest',
        ansible_processor_vcpus: 8,
        ansible_processor_count: 2,
        ansible_processor_cores: 4,
        ansible_processor_threads_per_core: 1,
        ansible_memtotal_mb: 32768,
        ansible_memfree_mb: 16384,
        ansible_loadavg: {
          '1m': 1.25,
          '5m': 0.9,
          '15m': 0.5,
        },
        ansible_date_time: {
          date: '2026-06-04',
          time: '05:14:34',
          tz: 'UTC',
          iso8601: '2026-06-04T05:14:34Z',
        },
        ansible_hostname: 'demo-host',
        ansible_fqdn: 'demo-host.example.com',
        ansible_nodename: 'demo-host',
        ansible_domain: 'example.com',
        ansible_user_id: 'ansible',
        ansible_user_dir: '/home/ansible',
        ansible_user_shell: '/bin/bash',
        ansible_user_uid: 1000,
        ansible_user_gid: 1000,
        ansible_machine_id: 'machine-123',
        ansible_os_family: 'RedHat',
        ansible_distribution_release: 'Plow',
        ansible_distribution_major_version: '9',
        ansible_userspace_bits: '64',
        ansible_system_vendor: 'R92',
        ansible_product_name: 'Proxmox VM',
        ansible_product_version: 'pc-q35-8.1',
        ansible_product_serial: 'vm-435',
        ansible_form_factor: 'Virtual Machine',
        ansible_board_name: 'QEMU',
        ansible_bios_vendor: 'SeaBIOS',
        ansible_bios_version: 'rel-1.16.2',
        ansible_bios_date: '04/01/2024',
        ansible_selinux: { status: 'disabled' },
        ansible_apparmor: { status: 'enabled' },
        ansible_fips: false,
        ansible_is_chroot: false,
        ansible_system_capabilities_enforced: 'True',
        ansible_default_ipv4: {
          address: '10.0.0.10',
          interface: 'ens18',
          gateway: '10.0.0.1',
          macaddress: '00:11:22:33:44:55',
        },
        ansible_dns: {
          nameservers: ['10.0.0.53', '1.1.1.1'],
          search: ['example.com'],
        },
        ansible_all_ipv4_addresses: ['10.0.0.10', '192.168.122.10'],
        ansible_all_ipv6_addresses: ['fe80::1'],
        ansible_locally_reachable_ips: {
          ipv4: ['127.0.0.1', '10.0.0.10'],
        },
        ansible_interfaces: ['ens18', 'lo'],
        ansible_ens18: {
          active: true,
          device: 'ens18',
          ipv4: { address: '10.0.0.10' },
          macaddress: '00:11:22:33:44:55',
          mtu: 1500,
          speed: 10000,
          type: 'ether',
        },
        ansible_devices: {
          sda: {
            size: '100.00 GB',
            model: 'QEMU HARDDISK',
            vendor: 'QEMU',
            rotational: '0',
            virtual: '1',
            scheduler_mode: 'none',
            partitions: {
              sda1: { size: '100.00 GB' },
            },
          },
        },
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
    cy.viewport(1920, 1100);
    cy.mount(<HostDashboard page="host" />, {
      path: '/hosts/:id/dashboard',
      initialEntries: ['/hosts/435/dashboard'],
    });

    cy.contains(/^System summary$/).should('exist');
    cy.contains(/^Resource utilization$/).should('exist');
    cy.contains(/^Network and runtime$/).should('exist');
    cy.contains(/^Platform and security$/).should('exist');
    cy.contains(/^Storage, devices, and interfaces$/).should('exist');
    cy.contains(/^Recent automation$/).should('exist');
    cy.contains('Last facts pull').should('exist');
    cy.contains('2026-06-04 05:14:34 UTC').should('exist');
    cy.contains('RedHat').should('exist');
    cy.contains('demo-host.example.com').should('exist');
    cy.contains('10.0.0.10').should('exist');
    cy.contains('00:11:22:33:44:55').should('exist');
    cy.contains('SeaBIOS').should('exist');
    cy.contains('QEMU HARDDISK').should('exist');
    cy.contains('8').should('exist');
    cy.get('.page-dashboard-card')
      .first()
      .then(($card) => {
        expect($card[0].getBoundingClientRect().left).to.be.at.least(16);
      });

    cy.contains('h3', 'Resource utilization')
      .parents('.page-dashboard-card')
      .then(($resourceCard) => {
        cy.contains('h3', 'Network and runtime')
          .parents('.page-dashboard-card')
          .then(($networkCard) => {
            const resourceRect = $resourceCard[0].getBoundingClientRect();
            const networkRect = $networkCard[0].getBoundingClientRect();
            expect(Math.abs(resourceRect.top - networkRect.top)).to.be.lessThan(2);
            expect(Math.abs(resourceRect.height - networkRect.height)).to.be.lessThan(2);
            expect(resourceRect.width).to.be.greaterThan(600);
            expect(networkRect.width).to.be.greaterThan(600);
          });
      });

    cy.contains('h3', 'Platform and security')
      .parents('.page-dashboard-card')
      .then(($platformCard) => {
        cy.contains('h3', 'Storage, devices, and interfaces')
          .parents('.page-dashboard-card')
          .then(($storageCard) => {
            const platformRect = $platformCard[0].getBoundingClientRect();
            const storageRect = $storageCard[0].getBoundingClientRect();
            expect(Math.abs(platformRect.top - storageRect.top)).to.be.lessThan(2);
            expect(Math.abs(platformRect.height - storageRect.height)).to.be.lessThan(2);
          });
      });
  });

  it('launches host fact collection', () => {
    cy.intercept(
      { method: 'POST', url: '/api/v2/hosts/435/ad_hoc_commands/' },
      { statusCode: 201, delayMs: 2500, body: { id: 225 } }
    ).as('launchFacts');
    cy.intercept(
      { method: 'GET', url: '/api/v2/ad_hoc_commands/225/' },
      { delayMs: 150, body: { id: 225, status: 'successful', host_status_counts: { ok: 1 } } }
    ).as('getFactJob');
    cy.mount(<HostDashboard page="host" />, {
      path: '/hosts/:id/dashboard',
      initialEntries: ['/hosts/435/dashboard'],
    });

    cy.wait('@getCredentials');
    cy.getByDataCy('pull-host-facts').should('not.be.disabled');
    cy.getByDataCy('pull-host-facts').click();
    cy.get('[data-cy="pull-host-facts"]')
      .should('have.attr', 'data-fact-pull-state', 'loading')
      .and('have.attr', 'aria-label', 'Pulling facts');
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
    cy.wait('@getFactJob');
    cy.get('[data-cy="pull-host-facts"]')
      .should('have.attr', 'data-fact-pull-state', 'success')
      .and('have.attr', 'aria-label', 'Facts updated');
    cy.get('[data-cy="pull-host-facts"]').should('be.disabled');
    cy.get('[data-cy="pull-host-facts"]', { timeout: 3000 })
      .should('have.attr', 'data-fact-pull-state', 'idle')
      .and('have.attr', 'aria-label', 'Pull facts');
    cy.getByDataCy('pull-host-facts').should('not.be.disabled');
  });
});
