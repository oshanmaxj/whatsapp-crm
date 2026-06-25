const googleSheetsService = require('../services/googleSheets.service');

class GoogleSheetsController {
  async list(req, res, next) {
    try { return res.json({ success: true, data: await googleSheetsService.listConnections() }); } catch (err) { next(err); }
  }

  async create(req, res, next) {
    try { return res.status(201).json({ success: true, data: await googleSheetsService.createConnection(req.body) }); } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try { return res.json({ success: true, data: await googleSheetsService.updateConnection(req.params.id, req.body) }); } catch (err) { next(err); }
  }

  async remove(req, res, next) {
    try { return res.json({ success: true, data: await googleSheetsService.deleteConnection(req.params.id) }); } catch (err) { next(err); }
  }

  async testRow(req, res, next) {
    try { return res.json({ success: true, data: await googleSheetsService.testRow(req.body) }); } catch (err) { next(err); }
  }
}

module.exports = new GoogleSheetsController();
