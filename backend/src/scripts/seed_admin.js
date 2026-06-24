const dotenv = require('dotenv');
dotenv.config();

const validateEnv = require('../config/validateEnv');
const { sequelize, User, Role, UserRole } = require('../models');
const userService = require('../services/user.service');

async function run() {
  try {
    validateEnv();
    await sequelize.authenticate();
    await userService.ensureAccessDefaults();

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@firstofeducation.com';
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword || adminPassword.length < 12) {
      throw new Error('ADMIN_PASSWORD must be set to a strong temporary password with at least 12 characters.');
    }

    const [adminRole] = await Role.findOrCreate({
      where: { name: 'admin' },
      defaults: { description: 'Administrator role' }
    });

    const [agentRole] = await Role.findOrCreate({
      where: { name: 'agent' },
      defaults: { description: 'Sales agent role' }
    });

    const [admin, created] = await User.findOrCreate({
      where: { email: adminEmail },
      defaults: {
        firstName: process.env.ADMIN_FIRST_NAME || 'First Of Education',
        lastName: process.env.ADMIN_LAST_NAME || 'Admin',
        email: adminEmail,
        passwordHash: adminPassword,
        status: 'active',
        isSystemAdmin: true
      }
    });

    if (!created) {
      await admin.update({
        firstName: admin.firstName || process.env.ADMIN_FIRST_NAME || 'First Of Education',
        lastName: admin.lastName || process.env.ADMIN_LAST_NAME || 'Admin',
        passwordHash: adminPassword,
        status: 'active',
        isSystemAdmin: true
      });
    }

    await UserRole.findOrCreate({
      where: { userId: admin.id, roleId: adminRole.id },
      defaults: { userId: admin.id, roleId: adminRole.id }
    });
    await UserRole.findOrCreate({
      where: { userId: admin.id, roleId: agentRole.id },
      defaults: { userId: admin.id, roleId: agentRole.id }
    });

    console.log(`Production admin user ready: ${adminEmail}`);
    process.exit(0);
  } catch (error) {
    console.error('Admin seed failed:', error.message || error);
    process.exit(1);
  } finally {
    await sequelize.close().catch(() => {});
  }
}

run();
