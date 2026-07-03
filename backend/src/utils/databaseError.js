function isMissingTableError(error, tableName) {
  const code = error?.original?.code || error?.parent?.code || error?.code;
  if (['42P01', 'ER_NO_SUCH_TABLE'].includes(code)) {
    return true;
  }

  const message = [
    error?.message,
    error?.original?.message,
    error?.parent?.message
  ].filter(Boolean).join(' ').toLowerCase();
  const normalizedTableName = String(tableName || '').toLowerCase();

  return message.includes(normalizedTableName)
    && (
      message.includes('does not exist')
      || message.includes('no such table')
      || message.includes('unknown table')
      || message.includes('no description found')
    );
}

module.exports = { isMissingTableError };
