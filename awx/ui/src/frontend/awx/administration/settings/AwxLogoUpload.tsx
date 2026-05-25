import { FormGroup, HelperText, HelperTextItem } from '@patternfly/react-core';
import { t } from 'i18next';
import { type ChangeEvent } from 'react';
import { useController, useFormContext } from 'react-hook-form';
import styled from 'styled-components';

/**
 * A custom logo upload field for the CUSTOM_LOGO setting.
 * Accepts PNG, JPEG, or GIF files and converts them to a base64
 * data URL, which is the format expected by the AWX API.
 */
export function AwxLogoUpload(props: {
  name: string;
  label: string;
  helpText?: string;
}) {
  const { control } = useFormContext();
  const { field } = useController({ name: props.name, control });

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      field.onChange(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleClear = () => {
    field.onChange('');
  };

  const currentValue: string = field.value as string;
  const hasImage = currentValue && currentValue.startsWith('data:image/');

  return (
    <FormGroup
      label={props.label}
      labelInfo={props.helpText}
      fieldId={props.name}
    >
      <LogoContainer>
        {hasImage && (
          <LogoPreview>
            <img
              src={currentValue}
              alt={t('Custom logo preview')}
              style={{ maxHeight: 80, maxWidth: 300, objectFit: 'contain' }}
            />
          </LogoPreview>
        )}
        <FileInputRow>
          <input
            id={props.name}
            type="file"
            accept="image/png,image/jpeg,image/gif"
            onChange={handleFileChange}
            style={{ flex: 1 }}
          />
          {hasImage && (
            <ClearButton type="button" onClick={handleClear}>
              {t('Remove logo')}
            </ClearButton>
          )}
        </FileInputRow>
      </LogoContainer>
      {props.helpText && (
        <HelperText>
          <HelperTextItem>{props.helpText}</HelperTextItem>
        </HelperText>
      )}
    </FormGroup>
  );
}

const LogoContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const LogoPreview = styled.div`
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  border-radius: 4px;
  padding: 8px;
  background: var(--pf-v5-global--BackgroundColor--200, #f5f5f5);
  display: inline-flex;
`;

const FileInputRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const ClearButton = styled.button`
  background: none;
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--pf-v5-global--danger-color--100);
  white-space: nowrap;
  &:hover {
    background: var(--pf-v5-global--BackgroundColor--200, #f5f5f5);
  }
`;
