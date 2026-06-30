import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Gallery,
  GalleryItem,
  List,
  ListItem,
  PageSection,
  Title,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import {
  LoadingPage,
  PageHeader,
  PageLayout,
  Scrollable,
  useGetPageUrl,
} from '../../../../framework';
import { ActivityStreamIcon } from '../../common/ActivityStreamIcon';
import { AwxError } from '../../common/AwxError';
import { AwxRoute } from '../../main/AwxRoutes';
import { IAwxSettingsGroup, useAwxSettingsGroups } from './useAwxSettingsGroups';

const settingsGroupRoutes: Partial<Record<string, AwxRoute>> = {
  ui: AwxRoute.SettingsUi,
  system: AwxRoute.SettingsSystem,
  jobs: AwxRoute.SettingsJobs,
  logging: AwxRoute.SettingsLogging,
  debug: AwxRoute.SettingsTroubleshooting,
  policyascode: AwxRoute.SettingsPolicyAsCode,
  opa: AwxRoute.SettingsOpa,
  gatekeeper: AwxRoute.SettingsGatekeeper,
  'ai-assistant': AwxRoute.SettingsAiAssistant,
  eda: AwxRoute.SettingsEda,
  'galaxy-ng': AwxRoute.SettingsGalaxyNG,
  quay: AwxRoute.SettingsQuay,
};

const SettingsCardsSection = styled(PageSection)`
  min-width: 0;
`;

const SettingsCardsGallery = styled(Gallery)`
  width: 100%;

  .pf-v5-c-gallery__item {
    min-width: 0;
  }
`;

const SettingsGroupCard = styled(Card)`
  height: 100%;
  min-height: 170px;
  min-width: 0;
  overflow-wrap: anywhere;
`;

const SettingsGroupDescription = styled.p`
  opacity: 0.7;
  font-size: smaller;
  margin-top: 2px;
  overflow-wrap: anywhere;
`;

export function AwxSettings(props?: {
  filterGroups?: (group: IAwxSettingsGroup) => boolean;
  title?: string;
}) {
  const { t } = useTranslation();
  const { isLoading, error, groups } = useAwxSettingsGroups();
  if (error) return <AwxError error={error} />;
  if (isLoading || !groups) return <LoadingPage />;

  const displayGroups = props?.filterGroups ? groups.filter(props.filterGroups) : groups;

  return (
    <PageLayout>
      <PageHeader
        title={props?.title ?? t('Settings')}
        headerActions={<ActivityStreamIcon type={'setting'} />}
      />
      <Scrollable>
        <SettingsCardsSection data-cy="settings-cards-section">
          <SettingsCardsGallery
            hasGutter
            minWidths={{ default: '260px', md: '300px', xl: '320px' }}
            data-cy="settings-cards-gallery"
          >
            <GroupsCards groups={displayGroups} />
          </SettingsCardsGallery>
        </SettingsCardsSection>
      </Scrollable>
    </PageLayout>
  );
}

function GroupsCards(props: { groups: IAwxSettingsGroup[] }) {
  const getPageUrl = useGetPageUrl();
  return (
    <>
      {props.groups.map((group) => {
        const route = settingsGroupRoutes[group.id] ?? AwxRoute.SettingsCategory;
        const to =
          route === AwxRoute.SettingsCategory
            ? getPageUrl(route, { params: { category: group.categories[0].id } })
            : getPageUrl(route);
        return (
          <GalleryItem key={group.id}>
            <SettingsGroupCard isRounded isFlat data-cy={`settings-card-${group.id}`}>
              {group.name && (
                <CardHeader>
                  <CardTitle>
                    {group.categories.length === 1 ? (
                      <Title headingLevel="h3">
                        <Link to={to}>{group.name}</Link>
                      </Title>
                    ) : (
                      <Title headingLevel="h3">{group.name}</Title>
                    )}
                  </CardTitle>
                  {group.description && (
                    <SettingsGroupDescription>{group.description}</SettingsGroupDescription>
                  )}
                </CardHeader>
              )}
              {group.categories.length !== 1 && (
                <CardBody>
                  <List isPlain>
                    {group.categories.map((category) => (
                      <ListItem key={category.name}>
                        <Link
                          to={getPageUrl(AwxRoute.SettingsCategory, {
                            params: { category: category.id },
                          })}
                        >
                          {category.name}
                        </Link>
                      </ListItem>
                    ))}
                  </List>
                </CardBody>
              )}
            </SettingsGroupCard>
          </GalleryItem>
        );
      })}
    </>
  );
}
