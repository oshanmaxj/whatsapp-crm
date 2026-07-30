const { Op, fn, col, where } = require('sequelize');
const { Label } = require('../models');

function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function assertPermission(actor, permission) {
  if (actor?.isSystemAdmin || actor?.permissions?.includes(permission)) return;
  throw Object.assign(new Error('You do not have permission to perform this label action.'), {
    status: 403,
    code: 'LABEL_PERMISSION_DENIED'
  });
}

class LabelService {
  async list({ search = '', limit = 100 } = {}) {
    const term = normalizedName(search);
    return Label.findAll({
      where: term ? { name: { [Op.iLike]: `%${term}%` } } : {},
      order: [['name', 'ASC']],
      limit: Math.min(Math.max(Number(limit) || 100, 1), 200)
    });
  }

  async create(payload = {}, actor) {
    assertPermission(actor, 'labels.create');
    const name = normalizedName(payload.name);
    if (!name) throw Object.assign(new Error('Label name is required.'), { status: 422, code: 'LABEL_NAME_REQUIRED' });
    if (name.length > 100) throw Object.assign(new Error('Label name may contain at most 100 characters.'), { status: 422, code: 'LABEL_NAME_TOO_LONG' });
    const color = String(payload.color || '').trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      throw Object.assign(new Error('Label color must be a six-digit hex color.'), { status: 422, code: 'LABEL_COLOR_REQUIRED' });
    }
    const existing = await Label.findOne({ where: where(fn('lower', col('name')), name.toLowerCase()) });
    if (existing) throw Object.assign(new Error('A label with this name already exists.'), { status: 409, code: 'LABEL_DUPLICATE', existingLabel: existing });
    try {
      return await Label.create({ name, color });
    } catch (error) {
      if (error.name !== 'SequelizeUniqueConstraintError') throw error;
      throw Object.assign(new Error('A label with this name already exists.'), { status: 409, code: 'LABEL_DUPLICATE' });
    }
  }
}

module.exports = new LabelService();
module.exports.normalizedName = normalizedName;
module.exports.assertPermission = assertPermission;
