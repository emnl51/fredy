/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useMemo, useState } from 'react';
import { Banner, Empty, Spin, Tag, Typography } from '@douyinfe/semi-ui-19';
import { IconCalendarClock } from '@douyinfe/semi-icons';

import { useLocale, useTranslation } from '../../../services/i18n/i18n.jsx';
import { getApplicationContext } from '../../../services/applicationClient.js';
import './ApplicationHistory.less';

const { Text, Title } = Typography;

export default function ApplicationHistory({ listingId }) {
  const t = useTranslation();
  const locale = useLocale();
  const [context, setContext] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getApplicationContext(listingId)
      .then((value) => active && setContext(value))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [listingId]);

  const formatDate = useMemo(
    () => (value) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value),
    [locale],
  );
  const items = context
    ? [
        ...context.events.map((event) => ({
          id: `event-${event.id}`,
          at: event.createdAt,
          label: t(`applicationHistory.event.${event.eventType}`),
          source: event.source,
          reason: event.reason,
        })),
        ...context.tasks.map((task) => ({
          id: `task-${task.id}`,
          at: task.createdAt,
          label: t('applicationHistory.task', { title: task.title || task.type }),
          source: task.source,
        })),
      ].sort((a, b) => b.at - a.at)
    : [];

  return (
    <section className="relatedMail" aria-labelledby="application-history-title">
      <div className="relatedMail__title">
        <IconCalendarClock />
        <Title heading={4} id="application-history-title">
          {t('applicationHistory.title')}
        </Title>
        {context && <Tag>{items.length}</Tag>}
      </div>
      {!context && !failed ? (
        <div className="relatedMail__loading">
          <Spin />
        </div>
      ) : failed ? (
        <Banner type="danger" closeIcon={null} description={t('applicationHistory.loadError')} />
      ) : items.length === 0 ? (
        <Empty description={t('applicationHistory.empty')} />
      ) : (
        <div className="relatedMail__list">
          {items.map((item) => (
            <article className="relatedMail__item" key={item.id}>
              <div className="relatedMail__header">
                <div className="relatedMail__identity">
                  <Text strong>{item.label}</Text>
                  <Text type="tertiary" size="small">
                    {formatDate(item.at)}
                    {item.reason ? ` · ${item.reason}` : ''}
                  </Text>
                </div>
                <Tag>{item.source}</Tag>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

ApplicationHistory.displayName = 'ApplicationHistory';
