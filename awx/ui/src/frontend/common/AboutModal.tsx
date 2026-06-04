import { AboutModal, TextContent, TextList, TextListItem } from '@patternfly/react-core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageDialog } from '../../framework';

export interface AnsibleAboutModalProps {
  brandImageSrc: string;
  onClose?: () => void;
}

export const ABOUT_MODAL_VERSION = '25.1.1';

function AnsibleAboutModal(props: AnsibleAboutModalProps) {
  const [_dialog, setDialog] = usePageDialog();
  const { t } = useTranslation();
  return (
    <AboutModal
      isOpen
      onClose={() => {
        setDialog(undefined);
        props.onClose?.();
      }}
      trademark={t(`Copyright {{fullYear}} Red Hat, Inc.`, { fullYear: new Date().getFullYear() })}
      brandImageSrc={props.brandImageSrc}
      brandImageAlt={t('Brand Logo')}
      productName={process.env.PRODUCT ?? t('AWX')}
    >
      <TextContent>
        <TextList component="dl">
          <TextListItem component="dt">{t('Version')}</TextListItem>
          <TextListItem component="dd">{ABOUT_MODAL_VERSION}</TextListItem>
          <TextListItem component="dt">{t('Enhanced by')}</TextListItem>
          <TextListItem component="dd">
            <a href="https://ziadsaleemi.com" target="_blank" rel="noopener noreferrer">
              {t('Ziad Saleemi')}
            </a>
          </TextListItem>
        </TextList>
      </TextContent>
    </AboutModal>
  );
}

export function useAnsibleAboutModal() {
  const [_, setDialog] = usePageDialog();
  const [props, setProps] = useState<AnsibleAboutModalProps>();
  useEffect(() => {
    if (props) {
      const onCloseHandler = () => {
        setProps(undefined);
        props.onClose?.();
      };
      setDialog(<AnsibleAboutModal {...props} onClose={onCloseHandler} />);
    } else {
      setDialog(undefined);
    }
  }, [props, setDialog]);
  return setProps;
}
