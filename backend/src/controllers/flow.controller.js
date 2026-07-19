const flowService = require('../services/flow.service');
const whatsappAccountAccessService = require('../services/whatsappAccountAccess.service');

async function assertFlowAccess(req) {
  await flowService.get(req.params.id, req.user?.id);
  const requestedAccountId = req.body?.whatsappAccountId || req.body?.flow?.whatsappAccountId;
  if (requestedAccountId) {
    await whatsappAccountAccessService.assertAccess(requestedAccountId, req.user?.id);
  }
  const requestedDepartmentId = req.body?.departmentId || req.body?.flow?.departmentId;
  if (requestedDepartmentId) {
    await whatsappAccountAccessService.assertDepartmentAccess(requestedDepartmentId, req.user?.id);
  }
}

function assertActionPermissions(req) {
  const isSystemAdmin = Boolean(req.user?.isSystemAdmin);
  const permissions = new Set(req.user?.permissions || []);
  const nodes = req.body?.nodes || [];
  const actions = nodes.flatMap((node) => {
    const config = node.configJson || node.config || node.data?.config || {};
    return [...(config.automationActions || []), ...(config.buttons || []).flatMap((button) => [
      ...(button.automationActions || []),
      ...(button.primaryActionType ? [{ actionType: button.primaryActionType }] : [])
    ])];
  });
  const start = nodes.find((node) => (node.nodeType || node.data?.nodeType) === 'start');
  const startConfig = start?.configJson || start?.config || start?.data?.config || req.body?.flow?.triggerConfig || {};
  if (startConfig.matchType === 'regex') {
    if (!isSystemAdmin && !permissions.has('flows.manage_triggers')) throw Object.assign(new Error('Regular expression triggers require flows.manage_triggers.'), { status: 403 });
    startConfig.regexPrivileged = true;
  }
  if (!isSystemAdmin && actions.length && !permissions.has('flows.manage_actions')) throw Object.assign(new Error('Flow automation actions require flows.manage_actions.'), { status: 403 });
  if (!isSystemAdmin && actions.some((action) => action.actionType === 'START_FLOW') && !permissions.has('flows.start_other_flows')) throw Object.assign(new Error('Starting another flow requires flows.start_other_flows.'), { status: 403 });
  if (!isSystemAdmin && actions.some((action) => ['SEND_WEBHOOK', 'SEND_GOOGLE_SHEETS', 'CREATE_CALENDAR_EVENT'].includes(action.actionType)) && !permissions.has('flows.manage_integrations')) throw Object.assign(new Error('Integration actions require flows.manage_integrations.'), { status: 403 });
}

class FlowController {
  async options(req, res, next) {
    try { return res.json({ success: true, data: await flowService.actionOptions(req.user?.id, req.query.currentFlowId) }); } catch (err) { next(err); }
  }
  async list(req, res, next) {
    try { return res.json({ success: true, data: await flowService.list(req.user?.id) }); } catch (err) { next(err); }
  }

  async get(req, res, next) {
    try { return res.json({ success: true, data: await flowService.get(req.params.id, req.user?.id) }); } catch (err) { next(err); }
  }

  async create(req, res, next) {
    try { return res.status(201).json({ success: true, data: await flowService.create(req.body, req.user?.id || null) }); } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.update(req.params.id, req.body) }); } catch (err) { next(err); }
  }

  async remove(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.remove(req.params.id) }); } catch (err) { next(err); }
  }

  async saveBuilder(req, res, next) {
    try { await assertFlowAccess(req); assertActionPermissions(req); return res.json({ success: true, data: await flowService.saveBuilder(req.params.id, req.body) }); } catch (err) { next(err); }
  }

  async uploadMedia(req, res, next) {
    try {
      await assertFlowAccess(req);
      return res.status(201).json({ success: true, data: await flowService.uploadFlowMedia(req.params.id, req.body, req.user?.id || null) });
    } catch (err) { next(err); }
  }

  async publish(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.publish(req.params.id) }); } catch (err) { next(err); }
  }
  async unpublish(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.unpublish(req.params.id) }); } catch (err) { next(err); }
  }
  async duplicate(req, res, next) {
    try { await assertFlowAccess(req); return res.status(201).json({ success: true, data: await flowService.duplicate(req.params.id, req.user?.id || null) }); } catch (err) { next(err); }
  }
  async logs(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.logs(req.params.id) }); } catch (err) { next(err); }
  }
  async stats(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.analytics(req.params.id) }); } catch (err) { next(err); }
  }
  async createNode(req, res, next) {
    try { await assertFlowAccess(req); return res.status(201).json({ success: true, data: await flowService.createNode(req.params.id, req.body) }); } catch (err) { next(err); }
  }
  async updateNode(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.updateNode(req.params.id, req.params.nodeKey, req.body) }); } catch (err) { next(err); }
  }
  async deleteNode(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.deleteNode(req.params.id, req.params.nodeKey) }); } catch (err) { next(err); }
  }
  async createConnection(req, res, next) {
    try { await assertFlowAccess(req); return res.status(201).json({ success: true, data: await flowService.createConnection(req.params.id, req.body) }); } catch (err) { next(err); }
  }
  async deleteConnection(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.deleteConnection(req.params.id, req.params.connectionId) }); } catch (err) { next(err); }
  }

  async test(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.test(req.params.id, req.body || {}) }); } catch (err) { next(err); }
  }

  async analytics(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.analytics(req.params.id) }); } catch (err) { next(err); }
  }

  async runs(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.runs(req.params.id) }); } catch (err) { next(err); }
  }
  async validate(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.validateForPublication(req.params.id) }); } catch (err) { next(err); }
  }
  async simulateTrigger(req, res, next) {
    try {
      await assertFlowAccess(req);
      const allowRegex = req.user?.isSystemAdmin || (req.user?.permissions || []).includes('flows.manage_triggers');
      return res.json({ success: true, data: await flowService.simulateTrigger(req.params.id, req.body || {}, { allowRegex }) });
    } catch (err) { next(err); }
  }
}

module.exports = new FlowController();
