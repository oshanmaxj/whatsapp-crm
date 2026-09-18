const models = require('../models');
const logger = require('../config/logger');

// Names this service itself has ever written as a stand-in for "we don't
// know this person's real name yet" — recognized so a later, real profile
// name can upgrade the contact in place. Never used to search/merge
// contacts; upgrades only ever touch the exact contact already keyed by
// this Page+PSID.
const PLACEHOLDER_CONTACT_NAMES = new Set(['Facebook', 'Facebook User']);

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

    const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
    const resolvedFirstName = parts.shift() || null;
    const resolvedLastName = parts.join(' ') || null;

    if (!contact) {
      // Never fabricated from the Page name — only from a real profile
      // lookup the caller resolved (displayName), or this explicit,
      // clearly-labeled placeholder when none was available.
      contact = await Contact.create({
        phone: null,
        firstName: resolvedFirstName || 'Facebook User',
        lastName: resolvedLastName,
        status: 'active'
      }, { transaction });
    } else if (resolvedFirstName && PLACEHOLDER_CONTACT_NAMES.has(contact.firstName)) {
      // Upgrade this exact contact in place once a real name becomes
      // available — never a name-based search/merge across contacts, and
      // never overwrites a name this contact already genuinely has.
      await contact.update({ firstName: resolvedFirstName, lastName: resolvedLastName }, { transaction });
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
