const { Op, literal } = require('sequelize');
const { sequelize, Contact, Lead } = require('../models');
const { normalizePhone, requireNormalizedPhone } = require('../utils/phone');
const inboundWhatsappContactService = require('./inboundWhatsappContact.service');

const CONTACT_FIELDS = ['firstName', 'lastName', 'phone', 'whatsappId', 'email', 'company', 'status', 'notes', 'tags'];

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  return String(tags)
    .split(/[|;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function serializeContact(contact) {
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    whatsappId: contact.whatsappId,
    email: contact.email,
    company: contact.company,
    status: contact.status,
    notes: contact.notes,
    tags: normalizeTags(contact.tags),
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt
    , whatsappAccountId: contact.whatsappAccountId || null
  };
}

function escapeCsvValue(value) {
  if (Array.isArray(value)) {
    value = value.join('|');
  }
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const nextChar = csv[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
      row.push(value);
      if (row.some((field) => field.trim() !== '')) {
        rows.push(row);
      }
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((field) => field.trim() !== '')) {
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((fields) =>
    headers.reduce((record, header, index) => {
      record[header] = fields[index] || '';
      return record;
    }, {})
  );
}

function pickContactPayload(payload) {
  return CONTACT_FIELDS.reduce((data, field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      data[field] = field === 'tags' ? normalizeTags(payload[field]) : payload[field];
    }
    return data;
  }, {});
}

class ContactService {
  async findByPhone(phone) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return null;
    return Contact.findOne({
      where: { [Op.or]: [{ normalizedPhone }, { phone: normalizedPhone }, { whatsappId: normalizedPhone }] }
    });
  }

  async findByWhatsappIdentity(phone, whatsappId) {
    const identities = [normalizePhone(phone), normalizePhone(whatsappId)].filter(Boolean);
    if (!identities.length) return null;
    return Contact.findOne({
      where: {
        [Op.or]: [
          { normalizedPhone: { [Op.in]: identities } },
          { phone: { [Op.in]: identities } },
          { whatsappId: { [Op.in]: identities } }
        ]
      }
    });
  }

  buildContactWhere({ search, status, tag, whatsappAccountId } = {}) {
    const where = {};
    const and = [];

    if (search) {
      const term = `%${search}%`;
      and.push({
        [Op.or]: [
          { firstName: { [Op.iLike]: term } },
          { lastName: { [Op.iLike]: term } },
          { phone: { [Op.iLike]: term } },
          sequelize.where(
            sequelize.fn(
              'concat',
              sequelize.col('first_name'),
              ' ',
              sequelize.col('last_name')
            ),
            { [Op.iLike]: term }
          )
        ]
      });
    }

    if (status) {
      where.status = status;
    }

    if (tag) {
      and.push(literal(`"Contact"."tags"::jsonb ? ${sequelize.escape(tag)}`));
    }
    if (whatsappAccountId) where.whatsappAccountId = whatsappAccountId;

    if (and.length) {
      where[Op.and] = and;
    }

    return where;
  }

  async listContacts({ page = 1, limit = 20, search, status, tag, whatsappAccountId } = {}) {
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const where = this.buildContactWhere({ search, status, tag, whatsappAccountId });

    const { count, rows } = await Contact.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit
    });

    return {
      contacts: rows.map(serializeContact),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: count,
        pages: Math.ceil(count / safeLimit)
      }
    };
  }

  async getContact(contactId) {
    const contact = await Contact.findByPk(contactId);
    if (!contact) {
      const error = new Error('Contact not found');
      error.status = 404;
      throw error;
    }
    return serializeContact(contact);
  }

  async createContact(payload) {
    const values = pickContactPayload(payload);
    values.normalizedPhone = requireNormalizedPhone(values.phone);
    values.phone = values.normalizedPhone;
    const contact = await Contact.create(values);
    return serializeContact(contact);
  }

  async updateContact(contactId, payload) {
    const contact = await Contact.findByPk(contactId);
    if (!contact) {
      const error = new Error('Contact not found');
      error.status = 404;
      throw error;
    }

    const values = pickContactPayload(payload);
    if (Object.prototype.hasOwnProperty.call(values, 'phone')) {
      values.normalizedPhone = requireNormalizedPhone(values.phone);
      values.phone = values.normalizedPhone;
    }
    await contact.update(values);
    return serializeContact(contact);
  }

  async deleteContact(contactId) {
    const contact = await Contact.findByPk(contactId);
    if (!contact) {
      const error = new Error('Contact not found');
      error.status = 404;
      throw error;
    }

    await contact.destroy();
    return { deleted: true, id: contactId };
  }

  async createFromWhatsapp({ phone, whatsappId, firstName, lastName, whatsappAccountId = null }) {
    const normalizedPhone = requireNormalizedPhone(phone || whatsappId);
    return Contact.create({
      phone: normalizedPhone,
      normalizedPhone,
      whatsappId: whatsappId ? normalizedPhone : null,
      firstName,
      lastName,
      status: 'new',
      whatsappAccountId
    });
  }

  async findOrCreateFromWhatsapp({ phone, whatsappId, firstName, lastName, whatsappAccountId = null }) {
    const normalizedPhone = requireNormalizedPhone(phone || whatsappId);
    const resolution = await sequelize.transaction((transaction) => (
      inboundWhatsappContactService.resolveInboundWhatsAppContact({
        whatsappAccountId,
        whatsappId: whatsappId || normalizedPhone,
        normalizedPhone,
        profileName: [firstName, lastName].filter(Boolean).join(' '),
        transaction
      })
    ));
    await inboundWhatsappContactService.recordConflict(resolution, whatsappAccountId);
    return resolution.contact;
  }

  async findOpenLeadContact(contactId) {
    return Lead.findOne({ where: { contactId, stage: 'new' } });
  }

  async importContactsFromCsv(csv) {
    const records = parseCsv(csv);
    const result = {
      total: records.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    for (const [index, record] of records.entries()) {
      const rowNumber = index + 2;
      const payload = pickContactPayload(record);
      payload.tags = normalizeTags(record.tags || record.labels);

      if (!payload.phone) {
        result.skipped += 1;
        result.errors.push({ row: rowNumber, message: 'phone is required' });
        continue;
      }

      try {
        payload.normalizedPhone = requireNormalizedPhone(payload.phone);
        payload.phone = payload.normalizedPhone;
        const existing = await this.findByPhone(payload.phone);
        if (existing) {
          await existing.update(payload);
          result.updated += 1;
        } else {
          await Contact.create(payload);
          result.created += 1;
        }
      } catch (error) {
        result.skipped += 1;
        result.errors.push({ row: rowNumber, message: error.message });
      }
    }
    return result;
  }

  async exportContactsToCsv({ status, tag, search, whatsappAccountId } = {}) {
    const contacts = await Contact.findAll({
      where: this.buildContactWhere({ status, tag, search, whatsappAccountId }),
      order: [['created_at', 'DESC']]
    });
    const headers = ['id', ...CONTACT_FIELDS, 'createdAt', 'updatedAt'];
    const lines = [
      headers.join(','),
      ...contacts.map((contact) => {
        const serialized = serializeContact(contact);
        return headers.map((header) => escapeCsvValue(serialized[header])).join(',');
      })
    ];

    return lines.join('\n');
  }
}

module.exports = new ContactService();
