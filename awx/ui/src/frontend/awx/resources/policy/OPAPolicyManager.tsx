import { OPAPolicyManagementPanel } from '../../administration/settings/OPAPolicyManagementPanel';

export type OPAPolicyManagerView = 'tester';

export function OPAPolicyManager(props: { view: OPAPolicyManagerView; canManagePolicy?: boolean }) {
  return <OPAPolicyManagementPanel sections={['tester']} canManagePolicy={props.canManagePolicy} />;
}
