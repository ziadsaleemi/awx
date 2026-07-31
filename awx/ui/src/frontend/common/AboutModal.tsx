import { AboutModal, TextContent, TextList, TextListItem } from '@patternfly/react-core';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageDialog } from '../../framework';
import { requestGet } from './crud/Data';

export interface AnsibleAboutModuleVersionEndpoint {
  label: string;
  url: string;
}

export interface AnsibleAboutModalProps {
  brandImageSrc: string;
  productName?: string;
  moduleVersionEndpoints?: AnsibleAboutModuleVersionEndpoint[];
  onClose?: () => void;
}

export const ABOUT_MODAL_VERSION = '25.1.12';

interface AnsibleAboutModuleVersion {
  label: string;
  version: string;
}

type ModuleVersionPayload = Record<string, unknown>;

function getNestedString(value: unknown, key: string) {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const record = value as Record<string, unknown>;
  const result = record[key];
  return typeof result === 'string' || typeof result === 'number' ? result.toString().trim() : '';
}

function getNestedObject(value: unknown, key: string) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const result = (value as Record<string, unknown>)[key];
  return result && typeof result === 'object' ? result : undefined;
}

function isConnectedModule(payload: ModuleVersionPayload) {
  const status = typeof payload.status === 'string' ? payload.status : '';
  if (['disabled', 'invalid', 'not_configured'].includes(status)) {
    return false;
  }
  if (payload.enabled === false || payload.configured === false) {
    return false;
  }
  return Boolean(
    payload.enabled ||
      payload.configured ||
      payload.server_url ||
      payload.controller_url ||
      payload.cluster
  );
}

function moduleVersion(payload: ModuleVersionPayload) {
  const version = getNestedString(payload, 'version');
  if (version) {
    return version;
  }
  const componentVersions = payload.component_versions;
  const componentVersion =
    getNestedString(componentVersions, 'galaxy_ng') ||
    getNestedString(componentVersions, 'galaxy-ng') ||
    getNestedString(componentVersions, 'pulp_ansible') ||
    getNestedString(componentVersions, 'pulpcore');
  if (componentVersion) {
    return componentVersion;
  }
  const versionDetail = payload.version_detail;
  const info = getNestedObject(versionDetail, 'info');
  return (
    getNestedString(versionDetail, 'Version') ||
    getNestedString(versionDetail, 'version') ||
    getNestedString(versionDetail, 'quay_version') ||
    getNestedString(versionDetail, 'registry_version') ||
    getNestedString(info, 'version')
  );
}

function AnsibleAboutModal(props: AnsibleAboutModalProps) {
  const [_dialog, setDialog] = usePageDialog();
  const { t } = useTranslation();
  const [moduleVersions, setModuleVersions] = useState<AnsibleAboutModuleVersion[]>([]);

  useEffect(() => {
    if (!props.moduleVersionEndpoints?.length) {
      setModuleVersions([]);
      return;
    }

    const controller = new AbortController();
    void Promise.allSettled(
      props.moduleVersionEndpoints.map(async (endpoint) => {
        const payload = await requestGet<ModuleVersionPayload>(endpoint.url, controller.signal);
        if (!isConnectedModule(payload)) {
          return undefined;
        }
        return {
          label: endpoint.label,
          version:
            moduleVersion(payload) ||
            (payload.controller_error
              ? t('Connection unavailable')
              : t('Connected, version not exposed')),
        };
      })
    ).then((results) => {
      if (controller.signal.aborted) {
        return;
      }
      setModuleVersions(
        results.map((result, index) => {
          const endpoint = props.moduleVersionEndpoints?.[index];
          if (result.status === 'fulfilled' && result.value) {
            return result.value;
          }
          return {
            label: endpoint?.label ?? t('Unknown module'),
            version: t('Unavailable or disabled'),
          };
        })
      );
    });

    return () => controller.abort();
  }, [props.moduleVersionEndpoints, t]);

  return (
    <AboutModal
      isOpen
      onClose={() => {
        setDialog(undefined);
        props.onClose?.();
      }}
      trademark=""
      brandImageSrc={props.brandImageSrc}
      brandImageAlt={t('Brand Logo')}
      productName={props.productName ?? process.env.PRODUCT ?? t('Capstan')}
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
          {moduleVersions.length > 0 && (
            <>
              <TextListItem component="dt">{t('Module versions')}</TextListItem>
              <TextListItem component="dd">
                <TextList component="dl">
                  {moduleVersions.map((moduleVersion) => (
                    <Fragment key={moduleVersion.label}>
                      <TextListItem component="dt">{moduleVersion.label}</TextListItem>
                      <TextListItem component="dd">{moduleVersion.version}</TextListItem>
                    </Fragment>
                  ))}
                </TextList>
              </TextListItem>
            </>
          )}
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
