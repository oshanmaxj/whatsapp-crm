const service=require('../services/callCenter.service');const ok=(r,d,s=200)=>r.status(s).json({success:true,data:d});
exports.start=(q,r,n)=>service.start(q.body,q.user).then(x=>ok(r,x,201)).catch(n);
exports.complete=(q,r,n)=>service.complete(q.params.id,q.body,q.user).then(x=>ok(r,x)).catch(n);
exports.log=(q,r,n)=>service.log(q.body,q.user).then(x=>ok(r,x,201)).catch(n);
exports.dashboard=(q,r,n)=>service.dashboard(q.query,q.user).then(x=>ok(r,x)).catch(n);
exports.timeline=(q,r,n)=>service.timeline(q.params.id,q.user).then(x=>ok(r,x)).catch(n);
exports.options=(q,r,n)=>service.options(q.query,q.user).then(x=>ok(r,x)).catch(n);
exports.active=(q,r,n)=>service.active(q.user).then(x=>ok(r,x)).catch(n);
exports.queue=(q,r,n)=>service.queue(q.user).then(x=>ok(r,x)).catch(n);
