const { Config } = require('../models');
const { logger } = require('../logger');

const info = async bot => {
  try {
    const config = await Config.findOne({}) || new Config();
    config.node_status = 'up';
    config.node_uri = "https://example.com";
    await config.save();
  } catch (error) {
    const message = error.toString();
    logger.error(`node info catch error: ${message}`);
  }
};

module.exports = info;
