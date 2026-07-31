import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import { PageNavigationItem } from '../../../../framework';
import { EdaActivationPage } from '../../resources/eda/EdaActivationPage';
import { EdaActivationStartPage } from '../../resources/eda/EdaActivationStartPage';
import { EdaActivations } from '../../resources/eda/EdaActivations';
import {
  EdaResourceConfig,
  EdaResourceDetailsPage,
  EdaResourceFormPage,
  EdaResourceList,
} from '../../resources/eda/EdaResourceList';
import { AwxRoute } from '../AwxRoutes';

export function useAwxEdaRoutes() {
  const { t } = useTranslation();
  return useMemo<PageNavigationItem>(() => {
    const ruleAudit = resourceConfig({
      resource: 'rule-audit',
      basePath: '/eda/rule-audit',
      title: t('Rule Audit'),
      singularTitle: t('rule audit record'),
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
      resource: 'project-sources',
      basePath: '/eda/projects',
      title: t('Event Engine Projects'),
      singularTitle: t('project'),
      description: t(
        'Use accessible Capstan Projects as the source of truth for Event Engine rulebooks.'
      ),
      emptyStateTitle: t('No source control projects found'),
      emptyStateDescription: t(
        'Create a Git project in Capstan, then synchronize it with Event Engine.'
      ),
      projectBacked: true,
      fields: [
        { label: t('Source status'), keys: ['source_status'], type: 'status' },
        { label: t('Event Engine status'), keys: ['integration_status'], type: 'status' },
        { label: t('Last synchronized'), keys: ['eda_last_synced_at'], type: 'date' },
      ],
    });
    const decisionEnvironments = resourceConfig({
      resource: 'decision-environments',
      basePath: '/eda/decision-environments',
      title: t('Decision Environments'),
      singularTitle: t('decision environment'),
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
      basePath: '/eda/event-streams',
      title: t('Event Streams'),
      singularTitle: t('event stream'),
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
    const rulebooks = resourceConfig({
      resource: 'rulebooks',
      basePath: '/eda/rulebooks',
      title: t('Rulebooks'),
      singularTitle: t('rulebook'),
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
          children: resourcePageChildren(ruleAudit),
        },
        {
          id: AwxRoute.EdaActivations,
          label: t('Rulebook Activations'),
          path: 'activations',
          children: [
            {
              path: 'create',
              element: <EdaActivationStartPage />,
            },
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
          children: projectSourcePageChildren(projects),
        },
        {
          id: AwxRoute.EdaDecisionEnvironments,
          label: t('Decision Environments'),
          path: 'decision-environments',
          children: resourcePageChildren(decisionEnvironments),
        },
        {
          id: AwxRoute.EdaEventStreams,
          label: t('Event Streams'),
          path: 'event-streams',
          children: resourcePageChildren(eventStreams),
        },
        {
          id: AwxRoute.EdaRulebooks,
          label: t('Rulebooks'),
          path: 'rulebooks',
          children: resourcePageChildren(rulebooks),
        },
        {
          path: 'credentials/*',
          element: <Navigate to="/access/credentials" replace />,
        },
        {
          path: 'credential-types/*',
          element: <Navigate to="/access/credential-types" replace />,
        },
        {
          path: 'infrastructure/credentials/*',
          element: <Navigate to="/access/credentials" replace />,
        },
        {
          path: 'infrastructure/credential-types/*',
          element: <Navigate to="/access/credential-types" replace />,
        },
        {
          path: 'infrastructure/*',
          element: <Navigate to="/access/credentials" replace />,
        },
        {
          path: 'access/organizations/*',
          element: <Navigate to="/access/organizations" replace />,
        },
        {
          path: 'access/teams/*',
          element: <Navigate to="/access/teams" replace />,
        },
        {
          path: 'access/users/*',
          element: <Navigate to="/access/users" replace />,
        },
        {
          path: 'access/roles/*',
          element: <Navigate to="/access/roles" replace />,
        },
        {
          path: 'access/user-role-assignments/*',
          element: <Navigate to="/access/roles" replace />,
        },
        {
          path: 'access/team-role-assignments/*',
          element: <Navigate to="/access/roles" replace />,
        },
        {
          path: 'access/status',
          element: <Navigate to="/access/credentials" replace />,
        },
        {
          path: 'access/*',
          element: <Navigate to="/access/credentials" replace />,
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

function resourcePageChildren(config: EdaResourceConfig): PageNavigationItem[] {
  const children: PageNavigationItem[] = [];
  if (!config.readOnly && config.form) {
    children.push(
      {
        path: 'create',
        element: <EdaResourceFormPage config={config} mode="create" />,
      },
      {
        path: ':id/edit',
        element: <EdaResourceFormPage config={config} mode="edit" />,
      }
    );
  }
  children.push(
    {
      path: ':id',
      element: <EdaResourceDetailsPage config={config} />,
    },
    {
      path: '',
      element: <EdaResourceList config={config} />,
    }
  );
  return children;
}

function projectSourcePageChildren(config: EdaResourceConfig): PageNavigationItem[] {
  return [
    {
      path: 'create',
      element: <Navigate to="/projects/create" replace />,
    },
    {
      path: ':id/edit',
      element: <ProjectEditRedirect />,
    },
    ...resourcePageChildren(config),
  ];
}

function ProjectEditRedirect() {
  const params = useParams<{ id: string }>();
  return <Navigate to={`/projects/${encodeURIComponent(params.id ?? '')}/edit`} replace />;
}
