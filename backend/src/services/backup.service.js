const fs = require('fs/promises');
const path = require('path');
const { sequelize, BackupJob } = require('../models');

const backupDir = path.join(__dirname, '..', '..', 'backups');

class BackupService {
  async export(userId) {
    await fs.mkdir(backupDir, { recursive: true });
    const job = await BackupJob.create({ type: 'export', status: 'pending', createdBy: userId || null });
    try {
      const [tables] = await sequelize.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name");
      const data = {};
      for (const table of tables) {
        const tableName = table.table_name;
        const [rows] = await sequelize.query(`select * from "${tableName}"`);
        data[tableName] = rows;
      }
      const filePath = path.join(backupDir, `backup-${Date.now()}.json`);
      await fs.writeFile(filePath, JSON.stringify({ exportedAt: new Date(), data }, null, 2));
      await job.update({ status: 'completed', filePath, metadata: { tables: tables.length } });
      return job;
    } catch (error) {
      await job.update({ status: 'failed', errorMessage: error.message });
      throw error;
    }
  }

  async list() {
    return BackupJob.findAll({ order: [['created_at', 'DESC']], limit: 50 });
  }
}

module.exports = new BackupService();
