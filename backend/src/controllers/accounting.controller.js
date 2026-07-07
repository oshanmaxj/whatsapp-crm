const service = require('../services/accounting.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class AccountingController {
  async summary(req, res, next) { try { return ok(res, await service.summary(req.query)); } catch (error) { next(error); } }
  async listTransactions(req, res, next) { try { return ok(res, await service.listTransactions(req.query)); } catch (error) { next(error); } }
  async getTransaction(req, res, next) { try { return ok(res, await service.getTransaction(req.params.id)); } catch (error) { next(error); } }
  async createTransaction(req, res, next) { try { return ok(res, await service.createTransaction(req.body, req.user?.id), 201); } catch (error) { next(error); } }
  async updateTransaction(req, res, next) { try { return ok(res, await service.updateTransaction(req.params.id, req.body)); } catch (error) { next(error); } }
  async deleteTransaction(req, res, next) { try { return ok(res, await service.deleteTransaction(req.params.id)); } catch (error) { next(error); } }
  async listCategories(req, res, next) { try { return ok(res, await service.listCategories(req.query)); } catch (error) { next(error); } }
  async createCategory(req, res, next) { try { return ok(res, await service.createCategory(req.body), 201); } catch (error) { next(error); } }
  async updateCategory(req, res, next) { try { return ok(res, await service.updateCategory(req.params.id, req.body)); } catch (error) { next(error); } }
  async deleteCategory(req, res, next) { try { return ok(res, await service.deleteCategory(req.params.id)); } catch (error) { next(error); } }
  async reports(req, res, next) { try { return ok(res, await service.reports(req.query)); } catch (error) { next(error); } }
}
module.exports = new AccountingController();
