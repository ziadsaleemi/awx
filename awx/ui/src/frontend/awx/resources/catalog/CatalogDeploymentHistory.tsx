import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { CubesIcon } from '@patternfly/react-icons';
import {
  DateTimeCell,
  ITableColumn,
  LoadingPage,
  PageLayout,
  PageTable,
  TextCell,
  useGetPageUrl,
  useInMemoryView,
  usePageNavigate,
} from '../../../../framework';
import { useGetItem } from '../../../common/crud/useGet';
import {
  ComponentFactory,
  DagreLayout,
  DefaultGroup,
  EdgeModel,
  Graph,
  GraphComponent,
  LabelPosition,
  ModelKind,
  NodeShape,
  NodeStatus,
  TopologyControlBar,
  TopologyView,
  Visualization,
  VisualizationProvider,
  VisualizationSurface,
  action,
  createTopologyControlButtons,
  defaultControlButtonsOptions,
  withPanZoom,
  withSelection,
} from '@patternfly/react-topology';
import { useAwxGetAllPages } from '../../common/useAwxGetAllPages';
import { WorkflowOutputNode } from '../../views/jobs/WorkflowOutput/WorkflowOutputNode';
import { CustomEdge, CustomNode } from '../templates/WorkflowVisualizer/components';
import { getNodeLabel } from '../templates/WorkflowVisualizer/wizard/helpers';
import { GRAPH_ID, NODE_DIAMETER, START_NODE_ID } from '../templates/WorkflowVisualizer/constants';
import { useCreateEdge } from '../templates/WorkflowVisualizer/hooks';
import { EdgeStatus } from '../templates/WorkflowVisualizer/types';
import { secondsToHHMMSS } from '../../../../framework/utils/dateTimeHelpers';
import type { WorkflowNode } from '../../interfaces/WorkflowNode';
import { StatusCell } from '../../../common/Status';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { CatalogDeployment } from '../../interfaces/CatalogDeployment';
import { historyJobOutputRoute, isWorkflowHistoryJob } from './catalogJobRoutes';

type HistoryEntry = CatalogDeployment['provisioning_history'][number] & { _idx: number };

