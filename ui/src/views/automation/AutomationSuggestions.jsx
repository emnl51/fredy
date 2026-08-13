/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui-19';
import { useNavigate } from 'react-router-dom';
import Headline from '../../components/headline/Headline.jsx';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { decideAutomationSuggestion, getAutomationSuggestions } from '../../services/automationClient.js';
import { errorMessage } from '../../services/xhr.js';

import './AutomationSuggestions.less';

export default function AutomationSuggestions() {
  const t = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getAutomationSuggestions('pending'));
    } catch (error) {
      Toast.error(errorMessage(error, t('automation.loadError')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (row, decision) => {
    setBusy(`${decision}:${row.id}`);
    try {
      await decideAutomationSuggestion(row.id, decision);
      Toast.success(t(decision === 'accepted' ? 'automation.accepted' : 'automation.rejected'));
      await load();
    } catch (error) {
      Toast.error(errorMessage(error, t('automation.decisionError')));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="automationSuggestions__loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="automationSuggestions">
      <Headline text={t('automation.title')} subtitle={t('automation.subtitle')} />
      {rows.length === 0 ? (
        <Empty description={t('automation.empty')} />
      ) : (
        <div className="automationSuggestions__list">
          {rows.map((row) => (
            <Card key={row.id} className="automationSuggestions__card">
              <div className="automationSuggestions__header">
                <div>
                  <Typography.Title heading={4}>{row.title}</Typography.Title>
                  <Typography.Text type="tertiary">
                    {[row.provider, row.address].filter(Boolean).join(' · ')}
                  </Typography.Text>
                </div>
                <Tag color={row.confidence >= 95 ? 'green' : row.confidence >= 75 ? 'orange' : 'red'}>
                  {t('automation.confidence', { confidence: row.confidence })}
                </Tag>
              </div>
              <p>{row.reason}</p>
              <Space wrap>
                {row.payload?.status && <Tag>{t(`listings.status.${row.payload.status}`)}</Tag>}
                {row.payload?.appointment?.startsAt && (
                  <Tag>{new Date(row.payload.appointment.startsAt).toLocaleString()}</Tag>
                )}
                {(row.payload?.tasks ?? []).map((task) => (
                  <Tag key={task.type}>{task.title || task.type}</Tag>
                ))}
              </Space>
              <div className="automationSuggestions__actions">
                <Button onClick={() => navigate(`/listings/listing/${row.listingId}`)}>
                  {t('automation.openListing')}
                </Button>
                <Button loading={busy === `rejected:${row.id}`} onClick={() => decide(row, 'rejected')}>
                  {t('automation.reject')}
                </Button>
                <Button
                  theme="solid"
                  type="primary"
                  loading={busy === `accepted:${row.id}`}
                  onClick={() => decide(row, 'accepted')}
                >
                  {t('automation.accept')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

AutomationSuggestions.displayName = 'AutomationSuggestions';
