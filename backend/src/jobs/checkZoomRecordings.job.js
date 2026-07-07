const zoomRecordingService = require('../services/zoomRecording.service');

async function checkZoomRecordingsJob(options = {}, userId = null) {
  return zoomRecordingService.importRecordings(options, userId);
}

module.exports = { checkZoomRecordingsJob };
