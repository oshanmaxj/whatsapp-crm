const express = require('express');
const auth = require('../middleware/auth.middleware');
const permission = require('../middleware/permission.middleware');
const controller = require('../controllers/accounting.controller');

const router = express.Router();
router.use(auth.authenticate);
router.get('/summary', permission('accounting.view'), controller.summary.bind(controller));
router.get('/transactions', permission('accounting.view'), controller.listTransactions.bind(controller));
router.post('/transactions', permission('accounting.create'), controller.createTransaction.bind(controller));
router.get('/transactions/:id', permission('accounting.view'), controller.getTransaction.bind(controller));
router.patch('/transactions/:id', permission('accounting.edit'), controller.updateTransaction.bind(controller));
router.delete('/transactions/:id', permission('accounting.delete'), controller.deleteTransaction.bind(controller));
router.get('/categories', permission('accounting.view'), controller.listCategories.bind(controller));
router.post('/categories', permission('accounting.create'), controller.createCategory.bind(controller));
router.patch('/categories/:id', permission('accounting.edit'), controller.updateCategory.bind(controller));
router.delete('/categories/:id', permission('accounting.delete'), controller.deleteCategory.bind(controller));
router.get('/reports', permission('accounting.view'), controller.reports.bind(controller));
module.exports = router;
