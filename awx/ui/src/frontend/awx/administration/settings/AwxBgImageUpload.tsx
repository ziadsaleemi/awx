import { Button, FileUpload, InputGroup, InputGroupItem, TextInput } from '@patternfly/react-core';
import { t } from 'i18next';
import { useState } from 'react';
import { useController, useFormContext } from 'react-hook-form';
import styled from 'styled-components';
import { PageFormGroup } from '../../../../framework/PageForm/Inputs/PageFormGroup';

export function AwxBgImageUpload(props: { name: string; label: string; helpText?: string }) {
  const { control } = useFormContext();
  const { field } = useController({ name: props.name, control });
  const [filename, setFilename] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

  const currentValue = typeof field.value === 'string' ? field.value : '';
  const hasImage = currentValue.length > 0;

  const handleApplyUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        setUrlError(t('Enter a valid http:// or https:// image URL.'));
        return;
      }
    } catch {
      setUrlError(t('Enter a valid http:// or https:// image URL.'));
      return;
    }
    field.onChange(trimmed);
    setUrlInput('');
    setUrlError('');
  };

  const handleClear = () => {
    field.onChange('');
    setFilename('');
    setUrlInput('');
    setUrlError('');
  };

  return (
    <PageFormGroup
      fieldId={props.name}
      label={props.label}
      labelHelpTitle={props.label}
      labelHelp={props.helpText}
      helperTextInvalid={urlError || false}
      helperText={t(
        'Upload an image or provide a URL. The image fills the login screen behind the sign-in panel.'
      )}
    >
      <BackgroundField>
        {hasImage && (
          <BackgroundPreview aria-label={t('Login background preview')}>
            <img src={currentValue} alt={t('Login background preview')} />
          </BackgroundPreview>
        )}
        <FileUpload
          id={props.name}
          data-cy={props.name}
          type="dataURL"
          value={currentValue}
          filename={isLoading ? t('Loading...') : filename}
          filenamePlaceholder={t('Select a background image')}
          hideDefaultPreview
          onFileInputChange={(_event, file) => setFilename(file.name)}
          onDataChange={(_event, value) => field.onChange(value)}
          onReadStarted={() => setIsLoading(true)}
          onReadFinished={() => setIsLoading(false)}
          onClearClick={handleClear}
        />
        <InputGroup>
          <InputGroupItem isFill>
            <TextInput
              id={`${props.name}-url`}
              aria-label={t('Login background image URL')}
              placeholder={t('https://example.com/background.jpg')}
              value={urlInput}
              onChange={(_event, value) => {
                setUrlInput(value);
                setUrlError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleApplyUrl();
                }
              }}
            />
          </InputGroupItem>
          <InputGroupItem>
            <Button
              variant="secondary"
              onClick={handleApplyUrl}
              isDisabled={!urlInput.trim()}
              data-cy="apply-login-background-url"
            >
              {t('Use URL')}
            </Button>
          </InputGroupItem>
        </InputGroup>
      </BackgroundField>
    </PageFormGroup>
  );
}

const BackgroundField = styled.div`
  display: flex;
  max-width: 720px;
  flex-direction: column;
  gap: var(--pf-v5-global--spacer--md);
`;

const BackgroundPreview = styled.div`
  aspect-ratio: 16 / 5;
  max-height: 220px;
  overflow: hidden;
  border: 1px solid var(--pf-v5-global--BorderColor--100);
  background: var(--pf-v5-global--BackgroundColor--200);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;
