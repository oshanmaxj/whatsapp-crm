const contactService = require('../services/contact.service');

class ContactController {
  async list(req, res, next) {
    try {
      const result = await contactService.listContacts(req.query);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async get(req, res, next) {
    try {
      const contact = await contactService.getContact(req.params.id);
      return res.status(200).json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const contact = await contactService.createContact(req.body);
      return res.status(201).json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const contact = await contactService.updateContact(req.params.id, req.body);
      return res.status(200).json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  }

  async remove(req, res, next) {
    try {
      const result = await contactService.deleteContact(req.params.id);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async import(req, res, next) {
    try {
      const csv = typeof req.body === 'string' ? req.body : req.body?.csv;
      if (!csv || typeof csv !== 'string') {
        const error = new Error('CSV content is required as text/csv body or { "csv": "..." }');
        error.status = 400;
        throw error;
      }

      const result = await contactService.importContactsFromCsv(csv);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async export(req, res, next) {
    try {
      const csv = await contactService.exportContactsToCsv(req.query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
      return res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ContactController();