function formatDuration(startIso: string, finishIso?: string): string {
  const start = new Date(startIso).valueOf();
  const end = finishIso ? new Date(finishIso).valueOf() : Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function historyEntryDuration(entry: {
  created: string;
  finished?: string;
  status: string;
}): string {
  if (!entry.finished && entry.status !== 'running') return '-';
  return formatDuration(entry.created, entry.finished);
}

// ─── Workflow job topology preview (matches AWX workflow visualizer) ──────────

function HistoryWorkflowTopology({ jobId }: { jobId: number }) {
  const { t } = useTranslation();
  const createEdge = useCreateEdge();

  const { results: workflowNodes } = useAwxGetAllPages<WorkflowNode>(
    awxAPI`/workflow_jobs/${String(jobId)}/workflow_nodes/`
  );

  const baselineComponentFactory: ComponentFactory = useCallback(
    (kind: ModelKind, type: string) => {
      switch (type) {
        case 'group':
          return DefaultGroup;
        case START_NODE_ID:
          return CustomNode;
        default:
          switch (kind) {
            case ModelKind.graph:
              return withPanZoom()(GraphComponent);
            case ModelKind.node:
              return withSelection()(WorkflowOutputNode);
            case ModelKind.edge:
              return CustomEdge;
            default:
              return undefined;
          }
      }
    },
    []
  );

  const createVisualization = useCallback(() => {
    const vis = new Visualization();
    vis.setFitToScreenOnLayout(true);
    vis.registerComponentFactory(baselineComponentFactory);
    vis.registerLayoutFactory(
      (type: string, graph: Graph) =>
        new DagreLayout(graph, {
          edgesep: 100,
          marginx: 20,
          marginy: 20,
          rankdir: 'LR',
          ranker: 'network-simplex',
          ranksep: 200,
        })
    );
    vis.fromModel(
      {
        nodes: [],
        edges: [],
        graph: { id: GRAPH_ID, type: 'graph', layout: 'Dagre', visible: false },
      },
      false
    );
    return vis;
  }, [baselineComponentFactory]);

  const visualizationRef = useRef<Visualization>(createVisualization());
  const visualization = visualizationRef.current;

  useEffect(() => {
    if (!workflowNodes?.length) return;
    const edges: EdgeModel[] = [];
    const startNode = {
      id: START_NODE_ID,
      type: START_NODE_ID,
      label: t('Start'),
      width: NODE_DIAMETER,
      height: NODE_DIAMETER,
      data: { resource: { always_nodes: [] } },
    };
    const nodes = workflowNodes.map((n) => {
      const nodeId = n.id.toString();
      const nodeName = n.summary_fields?.unified_job_template?.name || '';
      const nodeLabel = getNodeLabel(nodeName, n.identifier) || t('Deleted');
      n.success_nodes.forEach((id) =>
        edges.push(createEdge(nodeId, id.toString(), EdgeStatus.success))
      );
      n.failure_nodes.forEach((id) =>
        edges.push(createEdge(nodeId, id.toString(), EdgeStatus.danger))
      );
      n.always_nodes.forEach((id) =>
        edges.push(createEdge(nodeId, id.toString(), EdgeStatus.info))
      );
      const time = n.summary_fields?.job?.elapsed
        ? secondsToHHMMSS(n.summary_fields.job.elapsed)
        : '';
      const status = (n.summary_fields.job?.status as NodeStatus) || undefined;
      const node = {
        id: nodeId,
        type: status ? `${status}-node` : 'node',
        label: nodeLabel,
        width: NODE_DIAMETER,
        height: NODE_DIAMETER,
        shape: NodeShape.circle,
        status: status || NodeStatus.default,
        labelPosition: LabelPosition.bottom,
        data: {
          secondaryLabel: time ? t(`Elapsed time ${time}`) : undefined,
          resource: n,
        },
      };
      if (n.all_parents_must_converge) {
        return {
          ...node,
          data: {
            ...node.data,
            badge: 'ALL',
            badgeColor: 'var(--pf-v5-global--BackgroundColor--200)',
            badgeBorderColor: 'var(--pf-v5-global--palette--black-400)',
          },
        };
      }
      return node;
    });
    const nonRootNodes = edges.map((e) => e.target);
    const rootNodes = nodes.filter((n) => !nonRootNodes.includes(n.id) && n.id !== START_NODE_ID);
    rootNodes.forEach((n) => edges.push(createEdge(START_NODE_ID, n.id, EdgeStatus.info)));
    visualization.fromModel(
      {
        edges,
        nodes: [startNode, ...nodes],
        graph: { id: GRAPH_ID, type: 'graph', layout: 'Dagre', visible: true },
      },
      true
    );
  }, [t, visualization, createEdge, workflowNodes]);

  return (
    <div style={{ height: 300, position: 'relative' }}>
      <VisualizationProvider controller={visualization}>
        <TopologyView
          controlBar={
            <TopologyControlBar
              controlButtons={createTopologyControlButtons({
                ...defaultControlButtonsOptions,
                zoomInCallback: action(() => {
                  visualization.getGraph().scaleBy(4 / 3);
                }),
                zoomOutCallback: action(() => {
                  visualization.getGraph().scaleBy(0.75);
                }),
                fitToScreenCallback: action(() => {
                  visualization.getGraph().fit(80);
                }),
                resetViewCallback: action(() => {
                  visualization.getGraph().reset();
                  visualization.getGraph().layout();
                }),
                legend: false,
              })}
            />
          }
          sideBarOpen={false}
        >
          <VisualizationSurface />
        </TopologyView>
      </VisualizationProvider>
    </div>
  );
}

function HistoryExpandedRow({ entry }: { entry: HistoryEntry }) {
  const hasDetails = entry.details && Object.keys(entry.details).length > 0;
  if (entry.job_id && isWorkflowHistoryJob(entry)) {
    return <HistoryWorkflowTopology jobId={entry.job_id} />;
  }
  if (!hasDetails) return null;
  return (
    <pre
      style={{
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {JSON.stringify(entry.details, null, 2)}
    </pre>
  );
}

export function CatalogDeploymentHistory() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const getPageUrl = useGetPageUrl();
  const pageNavigate = usePageNavigate();

  const {
    data: deployment,
    error,
    isLoading,
    refresh,
  } = useGetItem<CatalogDeployment>(awxAPI`/catalog_deployments`, id);

  const items = useMemo<HistoryEntry[]>(
    () => (deployment?.provisioning_history ?? []).map((entry, idx) => ({ ...entry, _idx: idx })),
    [deployment]
  );

  const tableColumns = useMemo<ITableColumn<HistoryEntry>[]>(
    () => [
      {
        header: t('#'),
        cell: (entry) => <TextCell text={String(entry._idx + 1)} />,
        minWidth: 40,
      },
      {
        header: t('Action'),
        cell: (entry) => (
          <TextCell text={entry.action.charAt(0).toUpperCase() + entry.action.slice(1)} />
        ),
      },
      {
        header: t('Status'),
        cell: (entry) => <StatusCell status={entry.status} />,
      },
      {
        header: t('Started'),
        cell: (entry) => <DateTimeCell value={entry.created} />,
      },
      {
        header: t('Finished'),
        cell: (entry) =>
          entry.finished ? <DateTimeCell value={entry.finished} /> : <TextCell text="-" />,
      },
      {
        header: t('Duration'),
        cell: (entry) => <TextCell text={historyEntryDuration(entry)} />,
      },
      {
        header: t('Job'),
        cell: (entry) => {
          const route = historyJobOutputRoute(entry);
          return entry.job_id ? (
            <TextCell
              text={t('Job #{{id}}', { id: entry.job_id })}
              to={route ? getPageUrl(route.route, { params: route.params }) : undefined}
              onClick={() =>
                route ? pageNavigate(route.route, { params: route.params }) : undefined
              }
            />
          ) : (
            <TextCell text="-" />
          );
        },
      },
    ],
    [t, getPageUrl, pageNavigate]
  );

  const view = useInMemoryView<HistoryEntry>({
    items,
    keyFn: (entry) => entry._idx,
    tableColumns,
    disableQueryString: true,
  });

  const expandedRow = (entry: HistoryEntry) => {
    const hasDetails = entry.details && Object.keys(entry.details).length > 0;
    if (!entry.job_id && !hasDetails) return null;
    return <HistoryExpandedRow entry={entry} />;
  };

  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (isLoading || !deployment) return <LoadingPage />;

  return (
    <PageLayout>
      <PageTable<HistoryEntry>
        tableColumns={tableColumns}
        errorStateTitle={t('Error loading history')}
        emptyStateTitle={t('No provisioning history yet.')}
        emptyStateIcon={CubesIcon}
        emptyStateDescription={t('This deployment has no provisioning history.')}
        expandedRow={expandedRow}
        disableListView
        disableCardView
        {...view}
        defaultSubtitle={t('Provisioning History')}
      />
    </PageLayout>
  );
}
