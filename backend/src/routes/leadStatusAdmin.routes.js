const r=require('express').Router(),auth=require('../middleware/auth.middleware'),permit=require('../middleware/permission.middleware'),c=require('../controllers/leadStatusAdmin.controller');
r.use(auth.authenticate);
r.get('/',permit('lead_statuses.view'),c.list);
r.post('/',permit('lead_statuses.create'),c.create);
r.patch('/:id',permit('lead_statuses.update'),c.update);
r.post('/:id/disable',permit('lead_statuses.disable'),c.disable);
r.delete('/:id',permit('lead_statuses.delete'),c.remove);
module.exports=r;
