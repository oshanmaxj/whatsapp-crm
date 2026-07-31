const r = require('express').Router();
const auth = require('../middleware/auth.middleware');
const p = require('../middleware/permission.middleware');
const c = require('../controllers/reminderSequence.controller');
const upload = require('../middleware/flowMediaUpload.middleware');

r.use(auth.authenticate);
r.get('/dashboard', p('reminder_sequences.view'), c.dashboard);
r.post('/media', p('reminder_sequences.edit'), upload.flowMediaUpload, c.uploadMedia);
r.get('/subscriptions', p('reminder_sequences.view'), c.subscriptions);
r.get('/executions', p('reminder_sequences.view'), c.executions);
r.get('/settings', p('reminder_sequences.activate'), c.settings);
r.put('/settings', p('reminder_sequences.activate'), c.saveSettings);
r.post('/executions/:id/retry', p('reminder_sequences.retry'), c.retry);
r.post('/subscriptions', p('reminder_sequences.subscribe'), c.subscribe);
r.post('/subscriptions/:id/:action(pause|resume|cancel|unsubscribe)', p('reminder_sequences.unsubscribe'), c.change);
r.get('/', p('reminder_sequences.view'), c.list);
r.post('/', p('reminder_sequences.create'), c.create);
r.get('/:id', p('reminder_sequences.view'), c.get);
r.patch('/:id', p('reminder_sequences.edit'), c.update);
r.patch('/:id/status', p('reminder_sequences.activate'), c.status);
r.post('/:id/duplicate', p('reminder_sequences.create'), c.duplicate);
r.delete('/:id', p('reminder_sequences.delete'), c.remove);

module.exports = r;
