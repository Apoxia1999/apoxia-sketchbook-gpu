module.exports = async context => {
  const { prepareTools } = await import('../scripts/prepare-desktop-tools.mjs');
  const arch = require('builder-util').Arch[context.arch];
  await prepareTools(context.electronPlatformName, arch);
};
