const { Appointment, AppointmentRequest, Contact, Lead, User } = require('../models');
const whatsappService = require('./whatsapp.service');

function render(text = '', appointment = {}) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = appointment[key];
    if (value !== undefined && value !== null) return String(value);
    if (key === 'date') return appointment.appointmentAt ? new Date(appointment.appointmentAt).toLocaleString() : '';
    return '';
  });
}

class AppointmentService {
  include() {
    return [
      { model: User, as: 'agent', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
      { model: Contact, as: 'contact', required: false },
      { model: Lead, as: 'lead', required: false },
      { model: AppointmentRequest, as: 'requests', required: false }
    ];
  }

  async list({ status, assignedAgentId, visibility } = {}) {
    const where = {};
    if (status) where.status = status;
    if (assignedAgentId) where.assignedAgentId = assignedAgentId;
    if (visibility) where.visibility = visibility;
    return Appointment.findAll({ where, include: this.include(), order: [['appointment_at', 'ASC']] });
  }

  async get(id) {
    const appointment = await Appointment.findByPk(id, { include: this.include() });
    if (!appointment) {
      const error = new Error('Appointment not found');
      error.status = 404;
      throw error;
    }
    return appointment;
  }

  async create(payload, createdBy) {
    if (!payload.title || !payload.appointmentAt || !payload.customerName || !payload.customerPhone) {
      const error = new Error('Title, appointment date, customer name, and customer phone are required');
      error.status = 400;
      throw error;
    }

    const appointment = await Appointment.create({
      title: payload.title,
      appointmentType: payload.appointmentType || 'Consultation',
      visibility: payload.visibility || 'private',
      status: payload.status || 'Pending',
      appointmentAt: payload.appointmentAt,
      durationMinutes: payload.durationMinutes || 30,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      customerEmail: payload.customerEmail || null,
      assignedAgentId: payload.assignedAgentId || null,
      contactId: payload.contactId || null,
      leadId: payload.leadId || null,
      reminderAt: payload.reminderAt || null,
      confirmationMessage: payload.confirmationMessage || 'Hi {{customerName}}, your appointment is confirmed for {{date}}.',
      reminderMessage: payload.reminderMessage || 'Reminder: your appointment is scheduled for {{date}}.',
      notes: payload.notes || null,
      createdBy
    });

    if (payload.createRequest) {
      await AppointmentRequest.create({
        appointmentId: appointment.id,
        appointmentType: appointment.appointmentType,
        customerName: appointment.customerName,
        customerPhone: appointment.customerPhone,
        customerEmail: appointment.customerEmail,
        requestedAt: appointment.appointmentAt,
        status: 'Registered',
        notes: payload.notes || null
      });
    }

    return this.get(appointment.id);
  }

  async update(id, payload) {
    const appointment = await this.get(id);
    await appointment.update(payload);
    return this.get(id);
  }

  async remove(id) {
    const appointment = await this.get(id);
    await appointment.destroy();
    return { deleted: true, id };
  }

  async confirm(id) {
    const appointment = await this.get(id);
    await appointment.update({ status: 'Confirmed', confirmedAt: new Date() });
    const message = render(appointment.confirmationMessage, appointment);
    return {
      appointment: await this.get(id),
      notification: await this.sendOrSimulate(appointment.customerPhone, message)
    };
  }

  async cancel(id, reason = null) {
    const appointment = await this.get(id);
    await appointment.update({
      status: 'Cancelled',
      cancelledAt: new Date(),
      notes: reason ? [appointment.notes, `Cancellation reason: ${reason}`].filter(Boolean).join('\n') : appointment.notes
    });
    return this.get(id);
  }

  async reminder(id) {
    const appointment = await this.get(id);
    const message = render(appointment.reminderMessage, appointment);
    return {
      appointment,
      notification: await this.sendOrSimulate(appointment.customerPhone, message)
    };
  }

  async sendOrSimulate(to, text) {
    const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';
    if (realSendEnabled) {
      return { mode: 'sent', response: await whatsappService.sendTextMessage({ to, text }) };
    }
    return { mode: 'simulated', to, text };
  }
}

module.exports = new AppointmentService();
