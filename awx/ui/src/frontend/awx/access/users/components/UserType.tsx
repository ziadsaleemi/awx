import { Text, Label } from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';

export function UserType<
  T extends {
    is_superuser?: boolean | null;
    is_system_auditor?: boolean | null;
    custom_user_type?: number | null;
    summary_fields?: {
      custom_user_type?: {
        name: string;
      };
    };
  },
>(props: { user: T }) {
  const { user } = props;
  const { t } = useTranslation();
  if (user.is_superuser) {
    return <Label>{t('System administrator')}</Label>;
  }
  if (user.is_system_auditor) {
    return <Label>{t('System auditor')}</Label>;
  }
  if (user.custom_user_type && user.summary_fields?.custom_user_type?.name) {
    return <Label color="blue">{user.summary_fields.custom_user_type.name}</Label>;
  }
  return <Text>{t('Normal user')}</Text>;
}
