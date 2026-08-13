/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Input, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui-19';
import { IconCalendarClock, IconExternalOpen, IconRefresh } from '@douyinfe/semi-icons';
import { useNavigate } from 'react-router-dom';

import Headline from '../../components/headline/Headline.jsx';
import { useLocale, useTranslation } from '../../services/i18n/i18n.jsx';
import { errorMessage } from '../../services/xhr.js';
import {
  getAppointments,
  saveAppointment as saveApplicationAppointment,
  setAppointmentState,
  updateApplicationStatus,
} from '../../services/applicationClient.js';

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
      const result = await getAppointments(true);
      const rows = Array.isArray(result) ? result : [];
      setInvitations(rows);
      setDrafts(Object.fromEntries(rows.map((item) => [item.id, toLocalInput(item.startsAt)])));
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

  const saveAppointment = async (invitation) => {
    setBusy(`save:${invitation.id}`);
    try {
      await saveApplicationAppointment({
        listingId: invitation.listingId,
        startsAt: fromLocalInput(drafts[invitation.id]),
        timezone: invitation.timezone || 'Europe/Berlin',
        location: invitation.location || invitation.address || null,
      });
      Toast.success(t('invitations.saved'));
      await load();
    } catch (error) {
      Toast.error(errorMessage(error, t('invitations.saveError')));
    } finally {
      setBusy(null);
    }
  };

  const markVisited = async (invitation) => {
    setBusy(`visited:${invitation.id}`);
    try {
      await setAppointmentState(invitation.id, 'completed');
      await updateApplicationStatus(invitation.listingId, 'visited');
      Toast.success(t('invitations.markedVisited'));
      await load();
    } catch (error) {
      Toast.error(errorMessage(error, t('invitations.saveError')));
    } finally {
      setBusy(null);
    }
  };

  const restoreInvitation = async (invitation) => {
    setBusy(`restore:${invitation.id}`);
    try {
      await setAppointmentState(invitation.id, 'scheduled');
      await updateApplicationStatus(invitation.listingId, 'invited');
      Toast.success(t('invitations.restored'));
      await load();
    } catch (error) {
      Toast.error(errorMessage(error, t('invitations.saveError')));
    } finally {
      setBusy(null);
    }
  };

  const now = Date.now();
  // A replacement appointment is inserted as `scheduled`; the superseded row is kept as
  // `rescheduled` for the archive and must not appear as a second upcoming appointment.
  const isUpcoming = (invitation) => invitation.appointmentState === 'scheduled';
  const isOverdue = (invitation) => isUpcoming(invitation) && invitation.startsAt < now;
  const visibleInvitations = invitations.filter((invitation) => {
    if (view === 'all') return true;
    if (view === 'visited') return invitation.appointmentState === 'completed';
    if (view === 'overdue') return isOverdue(invitation);
    return isUpcoming(invitation) && !isOverdue(invitation);
  });

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
          theme={view === 'overdue' ? 'solid' : 'light'}
          type={view === 'overdue' ? 'danger' : 'tertiary'}
          onClick={() => setView('overdue')}
        >
          {t('invitations.overdue')} ({invitations.filter(isOverdue).length})
        </Button>
        <Button
          theme={view === 'upcoming' ? 'solid' : 'light'}
          type={view === 'upcoming' ? 'primary' : 'tertiary'}
          onClick={() => setView('upcoming')}
        >
          {t('invitations.upcoming')} ({invitations.filter((item) => isUpcoming(item) && !isOverdue(item)).length})
        </Button>
        <Button
          theme={view === 'visited' ? 'solid' : 'light'}
          type={view === 'visited' ? 'primary' : 'tertiary'}
          onClick={() => setView('visited')}
        >
          {t('invitations.visited')} ({invitations.filter((item) => item.appointmentState === 'completed').length})
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
        <Empty
          description={
            view === 'visited'
              ? t('invitations.emptyVisited')
              : view === 'overdue'
                ? t('invitations.emptyOverdue')
                : t('invitations.empty')
          }
        />
      ) : (
        <div className="invitationTracking__list">
          {visibleInvitations.map((invitation) => (
            <Card key={invitation.id} className="invitationTracking__card" bodyStyle={{ padding: 0 }}>
              <div className="invitationTracking__listing">
                {invitation.imageUrl && <img src={invitation.imageUrl} alt="" loading="lazy" />}
                <div className="invitationTracking__listingBody">
                  <div className="invitationTracking__heading">
                    <div>
                      <Tag color={invitation.startsAt && invitation.startsAt < Date.now() ? 'grey' : 'blue'}>
                        <IconCalendarClock />{' '}
                        {invitation.startsAt ? formatDate(invitation.startsAt) : t('invitations.dateMissing')}
                      </Tag>
                      {invitation.appointmentState === 'completed' && (
                        <Tag color="green">{t('invitations.visitedBadge')}</Tag>
                      )}
                      {isOverdue(invitation) && <Tag color="red">{t('invitations.overdueBadge')}</Tag>}
                      <Typography.Title heading={4}>{invitation.title || t('mail.untitledListing')}</Typography.Title>
                      <Typography.Text type="tertiary">
                        {[invitation.provider, invitation.address].filter(Boolean).join(' · ')}
                      </Typography.Text>
                    </div>
                    <Space wrap>
                      <Button onClick={() => navigate(`/listings/listing/${invitation.listingId}`)}>
                        {t('invitations.openInFredy')}
                      </Button>
                      {invitation.link && (
                        <Button
                          icon={<IconExternalOpen />}
                          onClick={() => window.open(invitation.link, '_blank', 'noopener')}
                        >
                          {t('invitations.openOriginal')}
                        </Button>
                      )}
                    </Space>
                  </div>

                  {isUpcoming(invitation) ? (
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
                        onClick={() => saveAppointment(invitation)}
                      >
                        {t('invitations.save')}
                      </Button>
                      <Button loading={busy === `visited:${invitation.id}`} onClick={() => markVisited(invitation)}>
                        {t('invitations.markVisited')}
                      </Button>
                    </div>
                  ) : (
                    <div className="invitationTracking__archiveActions">
                      <Button
                        loading={busy === `restore:${invitation.id}`}
                        onClick={() => restoreInvitation(invitation)}
                      >
                        {t('invitations.restore')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
