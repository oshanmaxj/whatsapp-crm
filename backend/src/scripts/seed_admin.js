const dotenv = require('dotenv');
dotenv.config();

const validateEnv = require('../config/validateEnv');
const { sequelize, User, Role, UserRole } = require('../models');

async function run() {
  try {
    validateEnv();
    await sequelize.authenticate();

    const [adminRole] = await Role.findOrCreate({
      where: { name: 'admin' },
      defaults: { description: 'Administrator role' }
    });

    const [agentRole] = await Role.findOrCreate({
      where: { name: 'agent' },
      defaults: { description: 'Sales agent role' }
    });

    const [admin, created] = await User.findOrCreate({
      where: { email: 'admin@test.com' },
      defaults: {
        firstName: 'Local',
        lastName: 'Admin',
        email: 'admin@test.com',
        passwordHash: '123456',
        status: 'active',
        isSystemAdmin: true
      }
    });

    if (!created) {
      await admin.update({
        firstName: admin.firstName || 'Local',
        lastName: admin.lastName || 'Admin',
        passwordHash: '123456',
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

    console.log('Local admin user ready: admin@test.com / 123456');
    process.exit(0);
  } catch (error) {
    console.error('Admin seed failed:', error.message || error);
    process.exit(1);
  } finally {
    await sequelize.close().catch(() => {});
  }
}

run();
