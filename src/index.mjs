import * as core from '@actions/core';
import imp from './imp.js';
const { run } = imp;

run({ version: core.getInput('version'), args: core.getInput('args', { trimWhitespace: false }), diff: core.getInput('diff') })
  .then(status => { process.exitCode = status; })
  .catch(error => core.setFailed(error.message));
