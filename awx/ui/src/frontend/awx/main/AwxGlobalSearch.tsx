import {
  Button,
  Divider,
  Flex,
  FlexItem,
  Spinner,
  Text,
  TextContent,
  TextInput,
  TextVariants,
} from '@patternfly/react-core';
import {
  ArchiveIcon,
  BriefcaseIcon,
  LayerGroupIcon,
  SearchIcon,
} from '@patternfly/react-icons';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageNavigate } from '../../../framework';
import { requestGet } from '../../common/crud/Data';
import { AwxItemsResponse } from '../common/AwxItemsResponse';
import { awxAPI } from '../common/api/awx-utils';
import { AwxRoute } from './AwxRoutes';

interface SearchResultItem {
  id: number;
  name: string;
  type: 'job' | 'template' | 'workflow_template' | 'inventory' | 'terraform_template';
  subtitle?: string;
}

interface QuickResult extends SearchResultItem {
  route: AwxRoute;
  routeParams: Record<string, string | number>;
  icon: ReactNode;
}

function categoryLabel(type: SearchResultItem['type'], t: (k: string) => string): string {
  switch (type) {
    case 'job':
      return t('Jobs');
    case 'template':
      return t('Templates');
    case 'workflow_template':
      return t('Workflow Templates');
    case 'inventory':
      return t('Inventories');
    case 'terraform_template':
      return t('Terraform Templates');
  }
}

function categoryIcon(type: SearchResultItem['type']): ReactNode {
  switch (type) {
    case 'job':
      return <BriefcaseIcon style={{ color: 'var(--pf-v5-global--Color--100)' }} />;
    case 'template':
    case 'workflow_template':
    case 'terraform_template':
      return <LayerGroupIcon style={{ color: 'var(--pf-v5-global--Color--100)' }} />;
    case 'inventory':
      return <ArchiveIcon style={{ color: 'var(--pf-v5-global--Color--100)' }} />;
  }
}

