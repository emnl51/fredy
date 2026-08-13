/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Input, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui-19';
import { IconCalendarClock, IconExternalOpen, IconMailStroked, IconRefresh } from '@douyinfe/semi-icons';
import { useNavigate } from 'react-router-dom';

import Headline from '../../components/headline/Headline.jsx';
import { useLocale, useTranslation } from '../../services/i18n/i18n.jsx';
import { errorMessage } from '../../services/xhr.js';
import { getInvitations, updateInvitationAppointment, updateMailListingStatus } from '../../services/mailClient.js';

import './InvitationTracking.less';

function toLocalInput(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export default function InvitationTracking() {
  const t = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [view, setView] = useState('upcoming');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getInvitations();
      const rows = Array.isArray(result) ? result : [];
      setInvitations(rows);
      setDrafts(Object.fromEntries(rows.map((item) => [item.id, toLocalInput(item.appointmentAt)])));
    } catch (error) {
      Toast.error(errorMessage(error, t('invitations.loadError')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const formatDate = useMemo(
    () => (value) =>
      value ? new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(value) : '',
    [locale],
  );

  const saveAppointment = async (listingId) => {
    setBusy(`save:${listingId}`);
    try {
      await updateInvitationAppointment(listingId, fromLocalInput(drafts[listingId]));
      Toast.success(t('invitations.saved'));
      await load();
    } catch (error) {
      Toast.error(errorMessage(error, t('invitations.saveError')));
    } finally {
      setBusy(null);
    }
  };

  const markVisited = async (listingId) => {
    setBusy(`visited:${listingId}`);
    try {
      await updateMailListingStatus(listingId, 'visited');
      Toast.success(t('invitations.markedVisited'));
      await load();
    } catch (error) {
      Toast.error(errorMessage(error, t('invitations.saveError')));
    } finally {
      setBusy(null);
    }
  };

  const restoreInvitation = async (listingId) => {
    setBusy(`restore:${listingId}`);
    try {
      await updateMailListingStatus(listingId, 'invited');
      Toast.success(t('invitations.restored'));
      await load();
    } catch (error) {
      Toast.error(errorMessage(error, t('invitations.saveError')));
    } finally {
      setBusy(null);
    }
  };

  const visibleInvitations = invitations.filter((invitation) =>
    view === 'all' ? true : view === 'visited' ? invitation.status?.status === 'visited' : invitation.status?.status === 'invited',
  );

  if (loading) {
    return (
      <div className="invitationTracking__loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="invitationTracking">
      <Headline
        text={t('invitations.title')}
        subtitle={t('invitations.subtitle')}
        actions={
          <Button icon={<IconRefresh />} onClick={load}>
            {t('invitations.refresh')}
          </Button>
        }
      />

      <div className="invitationTracking__filters">
        <Button
          theme={view === 'upcoming' ? 'solid' : 'light'}
          type={view === 'upcoming' ? 'primary' : 'tertiary'}
          onClick={() => setView('upcoming')}
        >
          {t('invitations.upcoming')} ({invitations.filter((item) => item.status?.status === 'invited').length})
        </Button>
        <Button
          theme={view === 'visited' ? 'solid' : 'light'}
          type={view === 'visited' ? 'primary' : 'tertiary'}
          onClick={() => setView('visited')}
        >
          {t('invitations.visited')} ({invitations.filter((item) => item.status?.status === 'visited').length})
        </Button>
        <Button
          theme={view === 'all' ? 'solid' : 'light'}
          type={view === 'all' ? 'primary' : 'tertiary'}
          onClick={() => setView('all')}
        >
          {t('invitations.all')} ({invitations.length})
        </Button>
      </div>

      {visibleInvitations.length === 0 ? (
        <Empty description={view === 'visited' ? t('invitations.emptyVisited') : t('invitations.empty')} />
      ) : (
        <div className="invitationTracking__list">
          {visibleInvitations.map((invitation) => (
            <Card key={invitation.id} className="invitationTracking__card" bodyStyle={{ padding: 0 }}>
              <div className="invitationTracking__listing">
                {invitation.imageUrl && <img src={invitation.imageUrl} alt="" loading="lazy" />}
                <div className="invitationTracking__listingBody">
                  <div className="invitationTracking__heading">
                    <div>
                      <Tag color={invitation.appointmentAt && invitation.appointmentAt < Date.now() ? 'grey' : 'blue'}>
                        <IconCalendarClock />{' '}
                        {invitation.appointmentAt ? formatDate(invitation.appointmentAt) : t('invitations.dateMissing')}
                      </Tag>
                      {invitation.status?.status === 'visited' && (
                        <Tag color="green">{t('invitations.visitedBadge')}</Tag>
                      )}
                      <Typography.Title heading={4}>{invitation.title || t('mail.untitledListing')}</Typography.Title>
                      <Typography.Text type="tertiary">
                        {[invitation.provider, invitation.address].filter(Boolean).join(' · ')}
                      </Typography.Text>
                    </div>
                    <Space wrap>
                      <Button onClick={() => navigate(`/listings/listing/${invitation.id}`)}>
                        {t('invitations.openInFredy')}
                      </Button>
                      {invitation.link && (
                        <Button icon={<IconExternalOpen />} onClick={() => window.open(invitation.link, '_blank', 'noopener')}>
                          {t('invitations.openOriginal')}
                        </Button>
                      )}
                    </Space>
                  </div>

                  {invitation.status?.status === 'invited' ? (
                    <div className="invitationTracking__appointment">
                      <label htmlFor={`appointment-${invitation.id}`}>{t('invitations.appointment')}</label>
                      <Input
                        id={`appointment-${invitation.id}`}
                        type="datetime-local"
                        value={drafts[invitation.id] ?? ''}
                        onChange={(value) => setDrafts((current) => ({ ...current, [invitation.id]: value }))}
                      />
                      <Button
                        theme="solid"
                        type="primary"
                        loading={busy === `save:${invitation.id}`}
                        onClick={() => saveAppointment(invitation.id)}
                      >
                        {t('invitations.save')}
                      </Button>
                      <Button loading={busy === `visited:${invitation.id}`} onClick={() => markVisited(invitation.id)}>
                        {t('invitations.markVisited')}
                      </Button>
                    </div>
                  ) : (
                    <div className="invitationTracking__archiveActions">
                      <Button
                        loading={busy === `restore:${invitation.id}`}
                        onClick={() => restoreInvitation(invitation.id)}
                      >
                        {t('invitations.restore')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="invitationTracking__mails">
                <Typography.Title heading={5}>
                  <IconMailStroked /> {t('invitations.relatedMail', { count: invitation.messages.length })}
                </Typography.Title>
                {invitation.messages.length === 0 ? (
                  <Typography.Text type="tertiary">{t('invitations.noMail')}</Typography.Text>
                ) : (
                  invitation.messages.map((message) => (
                    <details key={message.id} className="invitationTracking__mail">
                      <summary>
                        <span>{message.subject || t('mail.noSubject')}</span>
                        <small>{message.receivedAt ? formatDate(message.receivedAt) : ''}</small>
                      </summary>
                      <Typography.Text type="tertiary">
                        {[message.senderName, message.senderAddress].filter(Boolean).join(' · ')}
                      </Typography.Text>
                      {message.textBody && <pre>{message.textBody}</pre>}
                    </details>
                  ))
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
