import {
  countGeneratedInventoryHosts,
  inventoryVariablesToYaml,
  parseGeneratedInventory,
} from './GeneratedInventory';

describe('parseGeneratedInventory', () => {
  it('parses groups, children, hosts, and variables from AI-generated INI', () => {
    const plan = parseGeneratedInventory(`
[web]
web1.example.com ansible_user=ec2-user role=frontend
web2.example.com ansible_host=10.0.0.12

[db]
db1.example.com ansible_user=postgres

[prod:children]
web
db

[all:vars]
ansible_ssh_private_key_file=~/.ssh/id_rsa

[web:vars]
http_port=8080
`);

    expect(plan.groups.map((group) => group.name)).to.deep.equal(['web', 'db', 'prod']);
    expect(plan.groups.find((group) => group.name === 'web')?.hosts).to.deep.equal([
      {
        name: 'web1.example.com',
        variables: { ansible_user: 'ec2-user', role: 'frontend' },
      },
      {
        name: 'web2.example.com',
        variables: { ansible_host: '10.0.0.12' },
      },
    ]);
    expect(plan.groups.find((group) => group.name === 'web')?.variables).to.deep.equal({
      http_port: '8080',
    });
    expect(plan.groups.find((group) => group.name === 'prod')?.children).to.deep.equal([
      'web',
      'db',
    ]);
    expect(plan.hosts.map((host) => host.name)).to.deep.equal([
      'web1.example.com',
      'web2.example.com',
      'db1.example.com',
    ]);
    expect(plan.variables).to.deep.equal({
      ansible_ssh_private_key_file: '~/.ssh/id_rsa',
    });
    expect(countGeneratedInventoryHosts(plan)).to.equal(3);
  });

  it('formats generated variable records as AWX YAML fields', () => {
    expect(inventoryVariablesToYaml({ ansible_user: 'admin' })).to.contain('ansible_user: admin');
    expect(inventoryVariablesToYaml({})).to.equal('---\n');
  });
});