export function AwxGlobalSearch() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<QuickResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pageNavigate = usePageNavigate();

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      // slight delay so the DOM element is visible
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setIsLoading(true);
    const timer = setTimeout(async () => {
      const q = encodeURIComponent(query.trim());
      try {
        const [jobs, templates, wfTemplates, inventories, terraformTemplates] = await Promise.all([
          requestGet<AwxItemsResponse<{ id: number; name: string; type: string; status?: string }>>(
            awxAPI`/unified_jobs/?name__icontains=${query.trim()}&not__launch_type=sync&order_by=-finished&page_size=5`
          ).catch(() => ({ results: [] })),
          requestGet<AwxItemsResponse<{ id: number; name: string }>>(
            awxAPI`/job_templates/?name__icontains=${query.trim()}&order_by=name&page_size=5`
          ).catch(() => ({ results: [] })),
          requestGet<AwxItemsResponse<{ id: number; name: string }>>(
            awxAPI`/workflow_job_templates/?name__icontains=${query.trim()}&order_by=name&page_size=5`
          ).catch(() => ({ results: [] })),
          requestGet<AwxItemsResponse<{ id: number; name: string }>>(
            awxAPI`/inventories/?name__icontains=${query.trim()}&order_by=name&page_size=5`
          ).catch(() => ({ results: [] })),
          requestGet<AwxItemsResponse<{ id: number; name: string }>>(
            awxAPI`/terraform_job_templates/?name__icontains=${query.trim()}&order_by=name&page_size=5`
          ).catch(() => ({ results: [] })),
        ]);

        const combined: QuickResult[] = [
          ...(jobs.results ?? []).map((j) => ({
            id: j.id,
            name: j.name,
            type: 'job' as const,
            subtitle: j.status,
            route: AwxRoute.JobOutput,
            routeParams: { id: j.id },
            icon: categoryIcon('job'),
          })),
          ...(templates.results ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            type: 'template' as const,
            route: AwxRoute.JobTemplateDetails,
            routeParams: { id: t.id },
            icon: categoryIcon('template'),
          })),
          ...(wfTemplates.results ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            type: 'workflow_template' as const,
            route: AwxRoute.WorkflowJobTemplateDetails,
            routeParams: { id: t.id },
            icon: categoryIcon('workflow_template'),
          })),
          ...(inventories.results ?? []).map((inv) => ({
            id: inv.id,
            name: inv.name,
            type: 'inventory' as const,
            route: AwxRoute.InventoryDetails,
            routeParams: { id: inv.id },
            icon: categoryIcon('inventory'),
          })),
          ...(terraformTemplates.results ?? []).map((tf) => ({
            id: tf.id,
            name: tf.name,
            type: 'terraform_template' as const,
            route: AwxRoute.TerraformTemplateDetails,
            routeParams: { id: tf.id },
            icon: categoryIcon('terraform_template'),
          })),
        ];
        setResults(combined);
        setSelectedIndex(0);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const navigate = (result: QuickResult) => {
    pageNavigate(result.route, { params: result.routeParams });
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      navigate(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  // Group results by type
  const grouped = results.reduce<Record<string, QuickResult[]>>((acc, r) => {
    acc[r.type] = acc[r.type] ?? [];
    acc[r.type].push(r);
    return acc;
  }, {});

  const typeOrder: SearchResultItem['type'][] = ['job', 'template', 'workflow_template', 'inventory', 'terraform_template'];

  return (
    <>
      <Button
        variant="plain"
        aria-label={t('Search')}
        title={`${t('Search')} (⌘K)`}
        onClick={() => setIsOpen(true)}
        data-cy="global-search-button"
      >
        <SearchIcon />
      </Button>

      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '10vh',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div
            style={{
              background: 'var(--pf-v5-global--BackgroundColor--100)',
              borderRadius: 8,
              width: '100%',
              maxWidth: 580,
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
              overflow: 'hidden',
            }}
            onKeyDown={handleKeyDown}
          >
            {/* Search input */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 8 }}>
              <SearchIcon style={{ color: 'var(--pf-v5-global--Color--200)', flexShrink: 0 }} />
              <TextInput
                ref={inputRef}
                value={query}
                onChange={(_e, v) => setQuery(v)}
                placeholder={t('Search jobs, templates, inventories…')}
                aria-label={t('Global search')}
                style={{
                  border: 'none',
                  outline: 'none',
                  boxShadow: 'none',
                  background: 'transparent',
                  fontSize: 16,
                  flex: 1,
                }}
              />
              {isLoading && <Spinner size="sm" />}
              <Button
                variant="plain"
                aria-label={t('Close search')}
                onClick={() => setIsOpen(false)}
                style={{ fontSize: 12, color: 'var(--pf-v5-global--Color--200)' }}
              >
                Esc
              </Button>
            </div>

            {/* Results */}
            {results.length > 0 && (
              <>
                <Divider />
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {typeOrder
                    .filter((type) => grouped[type]?.length)
                    .map((type) => (
                      <div key={type}>
                        <div
                          style={{
                            padding: '6px 16px 2px',
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--pf-v5-global--Color--200)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {categoryLabel(type, t)}
                        </div>
                        {grouped[type].map((result) => {
                          const idx = results.indexOf(result);
                          const isSelected = idx === selectedIndex;
                          return (
                            <div
                              key={`${result.type}-${result.id}`}
                              onClick={() => navigate(result)}
                              onMouseEnter={() => setSelectedIndex(idx)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '8px 16px',
                                cursor: 'pointer',
                                background: isSelected
                                  ? 'var(--pf-v5-global--active-color--400)'
                                  : undefined,
                                borderRadius: 4,
                                margin: '1px 4px',
                              }}
                            >
                              <span style={{ flexShrink: 0 }}>{result.icon}</span>
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {result.name}
                              </span>
                              {result.subtitle && (
                                <span style={{ fontSize: 12, color: 'var(--pf-v5-global--Color--200)' }}>
                                  {result.subtitle}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                </div>
              </>
            )}

            {/* Empty state */}
            {!isLoading && query.trim() && results.length === 0 && (
              <>
                <Divider />
                <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--pf-v5-global--Color--200)' }}>
                  {t('No results found for')} &ldquo;{query}&rdquo;
                </div>
              </>
            )}

            {/* Footer hint */}
            <div
              style={{
                borderTop: '1px solid var(--pf-v5-global--BorderColor--100)',
                padding: '6px 16px',
                display: 'flex',
                gap: 16,
                fontSize: 12,
                color: 'var(--pf-v5-global--Color--200)',
              }}
            >
              <span>↑↓ {t('navigate')}</span>
              <span>↵ {t('select')}</span>
              <span>Esc {t('close')}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
