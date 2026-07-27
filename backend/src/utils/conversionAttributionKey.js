function conversionAttributionKey(leadId, courseId) {
  if (!/^\d+$/.test(String(leadId))) throw new Error('A valid lead ID is required for conversion attribution.');
  const course = courseId == null || courseId === '' ? 'none' : String(courseId);
  if (course !== 'none' && !/^\d+$/.test(course)) throw new Error('A valid course ID is required for conversion attribution.');
  return `lead:${leadId}:course:${course}`;
}

module.exports = { conversionAttributionKey };
