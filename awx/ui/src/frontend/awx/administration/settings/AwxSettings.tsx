import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  List,
  ListItem,
  PageSection,
  Split,
  Title,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
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
        <PageSection isWidthLimited>
          <Split hasGutter style={{ flexWrap: 'wrap' }}>
            <GroupsCards groups={displayGroups} />
          </Split>
        </PageSection>
      </Scrollable>
    </PageLayout>
  );
}

function GroupsCards(props: { groups: IAwxSettingsGroup[] }) {
  const getPageUrl = useGetPageUrl();
  return (
    <>
      {props.groups.map((group) => (
        <Card isRounded isFlat key={group.id}>
          {group.name && (
            <CardHeader>
              <CardTitle>
                {group.categories.length === 1 ? (
                  <Title headingLevel="h3">
                    <Link
                      to={getPageUrl(AwxRoute.SettingsCategory, {
                        params: { category: group.categories[0].id },
                      })}
                    >
                      {group.name}
                    </Link>
                  </Title>
                ) : (
                  <Title headingLevel="h3">{group.name}</Title>
                )}
              </CardTitle>
              {group.description && (
                <p style={{ opacity: 0.7, fontSize: 'smaller', marginTop: 2 }}>
                  {group.description}
                </p>
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
        </Card>
      ))}
    </>
  );
}
