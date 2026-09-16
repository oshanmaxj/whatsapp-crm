const models = require('../models');
const logger = require('../config/logger');

function createFacebookConversationIdentityService(dependencies = {}) {
  const sequelize = dependencies.sequelize || models.sequelize;
  const Contact = dependencies.Contact || models.Contact;
  const Conversation = dependencies.Conversation || models.Conversation;
  const FacebookContact = dependencies.FacebookContact || models.FacebookContact;
  const log = dependencies.logger || logger;

  async function lockIdentity(facebookPageId, psid, transaction) {
    if (sequelize.getDialect() !== 'postgres') return;
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:identity))', {
      replacements: { identity: `fb-contact:${facebookPageId}:${psid}` }, transaction
    });
  }

  async function resolveContact(values, transaction) {
    const { facebookPageId, psid, displayName, profilePictureUrl } = values;
    if (!facebookPageId) throw Object.assign(new Error('facebookPageId is required'), { code: 'FACEBOOK_PAGE_ID_REQUIRED' });
    if (!psid) throw Object.assign(new Error('Facebook PSID is required'), { code: 'FACEBOOK_PSID_REQUIRED' });

    await lockIdentity(facebookPageId, psid, transaction);

    let facebookContact = await FacebookContact.findOne({
      where: { facebookPageId, facebookPsid: psid }, transaction, lock: transaction.LOCK.UPDATE
    });

    let contact = facebookContact?.contactId
      ? await Contact.findByPk(facebookContact.contactId, { transaction, paranoid: false })
      : null;
    if (contact?.deletedAt) await contact.restore({ transaction });

    if (!contact) {
      const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
      contact = await Contact.create({
        phone: null,
        firstName: parts.shift() || 'Facebook',
        lastName: parts.join(' ') || null,
        status: 'active'
      }, { transaction });
    }

    if (!facebookContact) {
      facebookContact = await FacebookContact.create({
        facebookPageId,
        facebookPsid: psid,
        contactId: contact.id,
        displayName: displayName || null,
        profilePictureUrl: profilePictureUrl || null
      }, { transaction });
    } else {
      const updates = {};
      if (!facebookContact.contactId) updates.contactId = contact.id;
      if (displayName && !facebookContact.displayName) updates.displayName = displayName;
      if (profilePictureUrl && !facebookContact.profilePictureUrl) updates.profilePictureUrl = profilePictureUrl;
      if (Object.keys(updates).length) await facebookContact.update(updates, { transaction });
    }

    return { contact, facebookContact };
  }

  async function run(values, transaction) {
    const { facebookPageId, psid } = values;
    const { contact, facebookContact } = await resolveContact(values, transaction);

    const facebookThreadKey = `${facebookPageId}:${psid}`;
    let conversation = await Conversation.findOne({
      where: { facebookThreadKey }, transaction, lock: transaction.LOCK.UPDATE
    });

    let created = false;
    if (conversation) {
      const updates = { contactId: contact.id };
      if (values.lastMessageAt) updates.lastMessageAt = values.lastMessageAt;
      await conversation.update(updates, { transaction });
    } else {
      conversation = await Conversation.create({
        contactId: contact.id,
        channel: 'facebook_messenger',
        facebookPageId,
        facebookThreadKey,
        assignedUserId: null,
        lastMessageAt: values.lastMessageAt || new Date(),
        status: 'open'
      }, { transaction });
      created = true;
    }

    const persisted = typeof values.afterResolve === 'function'
      ? await values.afterResolve({ contact, conversation, facebookContact, transaction })
      : null;

    return { contact, conversation, facebookContact, created, persisted };
  }

  return {
    async resolveContactOnly(values, options = {}) {
      if (options.transaction) return resolveContact(values, options.transaction);
      return sequelize.transaction((transaction) => resolveContact(values, transaction));
    },
    async findOrCreateByPageAndPsid(values, options = {}) {
      if (options.transaction) return run(values, options.transaction);
      try {
        return await sequelize.transaction((transaction) => run(values, transaction));
      } catch (error) {
        log.error('facebook_identity_transaction_failed', {
          facebookPageId: values.facebookPageId,
          psidLastFour: String(values.psid || '').slice(-4) || null,
          message: error.message
        });
        throw error;
      }
    }
  };
}

module.exports = createFacebookConversationIdentityService();
module.exports.createFacebookConversationIdentityService = createFacebookConversationIdentityService;
