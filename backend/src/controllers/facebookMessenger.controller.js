const service = require('../services/facebookMessenger.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class FacebookMessengerController {
  async listConversations(req, res, next) {
    try { return ok(res, await service.listConversations({ facebookPageId: req.query.facebookPageId || null, userId: req.user?.id })); }
    catch (error) { return next(error); }
  }
  async getMessages(req, res, next) {
    try { return ok(res, await service.getMessages(req.params.conversationId, req.user?.id, req.query)); }
    catch (error) { return next(error); }
  }
  async sendMessage(req, res, next) {
    try {
      const record = await service.sendTextMessage({
        conversationId: req.params.conversationId,
        text: req.body.text,
        userId: req.user?.id,
        clientMessageId: req.body.clientMessageId || null
      });
      return ok(res, record, 201);
    } catch (error) { return next(error); }
  }
}
module.exports = new FacebookMessengerController();
