import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { EdaActivationPage } from '../../resources/eda/EdaActivationPage';
import { EdaActivations } from '../../resources/eda/EdaActivations';
import { EdaResourceConfig, EdaResourceList } from '../../resources/eda/EdaResourceList';
import { AwxRoute } from '../AwxRoutes';

export function useAwxEdaRoutes() {
  const { t } = useTranslation();
  return useMemo<PageNavigationItem>(() => {
    const ruleAudit = resourceConfig({
      resource: 'rule-audit',
      title: t('Rule Audit'),
      description: t('Review rule execution audit records from the connected EDA Controller.'),
      emptyStateTitle: t('No rule audit records found'),
      emptyStateDescription: t('Run rulebook activations to generate rule audit records.'),
      readOnly: true,
      fields: [
        { label: t('Status'), keys: ['status', 'state'], type: 'status' },
        { label: t('Rule'), keys: ['rule_name', 'rule', 'ruleset_name'] },
        { label: t('Created'), keys: ['created', 'created_at'], type: 'date' },
      ],
    });
    const projects = resourceConfig({
      resource: 'projects',
      title: t('Projects'),
      description: t('Manage EDA projects used to discover rulebooks.'),
      emptyStateTitle: t('No EDA projects found'),
      emptyStateDescription: t('Create or sync an EDA project to load rulebooks.'),
      form: 'project',
      createSample: {
        name: '',
        description: '',
        url: '',
        scm_branch: 'main',
        verify_ssl: true,
      },
      fields: [
        { label: t('SCM URL'), keys: ['url', 'scm_url'] },
        { label: t('Status'), keys: ['import_state', 'status', 'state'], type: 'status' },
        { label: t('Modified'), keys: ['modified', 'modified_at'], type: 'date' },
      ],
    });
    const decisionEnvironments = resourceConfig({
      resource: 'decision-environments',
      title: t('Decision Environments'),
      description: t('Manage execution images used by EDA rulebook activations.'),
      emptyStateTitle: t('No decision environments found'),
      emptyStateDescription: t(
        'Create a decision environment image reference before launching rulebooks.'
      ),
      form: 'decision-environment',
      createSample: {
        name: '',
        description: '',
        image_url: 'quay.io/ansible/ansible-rulebook:latest',
      },
      fields: [
        { label: t('Image'), keys: ['image_url', 'image', 'container_image'] },
        { label: t('Status'), keys: ['status', 'state'], type: 'status' },
        { label: t('Modified'), keys: ['modified', 'modified_at'], type: 'date' },
      ],
    });
    const eventStreams = resourceConfig({
      resource: 'event-streams',
      title: t('Event Streams'),
      description: t('Manage EDA event stream endpoints for inbound events.'),
      emptyStateTitle: t('No event streams found'),
      emptyStateDescription: t('Create an event stream to receive webhook or external events.'),
      form: 'event-stream',
      createSample: { name: '', test_mode: false },
      fields: [
        { label: t('Status'), keys: ['status', 'state'], type: 'status' },
        { label: t('Test mode'), keys: ['test_mode', 'is_test_mode'] },
        { label: t('Modified'), keys: ['modified', 'modified_at'], type: 'date' },
      ],
    });
    const credentials = resourceConfig({
      resource: 'credentials',
      title: t('Credentials'),
      description: t('Manage credentials used by EDA projects, rulebooks, and event streams.'),
      emptyStateTitle: t('No EDA credentials found'),
      emptyStateDescription: t(
        'Create an EDA credential or sync credentials from the EDA Controller.'
      ),
      form: 'credential',
      createSample: { name: '', description: '', credential_type_id: null, inputs: {} },
      fields: [
        { label: t('Type'), keys: ['credential_type_name', 'credential_type', 'kind'] },
        { label: t('Organization'), keys: ['organization_name', 'organization'] },
        { label: t('Modified'), keys: ['modified', 'modified_at'], type: 'date' },
      ],
    });
    const credentialTypes = resourceConfig({
      resource: 'credential-types',
      title: t('Credential Types'),
      description: t('Manage EDA credential type schemas and injectors.'),
      emptyStateTitle: t('No EDA credential types found'),
      emptyStateDescription: t('Create an EDA credential type to define credential inputs.'),
      form: 'credential-type',
      createSample: { name: '', description: '', inputs: { fields: [] }, injectors: {} },
      fields: [
        { label: t('Kind'), keys: ['kind', 'managed_by'] },
        { label: t('Namespace'), keys: ['namespace'] },
        { label: t('Modified'), keys: ['modified', 'modified_at'], type: 'date' },
      ],
    });
    const rulebooks = resourceConfig({
      resource: 'rulebooks',
      title: t('Rulebooks'),
      description: t('Inspect rulebooks discovered by synced EDA projects.'),
      emptyStateTitle: t('No rulebooks found'),
      emptyStateDescription: t('Sync an EDA project to discover rulebooks.'),
      readOnly: true,
      fields: [
        { label: t('Project'), keys: ['project_name', 'project'] },
        { label: t('Rulesets'), keys: ['rulesets', 'ruleset_count'] },
        { label: t('Modified'), keys: ['modified', 'modified_at'], type: 'date' },
      ],
    });

    return {
      id: AwxRoute.EventDriven,
      label: t('Event-Driven'),
      path: 'eda',
      children: [
        {
          id: AwxRoute.EdaRuleAudit,
          label: t('Rule Audit'),
          path: 'rule-audit',
          element: <EdaResourceList config={ruleAudit} />,
        },
        {
          id: AwxRoute.EdaActivations,
          label: t('Rulebook Activations'),
          path: 'activations',
          children: [
            {
              id: AwxRoute.EdaActivationPage,
              path: ':id',
              element: <EdaActivationPage />,
            },
            {
              path: '',
              element: <EdaActivations />,
            },
          ],
        },
        {
          id: AwxRoute.EdaProjects,
          label: t('Projects'),
          path: 'projects',
          element: <EdaResourceList config={projects} />,
        },
        {
          id: AwxRoute.EdaDecisionEnvironments,
          label: t('Decision Environments'),
          path: 'decision-environments',
          element: <EdaResourceList config={decisionEnvironments} />,
        },
        {
          id: AwxRoute.EdaEventStreams,
          label: t('Event Streams'),
          path: 'event-streams',
          element: <EdaResourceList config={eventStreams} />,
        },
        {
          id: AwxRoute.EdaRulebooks,
          label: t('Rulebooks'),
          path: 'rulebooks',
          element: <EdaResourceList config={rulebooks} />,
        },
        {
          path: 'credentials',
          element: <Navigate to="/eda/infrastructure/credentials" replace />,
        },
        {
          path: 'credential-types',
          element: <Navigate to="/eda/infrastructure/credential-types" replace />,
        },
        {
          id: AwxRoute.EdaInfrastructure,
          label: t('Infrastructure'),
          path: 'infrastructure',
          children: [
            {
              id: AwxRoute.EdaCredentials,
              label: t('Credentials'),
              path: 'credentials',
              element: <EdaResourceList config={credentials} />,
            },
            {
              id: AwxRoute.EdaCredentialTypes,
              label: t('Credential Types'),
              path: 'credential-types',
              element: <EdaResourceList config={credentialTypes} />,
            },
            {
              path: '',
              element: <Navigate to="credentials" replace />,
            },
          ],
        },
        {
          path: '',
          element: <Navigate to="rule-audit" replace />,
        },
      ],
    };
  }, [t]);
}

function resourceConfig(config: EdaResourceConfig): EdaResourceConfig {
  return config;
}
