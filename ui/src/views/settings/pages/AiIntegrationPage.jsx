/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import { Banner, Button, Input, Popconfirm, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui-19';
import { IconDelete } from '@douyinfe/semi-icons';

import { SegmentPart } from '../../../components/segment/SegmentPart.jsx';
import { useLocale, useTranslation } from '../../../services/i18n/i18n.jsx';
import { errorMessage } from '../../../services/xhr.js';
import {
  createMcpToken,
  deleteLegacyMailData,
  getLegacyMailSummary,
  getMcpTokens,
  revokeMcpToken,
} from '../../../services/mcpTokenClient.js';

const RECOMMENDED_SCOPES = ['jobs:read', 'listings:read', 'applications:read', 'applications:propose'];
const { Paragraph, Text, Title } = Typography;

export default function AiIntegrationPage() {
  const t = useTranslation();
  const locale = useLocale();
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('Inbox AI agent');
  const [issuedToken, setIssuedToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [legacyMail, setLegacyMail] = useState(null);

  const load = () =>
    getMcpTokens()
      .then(setTokens)
      .catch((error) => Toast.error(errorMessage(error, t('aiIntegration.loadError'))));

  useEffect(() => {
    load();
    getLegacyMailSummary()
      .then(setLegacyMail)
      .catch(() => {});
  }, []);

  const issue = async () => {
    setBusy(true);
    try {
      const token = await createMcpToken({ name, scopes: RECOMMENDED_SCOPES });
      setIssuedToken(token.token);
      await load();
    } catch (error) {
      Toast.error(errorMessage(error, t('aiIntegration.createError')));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (tokenId) => {
    try {
      await revokeMcpToken(tokenId);
      await load();
      Toast.success(t('aiIntegration.revoked'));
    } catch (error) {
      Toast.error(errorMessage(error, t('aiIntegration.revokeError')));
    }
  };

  return (
    <div className="settingsShell__page">
      <Banner type="warning" description={t('aiIntegration.privacy')} style={{ marginBottom: 16 }} />
      <SegmentPart name={t('aiIntegration.title')} helpText={t('aiIntegration.help')}>
        <Paragraph>{t('aiIntegration.flow')}</Paragraph>
        <Text code>https://YOUR-FREDY/api/mcp</Text>
        <Paragraph type="secondary" style={{ marginTop: 8 }}>
          {t('aiIntegration.triggerNote')}
        </Paragraph>
      </SegmentPart>
      <SegmentPart name={t('aiIntegration.tokens')} helpText={t('aiIntegration.tokensHelp')}>
        <Space vertical align="start" style={{ width: '100%' }}>
          <Input value={name} onChange={setName} style={{ maxWidth: 420 }} />
          <Space wrap>
            {RECOMMENDED_SCOPES.map((scope) => (
              <Tag key={scope}>{scope}</Tag>
            ))}
          </Space>
          <Button theme="solid" type="primary" loading={busy} onClick={issue}>
            {t('aiIntegration.create')}
          </Button>
        </Space>
        {issuedToken && (
          <Banner
            type="success"
            style={{ marginTop: 16 }}
            title={t('aiIntegration.tokenOnce')}
            description={<Text copyable={{ content: issuedToken }}>{issuedToken}</Text>}
          />
        )}
      </SegmentPart>
      <SegmentPart name={t('aiIntegration.activeTokens')}>
        {tokens.length === 0 ? (
          <Text type="secondary">{t('aiIntegration.empty')}</Text>
        ) : (
          <Space vertical align="start" style={{ width: '100%' }}>
            {tokens.map((token) => (
              <div
                key={token.id}
                style={{ width: '100%', borderBottom: '1px solid var(--semi-color-border)', padding: 8 }}
              >
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <div>
                    <Title heading={6}>{token.name}</Title>
                    <Text type="tertiary">
                      {token.tokenPrefix}… · {new Intl.DateTimeFormat(locale).format(token.createdAt)}
                    </Text>
                    <div>
                      {token.scopes.map((scope) => (
                        <Tag key={scope}>{scope}</Tag>
                      ))}
                    </div>
                  </div>
                  {token.revokedAt == null ? (
                    <Popconfirm title={t('aiIntegration.revokeConfirm')} onConfirm={() => revoke(token.id)}>
                      <Button type="danger" icon={<IconDelete />} aria-label={t('aiIntegration.revoke')} />
                    </Popconfirm>
                  ) : (
                    <Tag color="red">{t('aiIntegration.revokedLabel')}</Tag>
                  )}
                </Space>
              </div>
            ))}
          </Space>
        )}
      </SegmentPart>
      {legacyMail?.retained && (
        <SegmentPart name={t('aiIntegration.legacyMailTitle')} helpText={t('aiIntegration.legacyMailHelp')}>
          <Paragraph>
            {t('aiIntegration.legacyMailSummary', {
              username: legacyMail.account.username,
              count: legacyMail.messageCount,
              matches: legacyMail.matchCount,
            })}
          </Paragraph>
          <Popconfirm
            title={t('aiIntegration.legacyMailDeleteConfirm')}
            onConfirm={async () => {
              try {
                await deleteLegacyMailData();
                setLegacyMail({ retained: false });
                Toast.success(t('aiIntegration.legacyMailDeleted'));
              } catch (error) {
                Toast.error(errorMessage(error, t('aiIntegration.legacyMailDeleteError')));
              }
            }}
          >
            <Button type="danger">{t('aiIntegration.legacyMailDelete')}</Button>
          </Popconfirm>
        </SegmentPart>
      )}
    </div>
  );
}

AiIntegrationPage.displayName = 'AiIntegrationPage';
