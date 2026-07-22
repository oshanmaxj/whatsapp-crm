const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Colombo', year:'numeric', month:'2-digit', day:'2-digit'
}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
exports.date = (value = new Date()) => { const p=parts(new Date(value)); return `${p.year}-${p.month}-${p.day}`; };
exports.year = (value = new Date()) => Number(parts(new Date(value)).year);
