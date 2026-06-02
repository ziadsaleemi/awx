import { FormGroup, HelperText, HelperTextItem } from '@patternfly/react-core';
import { t } from 'i18next';
import { type ChangeEvent, useState } from 'react';
import { useController, useFormContext } from 'react-hook-form';
import styled from 'styled-components';

/**
 * A custom background image upload field for the CUSTOM_LOGIN_BACKGROUND setting.
 * Accepts PNG, JPEG, GIF, WebP, or SVG files (converted to base64) or an https:// URL.
 * Matches the visual design of AwxLogoUpload.
 */
export function AwxBgImageUpload(props: { name: string; label: string; helpText?: string }) {
  const { control } = useFormContext();
  const { field } = useController({ name: props.name, control });

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

  const currentValue: string = (field.value as string) ?? '';
  const hasImage = currentValue.length > 0;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      field.onChange(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleApplyUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        setUrlError(t('Please enter a valid https:// URL'));
        return;
      }
    } catch {
      setUrlError(t('Please enter a valid https:// URL'));
      return;
    }
    field.onChange(trimmed);
    setUrlInput('');
    setUrlError('');
  };

  const handleClear = () => {
    field.onChange('');
    setUrlInput('');
    setUrlError('');
  };

  return (
    <FormGroup label={props.label} labelInfo={props.helpText} fieldId={props.name}>
      <BgContainer>
        {hasImage && (
          <BgPreview>
            <img
              src={currentValue}
              alt={t('Login background preview')}
              style={{ maxHeight: 120, maxWidth: 400, objectFit: 'cover', borderRadius: 4 }}
            />
          </BgPreview>
        )}
        <FileInputRow>
          <input
            id={props.name}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            onChange={handleFileChange}
            style={{ flex: 1 }}
          />
          {hasImage && (
            <ClearButton type="button" onClick={handleClear}>
              {t('Remove background')}
            </ClearButton>
          )}
        </FileInputRow>
        <UrlRow>
          <UrlInput
            type="text"
            placeholder={t('Or paste https:// image URL…')}
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setUrlError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleApplyUrl();
            }}
            aria-label={t('Login background image URL')}
          />
          <ApplyBtn type="button" onClick={handleApplyUrl} disabled={!urlInput.trim()}>
            {t('Apply URL')}
          </ApplyBtn>
        </UrlRow>
        {urlError && (
          <HelperText>
            <HelperTextItem variant="error">{urlError}</HelperTextItem>
          </HelperText>
        )}
      </BgContainer>
      {props.helpText && (
        <HelperText>
          <HelperTextItem>{props.helpText}</HelperTextItem>
        </HelperText>
      )}
    </FormGroup>
  );
}

const BgContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const BgPreview = styled.div`
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

const UrlRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const UrlInput = styled.input`
  flex: 1;
  font-size: var(--pf-v5-global--FontSize--sm);
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  background: var(--pf-v5-global--BackgroundColor--100);
  color: var(--pf-v5-global--Color--100);
  min-width: 0;
`;

const ApplyBtn = styled.button`
  font-size: var(--pf-v5-global--FontSize--sm);
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid var(--pf-v5-global--active-color--100);
  background: var(--pf-v5-global--active-color--100);
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    opacity: 0.85;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
