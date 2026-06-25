const { google } = require('googleapis');
const { GoogleSheetConnection } = require('../models');

function sanitize(connection) {
  const plain = typeof connection?.toJSON === 'function' ? connection.toJSON() : connection;
  if (!plain) return null;
  delete plain.encryptedPrivateKey;
  return plain;
}

class GoogleSheetsService {
  async listConnections() {
    const rows = await GoogleSheetConnection.findAll({ order: [['created_at', 'DESC']] });
    return rows.map(sanitize);
  }

  async createConnection(payload) {
    const row = await GoogleSheetConnection.create({
      name: payload.name,
      spreadsheetId: payload.spreadsheetId,
      sheetName: payload.sheetName || 'Leads',
      authType: payload.authType || 'service_account',
      serviceAccountEmail: payload.serviceAccountEmail || process.env.GOOGLE_SHEETS_CLIENT_EMAIL || null,
      encryptedPrivateKey: payload.privateKey || payload.encryptedPrivateKey || process.env.GOOGLE_SHEETS_PRIVATE_KEY || null,
      isActive: payload.isActive !== false
    });
    return sanitize(row);
  }

  async updateConnection(id, payload) {
    const row = await GoogleSheetConnection.findByPk(id);
    if (!row) throw Object.assign(new Error('Google Sheets connection not found'), { status: 404 });
    await row.update({
      name: payload.name ?? row.name,
      spreadsheetId: payload.spreadsheetId ?? row.spreadsheetId,
      sheetName: payload.sheetName ?? row.sheetName,
      authType: payload.authType ?? row.authType,
      serviceAccountEmail: payload.serviceAccountEmail ?? row.serviceAccountEmail,
      encryptedPrivateKey: payload.privateKey || payload.encryptedPrivateKey || row.encryptedPrivateKey,
      isActive: payload.isActive ?? row.isActive
    });
    return sanitize(row);
  }

  async deleteConnection(id) {
    const row = await GoogleSheetConnection.findByPk(id);
    if (!row) throw Object.assign(new Error('Google Sheets connection not found'), { status: 404 });
    await row.destroy();
    return { deleted: true, id };
  }

  async getRawConnection(id) {
    if (id) {
      const row = await GoogleSheetConnection.findByPk(id);
      if (!row) throw Object.assign(new Error('Google Sheets connection not found'), { status: 404 });
      return row;
    }
    return null;
  }

  async sheetsClient(connection = null) {
    const clientEmail = connection?.serviceAccountEmail || process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = (connection?.encryptedPrivateKey || process.env.GOOGLE_SHEETS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (!clientEmail || !privateKey) {
      const error = new Error('Google Sheets service account credentials are not configured');
      error.status = 400;
      throw error;
    }
    const auth = new google.auth.JWT(clientEmail, null, privateKey, ['https://www.googleapis.com/auth/spreadsheets']);
    return google.sheets({ version: 'v4', auth });
  }

  async appendRow({ connectionId, spreadsheetId, sheetName, values }) {
    const connection = await this.getRawConnection(connectionId);
    const resolvedSpreadsheetId = spreadsheetId || connection?.spreadsheetId;
    const resolvedSheetName = sheetName || connection?.sheetName || 'Leads';
    if (!resolvedSpreadsheetId) throw Object.assign(new Error('Spreadsheet ID is required'), { status: 400 });
    const sheets = await this.sheetsClient(connection);
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: resolvedSpreadsheetId,
      range: `${resolvedSheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] }
    });
    return response.data;
  }

  async testRow(payload) {
    const values = payload.values || ['Test', 'Flow Builder', new Date().toISOString()];
    return this.appendRow({
      connectionId: payload.connectionId,
      spreadsheetId: payload.spreadsheetId,
      sheetName: payload.sheetName,
      values
    });
  }
}

module.exports = new GoogleSheetsService();
