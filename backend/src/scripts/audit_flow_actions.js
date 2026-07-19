require('dotenv').config();
const { Flow, FlowNode, FlowConnection, sequelize } = require('../models');
const flowService = require('../services/flow.service');

(async () => {
  try {
    await sequelize.authenticate();
    const flows = await Flow.findAll({ include: [{ model: FlowNode, as: 'nodes', required: false }, { model: FlowConnection, as: 'connections', required: false }] });
    let issueCount = 0;
    for (const flow of flows) {
      const details = [...flowService.validateFlow(flow), ...await flowService.validateFlowReferences(flow)];
      for (const issue of details) {
        issueCount += 1;
        process.stdout.write(`${issue.severity || 'error'} flow=${flow.id} node=${issue.nodeKey || '-'} ${issue.message}\n`);
      }
    }
    process.stdout.write(`Audited ${flows.length} flow(s); found ${issueCount} issue(s). No records were changed.\n`);
    await sequelize.close();
    process.exitCode = issueCount ? 2 : 0;
  } catch (error) {
    process.stderr.write(`Flow action audit failed: ${error.message}\n`);
    process.exitCode = 1;
  }
})();
