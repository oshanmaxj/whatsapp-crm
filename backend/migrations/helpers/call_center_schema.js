const ARRAY_UDTS = Object.freeze({
  _int2: 'smallint[]',
  _int4: 'integer[]',
  _int8: 'bigint[]',
  _uuid: 'uuid[]'
});

async function inspectAllowedNextStatusType(queryInterface, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'lead_status'
        AND column_name = 'allowed_next_status_ids'`,
    { transaction }
  );
  if (!rows[0]) throw new Error('Preflight failed: lead_status.allowed_next_status_ids is missing.');
  const row = rows[0];
  if (row.data_type === 'json' || row.data_type === 'jsonb') return { kind: 'json', sqlType: row.data_type, ...row };
  if (row.data_type === 'ARRAY' && ARRAY_UDTS[row.udt_name]) return { kind: 'array', sqlType: ARRAY_UDTS[row.udt_name], ...row };
  throw new Error(`Preflight failed: unsupported lead_status.allowed_next_status_ids type ${row.data_type}/${row.udt_name}.`);
}

function allowedNextStatusParameter(values, type) {
  if (!Array.isArray(values)) throw new Error('allowed_next_status_ids must be an array.');
  if (type.kind === 'json') return JSON.stringify(values);
  if (type.sqlType === 'uuid[]') {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!values.every(value => uuid.test(String(value)))) throw new Error('allowed_next_status_ids contains an invalid UUID.');
    return `{${values.join(',')}}`;
  }
  if (!values.every(value => Number.isSafeInteger(Number(value)))) throw new Error('allowed_next_status_ids contains a non-integer value.');
  return `{${values.map(Number).join(',')}}`;
}

function allowedNextStatusSql(type, placeholder = ':allowedNextStatusIds') {
  return `CAST(${placeholder} AS ${type.sqlType})`;
}

module.exports = { inspectAllowedNextStatusType, allowedNextStatusParameter, allowedNextStatusSql };
