const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Op } = require('sequelize');
const {
  AppSetting, CourseSchedule, LessonAutoPublishLog, LmsLesson, ScheduledLesson, ZoomRecordingImport
} = require('../models');
const lmsService = require('./lms.service');
const studentMessageAutomationService = require('./studentMessageAutomation.service');

const secretKeys = ['accountId', 'clientId', 'clientSecret', 'verificationToken', 'bunnyApiKey', 'bunnyLibraryId'];
const encryptedKeys = ['clientSecret', 'verificationToken', 'bunnyApiKey'];

function encryptionKey() {
  const source = process.env.APP_SETTINGS_ENCRYPTION_KEY || process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET || '';
  return crypto.createHash('sha256').update(source).digest();
}

function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('enc:')) return value || '';
  const [, iv, tag, encrypted] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

function normalizeMeetingId(value) {
  return String(value || '').replace(/\D/g, '');
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

class ZoomRecordingService {
  async storedSettings() {
    const value = { ...((await AppSetting.findOne({ where: { namespace: 'integrations', key: 'zoom' } }))?.value || {}) };
    encryptedKeys.forEach((key) => { value[key] = decryptSecret(value[key]); });
    return value;
  }

  async settings(includeSecrets = true) {
    const stored = await this.storedSettings();
    const settings = {
      accountId: process.env.ZOOM_ACCOUNT_ID || stored.accountId || '',
      clientId: process.env.ZOOM_CLIENT_ID || stored.clientId || '',
      clientSecret: process.env.ZOOM_CLIENT_SECRET || stored.clientSecret || '',
      verificationToken: process.env.ZOOM_VERIFICATION_TOKEN || stored.verificationToken || '',
      recordingImportEnabled: stored.recordingImportEnabled ?? true,
      defaultRecordingStorage: process.env.ZOOM_RECORDING_STORAGE || stored.defaultRecordingStorage || 'external',
      bunnyLibraryId: process.env.BUNNY_LIBRARY_ID || stored.bunnyLibraryId || '',
      bunnyApiKey: process.env.BUNNY_API_KEY || stored.bunnyApiKey || '',
      bunnyPullZoneUrl: process.env.BUNNY_PULL_ZONE_URL || stored.bunnyPullZoneUrl || ''
    };
    if (includeSecrets) return settings;
    return {
      recordingImportEnabled: settings.recordingImportEnabled,
      defaultRecordingStorage: settings.defaultRecordingStorage,
      bunnyPullZoneUrl: settings.bunnyPullZoneUrl,
      configured: Boolean(settings.accountId && settings.clientId && settings.clientSecret),
      bunnyConfigured: Boolean(settings.bunnyLibraryId && settings.bunnyApiKey),
      accountId: settings.accountId ? '••••••••' : '',
      clientId: settings.clientId ? '••••••••' : '',
      clientSecret: settings.clientSecret ? '••••••••' : '',
      verificationToken: settings.verificationToken ? '••••••••' : '',
      bunnyLibraryId: settings.bunnyLibraryId ? '••••••••' : '',
      bunnyApiKey: settings.bunnyApiKey ? '••••••••' : ''
    };
  }

  async saveSettings(payload, userId) {
    const existing = await this.storedSettings();
    const allowed = [
      'accountId', 'clientId', 'clientSecret', 'verificationToken', 'recordingImportEnabled',
      'defaultRecordingStorage', 'bunnyLibraryId', 'bunnyApiKey', 'bunnyPullZoneUrl'
    ];
    const next = { ...existing };
    for (const key of allowed) {
      if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
      const value = payload[key];
      if (secretKeys.includes(key) && (!value || String(value).includes('••'))) continue;
      next[key] = value;
    }
    if (!['bunny', 'local', 'external'].includes(next.defaultRecordingStorage || 'external')) {
      throw Object.assign(new Error('Invalid recording storage provider'), { status: 400 });
    }
    const storedValue = { ...next };
    encryptedKeys.forEach((key) => { storedValue[key] = encryptSecret(storedValue[key]); });
    const [row] = await AppSetting.findOrCreate({
      where: { namespace: 'integrations', key: 'zoom' },
      defaults: { value: storedValue, isSecret: true, updatedBy: userId || null }
    });
    if (!row.isNewRecord) await row.update({ value: storedValue, isSecret: true, updatedBy: userId || null });
    return this.settings(false);
  }

  async getZoomAccessToken() {
    const settings = await this.settings();
    if (!settings.accountId || !settings.clientId || !settings.clientSecret) {
      throw Object.assign(new Error('Zoom credentials are missing'), { status: 400 });
    }
    const credentials = Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64');
    const response = await axios.post('https://zoom.us/oauth/token', null, {
      params: { grant_type: 'account_credentials', account_id: settings.accountId },
      headers: { Authorization: `Basic ${credentials}` },
      timeout: 20000
    });
    return response.data.access_token;
  }

  async listZoomRecordings({ from, to }, accessToken = null) {
    const token = accessToken || await this.getZoomAccessToken();
    const meetings = [];
    const end = new Date(`${to}T00:00:00Z`);
    for (let cursor = new Date(`${from}T00:00:00Z`); cursor <= end;) {
      const windowEnd = new Date(Math.min(end.getTime(), cursor.getTime() + 29 * 86400000));
      let nextPageToken = '';
      do {
        const response = await axios.get('https://api.zoom.us/v2/users/me/recordings', {
          params: {
            from: cursor.toISOString().slice(0, 10), to: windowEnd.toISOString().slice(0, 10),
            page_size: 300, next_page_token: nextPageToken || undefined
          },
          headers: { Authorization: `Bearer ${token}` }, timeout: 30000
        });
        meetings.push(...(response.data.meetings || []));
        nextPageToken = response.data.next_page_token || '';
      } while (nextPageToken);
      cursor = new Date(windowEnd.getTime() + 86400000);
    }
    return [...new Map(meetings.map((meeting) => [meeting.uuid || `${meeting.id}:${meeting.start_time}`, meeting])).values()];
  }

  async getMeetingRecordings(meetingId, accessToken = null) {
    const token = accessToken || await this.getZoomAccessToken();
    const response = await axios.get(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/recordings`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 30000
    });
    return response.data;
  }

  async downloadRecording(downloadUrl, accessToken) {
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer', headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10 * 60 * 1000, maxContentLength: Infinity, maxBodyLength: Infinity
    });
    return Buffer.from(response.data);
  }

  async storeRecording(file, recording, settings) {
    const provider = settings.defaultRecordingStorage;
    if (provider === 'bunny' && settings.bunnyLibraryId && settings.bunnyApiKey) {
      const created = await axios.post(
        `https://video.bunnycdn.com/library/${settings.bunnyLibraryId}/videos`,
        { title: recording.topic || `Zoom recording ${recording.start_time || ''}` },
        { headers: { AccessKey: settings.bunnyApiKey }, timeout: 30000 }
      );
      const videoId = created.data.guid;
      await axios.put(`https://video.bunnycdn.com/library/${settings.bunnyLibraryId}/videos/${videoId}`, file, {
        headers: { AccessKey: settings.bunnyApiKey, 'Content-Type': 'application/octet-stream' },
        timeout: 30 * 60 * 1000, maxContentLength: Infinity, maxBodyLength: Infinity
      });
      const embedUrl = `https://iframe.mediadelivery.net/embed/${settings.bunnyLibraryId}/${videoId}`;
      return { provider: 'bunny', storageUrl: embedUrl, bunnyVideoId: videoId, embedCode: `<iframe src="${embedUrl}" loading="lazy" allowfullscreen></iframe>` };
    }
    if (provider === 'local') {
      const directory = path.join(__dirname, '..', '..', 'uploads', 'zoom-recordings');
      await fs.mkdir(directory, { recursive: true });
      const filename = `${recording.recording_file_id || Date.now()}.mp4`.replace(/[^a-zA-Z0-9._-]/g, '-');
      await fs.writeFile(path.join(directory, filename), file);
      return { provider: 'local', storageUrl: `/uploads/zoom-recordings/${filename}`, embedCode: null };
    }
    return { provider: 'external', storageUrl: recording.play_url, embedCode: null };
  }

  findRecording(scheduled, meetings) {
    const meetingId = normalizeMeetingId(scheduled.zoomMeetingId || scheduled.schedule?.zoomMeetingId);
    const target = new Date(scheduled.scheduledStartAt).getTime();
    return meetings
      .filter((meeting) => !meetingId || normalizeMeetingId(meeting.id) === meetingId)
      .map((meeting) => ({ meeting, distance: Math.abs(new Date(meeting.start_time).getTime() - target) }))
      .filter(({ distance }) => distance <= 12 * 60 * 60 * 1000)
      .sort((a, b) => a.distance - b.distance)[0]?.meeting || null;
  }

  async log(scheduledLessonId, lessonId, action, message) {
    return LessonAutoPublishLog.create({ scheduledLessonId, lessonId, action, message });
  }

  async importRecordings(filters = {}, userId = null) {
    const settings = await this.settings();
    if (!settings.recordingImportEnabled) throw Object.assign(new Error('Zoom recording import is disabled'), { status: 400 });
    const where = {
      recordingImportStatus: { [Op.in]: ['pending', 'failed', 'checking'] },
      [Op.or]: [{ status: 'completed' }, { scheduledEndAt: { [Op.lt]: new Date() } }]
    };
    if (filters.scheduledLessonId) where.id = filters.scheduledLessonId;
    const scheduledLessons = await ScheduledLesson.findAll({
      where,
      include: [{ model: CourseSchedule, as: 'schedule', required: true, where: { autoImportRecordings: true } }]
    });
    if (!scheduledLessons.length) return { checked: 0, imported: 0, pending: 0, failed: 0 };
    const accessToken = await this.getZoomAccessToken();
    const dates = scheduledLessons.map((row) => new Date(row.scheduledStartAt));
    const from = filters.from || dateOnly(new Date(Math.min(...dates) - 86400000));
    const to = filters.to || dateOnly(new Date(Math.max(...dates) + 86400000));
    const meetings = await this.listZoomRecordings({ from, to }, accessToken);
    const result = { checked: scheduledLessons.length, imported: 0, pending: 0, failed: 0 };

    for (const scheduled of scheduledLessons) {
      await scheduled.update({ recordingImportStatus: 'checking' });
      const meeting = this.findRecording(scheduled, meetings);
      const file = meeting?.recording_files?.find((item) => String(item.file_type).toUpperCase() === 'MP4');
      if (!meeting || !file) {
        await scheduled.update({ recordingImportStatus: 'pending' });
        await this.log(scheduled.id, scheduled.lessonId, 'recording_not_found', 'Recording not found yet');
        result.pending += 1;
        continue;
      }
      const [importRow, created] = await ZoomRecordingImport.findOrCreate({
        where: { recordingFileId: file.id },
        defaults: {
          scheduledLessonId: scheduled.id, lessonId: scheduled.lessonId,
          zoomMeetingId: String(meeting.id), zoomUuid: meeting.uuid, topic: meeting.topic,
          startTime: meeting.start_time, durationMinutes: meeting.duration,
          recordingType: file.recording_type, downloadUrl: file.download_url,
          playUrl: file.play_url, fileSize: file.file_size, status: 'found'
        }
      });
      await this.log(scheduled.id, scheduled.lessonId, 'recording_found', `Matched Zoom recording ${file.id}`);
      if (!created && importRow.status === 'imported') {
        await scheduled.update({ recordingImportStatus: 'imported', status: 'published' });
        result.imported += 1;
        continue;
      }
      try {
        await importRow.update({ status: 'downloading', errorMessage: null });
        const needsDownload = ['bunny', 'local'].includes(settings.defaultRecordingStorage)
          && (settings.defaultRecordingStorage !== 'bunny' || (settings.bunnyLibraryId && settings.bunnyApiKey));
        const buffer = needsDownload ? await this.downloadRecording(file.download_url, accessToken) : null;
        await importRow.update({ status: needsDownload ? 'uploading' : 'found' });
        const stored = await this.storeRecording(buffer, { ...meeting, ...file }, settings);
        let lesson = scheduled.lessonId ? await LmsLesson.findByPk(scheduled.lessonId) : null;
        if (!lesson) {
          lesson = await lmsService.createLesson({
            courseId: scheduled.courseId, batchId: scheduled.batchId,
            title: scheduled.title || `${meeting.topic || 'Course'} - Recording ${dateOnly(meeting.start_time)}`,
            liveClassAt: scheduled.scheduledStartAt, scheduledStartAt: scheduled.scheduledStartAt,
            scheduledEndAt: scheduled.scheduledEndAt, zoomMeetingId: String(meeting.id),
            recordingUrl: stored.provider === 'bunny' ? null : stored.storageUrl,
            bunnyVideoId: stored.bunnyVideoId || null, bunnyEmbedUrl: stored.provider === 'bunny' ? stored.storageUrl : null,
            embedCode: stored.embedCode, durationMinutes: meeting.duration, isPublished: true,
            source: 'zoom_recording_import', scheduleId: scheduled.scheduleId,
            scheduledLessonId: scheduled.id, publishedAt: new Date()
          }, userId);
          await scheduled.update({ lessonId: lesson.id });
        } else {
          await lesson.update({
            recordingUrl: stored.provider === 'bunny' ? null : stored.storageUrl,
            bunnyVideoId: stored.bunnyVideoId || null, bunnyEmbedUrl: stored.provider === 'bunny' ? stored.storageUrl : null,
            embedCode: stored.embedCode, durationMinutes: meeting.duration || lesson.durationMinutes,
            isPublished: true, publishedAt: new Date()
          });
          await studentMessageAutomationService.dispatchRecording(lesson, userId).catch(() => null);
        }
        await importRow.update({
          lessonId: lesson.id, status: 'imported', storageProvider: stored.provider,
          storageUrl: stored.storageUrl, embedCode: stored.embedCode, downloadUrl: null
        });
        await scheduled.update({ recordingImportStatus: 'imported', status: 'published' });
        await this.log(scheduled.id, lesson.id, 'recording_imported', `Recording imported using ${stored.provider} storage`);
        result.imported += 1;
      } catch (error) {
        await importRow.update({ status: 'failed', errorMessage: error.message, downloadUrl: null });
        await scheduled.update({ recordingImportStatus: 'failed' });
        await this.log(scheduled.id, scheduled.lessonId, 'recording_import_failed', error.message);
        result.failed += 1;
      }
    }
    return result;
  }

  async listImports(query = {}) {
    const where = {};
    if (query.status) where.status = query.status;
    return ZoomRecordingImport.findAll({
      where, attributes: { exclude: ['downloadUrl'] },
      include: [
        { model: ScheduledLesson, as: 'scheduledLesson', required: false },
        { model: LmsLesson, as: 'lesson', required: false, attributes: ['id', 'title'] }
      ],
      order: [['created_at', 'DESC']]
    });
  }

  async getImport(id) {
    const row = await ZoomRecordingImport.findByPk(id, { attributes: { exclude: ['downloadUrl'] } });
    if (!row) throw Object.assign(new Error('Zoom recording import not found'), { status: 404 });
    return row;
  }
}

module.exports = new ZoomRecordingService();
