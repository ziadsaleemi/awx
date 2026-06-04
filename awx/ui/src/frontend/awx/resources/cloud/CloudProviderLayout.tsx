import { Grid, PageSection } from '@patternfly/react-core';
import styled from 'styled-components';

export const CloudProviderOverviewSection = styled(PageSection)`
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 1.5rem;

  @media (max-width: 480px) {
    padding: 1rem;
  }
`;

export const CloudProviderOverviewGrid = styled(Grid)`
  width: 100%;
  min-width: 0;
  margin: 0;
`;
