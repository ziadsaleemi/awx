import { FileUpload, ToggleGroup, ToggleGroupItem } from '@patternfly/react-core';
import { t } from 'i18next';
import { useState } from 'react';
import { useController, useFormContext } from 'react-hook-form';
import styled from 'styled-components';
import { PageFormGroup } from '../../../../framework/PageForm/Inputs/PageFormGroup';

const LOGO_SIZES = [
  { label: t('Small'), height: 36 },
  { label: t('Medium'), height: 48 },
  { label: t('Large'), height: 64 },
] as const;

function normalizeLogoHeight(value: unknown) {
  const height = Number(value);
  return LOGO_SIZES.some((size) => size.height === height) ? height : 48;
}

export function AwxLogoUpload(props: {
  name: string;
  sizeName: string;
  label: string;
  helpText?: string;
}) {
  const { control } = useFormContext();
  const { field } = useController({ name: props.name, control });
  const { field: sizeField } = useController({ name: props.sizeName, control });
  const [filename, setFilename] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const currentValue = typeof field.value === 'string' ? field.value : '';
  const hasImage = currentValue.startsWith('data:image/');
  const logoHeight = normalizeLogoHeight(sizeField.value);

  const handleClear = () => {
    field.onChange('');
    setFilename('');
  };

  return (
    <>
      <PageFormGroup
        fieldId={props.name}
        label={props.label}
        labelHelpTitle={props.label}
        labelHelp={props.helpText}
        helperText={t('Upload a transparent PNG, JPEG, or GIF image for the application header.')}
      >
        <BrandingField>
          {hasImage && (
            <MastheadPreview aria-label={t('Custom logo preview')}>
              <img
                src={currentValue}
                alt={t('Custom logo preview')}
                style={{ height: logoHeight }}
              />
            </MastheadPreview>
          )}
          <FileUpload
            id={props.name}
            data-cy={props.name}
            type="dataURL"
            value={currentValue}
            filename={isLoading ? t('Loading...') : filename}
            filenamePlaceholder={t('Select a logo image')}
            hideDefaultPreview
            onFileInputChange={(_event, file) => setFilename(file.name)}
            onDataChange={(_event, value) => field.onChange(value)}
            onReadStarted={() => setIsLoading(true)}
            onReadFinished={() => setIsLoading(false)}
            onClearClick={handleClear}
          />
        </BrandingField>
      </PageFormGroup>
      <PageFormGroup
        fieldId={props.sizeName}
        label={t('Header logo size')}
        labelHelpTitle={t('Header logo size')}
        labelHelp={t('Controls the logo height in the application masthead on every page.')}
        helperText={t('The selected size is saved with the other user interface settings.')}
      >
        <ToggleGroup isCompact aria-label={t('Header logo size')}>
          {LOGO_SIZES.map((size) => (
            <ToggleGroupItem
              key={size.height}
              text={`${size.label} (${size.height}px)`}
              aria-label={t('{{label}} header logo', { label: size.label })}
              data-cy={`header-logo-size-${size.height}`}
              isSelected={logoHeight === size.height}
              onClick={() => sizeField.onChange(size.height)}
            />
          ))}
        </ToggleGroup>
      </PageFormGroup>
    </>
  );
}

const BrandingField = styled.div`
  display: flex;
  max-width: 720px;
  flex-direction: column;
  gap: var(--pf-v5-global--spacer--md);
`;

const MastheadPreview = styled.div`
  display: flex;
  min-height: 96px;
  align-items: center;
  padding: var(--pf-v5-global--spacer--md);
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  background: var(--pf-v5-global--BackgroundColor--dark-100);

  img {
    max-width: min(240px, 100%);
    object-fit: contain;
  }
`;
