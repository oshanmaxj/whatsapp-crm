const birthdayWishService = require('../services/birthdayWish.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class BirthdayWishController {
  async list(req, res, next) { try { return ok(res, await birthdayWishService.list(req.query)); } catch (error) { return next(error); } }
  async due(req, res, next) { try { return ok(res, await birthdayWishService.getDue()); } catch (error) { return next(error); } }
  async send(req, res, next) { try { return ok(res, await birthdayWishService.sendManualWish(req.params.studentId, req.body), 201); } catch (error) { return next(error); } }
  async sendBulk(req, res, next) { try { return ok(res, await birthdayWishService.sendBulkBirthdayWishes()); } catch (error) { return next(error); } }
  async history(req, res, next) { try { return ok(res, await birthdayWishService.history(req.query)); } catch (error) { return next(error); } }
  async report(req, res, next) { try { return ok(res, await birthdayWishService.getBirthdayWishReport(req.query)); } catch (error) { return next(error); } }
}

module.exports = new BirthdayWishController();
