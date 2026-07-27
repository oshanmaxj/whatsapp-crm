const service=require('../services/leadStatusAdmin.service');const ok=(res,data,status=200)=>res.status(status).json({success:true,data});const wrap=fn=>async(req,res,next)=>{try{return await fn(req,res)}catch(error){next(error)}};
exports.list=wrap(async(req,res)=>ok(res,await service.list()));
exports.create=wrap(async(req,res)=>ok(res,await service.save(null,req.body,req.user),201));
exports.update=wrap(async(req,res)=>ok(res,await service.save(req.params.id,req.body,req.user)));
exports.disable=wrap(async(req,res)=>ok(res,await service.disable(req.params.id,req.user)));
exports.remove=wrap(async(req,res)=>ok(res,await service.remove(req.params.id,req.user)));
