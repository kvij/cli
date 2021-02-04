'use strict';

const _ = require('lodash');
const API = require('../../lib/api');
const utils = require('../../lib/utils');

// Acquia
const api = new API();
const acquiaTokenCache = 'acquia.tokens';
const acquiaApps = [];
let acquiaEnvs = [];

// Helper to get tokens
const getTokens = (lando, tokens = []) => {
  const home = lando.config.home;
  const hostToken = utils.getAcquiaToken(home);
  if (hostToken && _.isEmpty(tokens)) {
    lando.cache.set(acquiaTokenCache, [hostToken], {persist: true});
  }
  return _(utils.sortTokens(tokens))
    .map(token => ({name: token.key, value: token.key}))
    .thru(tokens => tokens.concat([{name: 'add a token', value: 'more'}]))
    .value();
};

// Helper to determine whether to show list of pre-used tokens or not
const showTokenList = (recipe, tokens = []) => recipe === 'acquia' && !_.isEmpty(tokens);

// Helper to determine whether to show token password entry or not
const showTokenEntry = (data, answer, tokens = []) => data === 'acquia' && (_.isEmpty(tokens) || answer === 'more');

const getAutoCompleteSites = (answers, lando, input = null) => {
  if (!_.isEmpty(acquiaApps)) {
    return lando.Promise.resolve(acquiaApps).filter(app => _.startsWith(app.name, input));
  }
  return api.getApplications().then(apps => {
    if (apps && Array.isArray(apps)) {
      apps.map(item => acquiaApps.push({name: item.name, value: item.uuid}));
      return lando.Promise.resolve(acquiaApps);
    }
  });
};

const getAutoCompleteEnvs = (answers, lando, input = null) => {
  if (!_.isEmpty(acquiaEnvs)) {
    return lando.Promise.resolve(acquiaEnvs).filter(app => _.startsWith(app.name, input));
  }
  return api.getEnvironments(answers['acquia-app']).then(envs => {
    if (envs && Array.isArray(envs)) {
      acquiaEnvs = envs.map(item => (_.merge({name: item.name, value: item.id}, item)));
      return acquiaEnvs;
    }
  });
};

module.exports = {
  name: 'acquia',
  options: lando => ({
    'acquia-auth': {
      describe: 'Acquia API Key',
      string: true,
      interactive: {
        type: 'list',
        choices: getTokens(lando, lando.cache.get(acquiaTokenCache)),
        message: 'Select your Acquia API key',
        when: answers => showTokenList(answers.recipe, lando.cache.get(acquiaTokenCache)),
        weight: 510,
      },
    },
    'acquia-key': {
      hidden: false,
      interactive: {
        name: 'acquia-key',
        type: 'password',
        message: 'Enter your Acquia API key',
        when: answers => {
          // If a token was selected, attempt to login.
          if (answers['acquia-auth'] && answers['acquia-auth'] !== 'more') {
            const token = _.find(lando.cache.get(acquiaTokenCache), token => token.key === answers['acquia-auth']);
            if (token) {
              answers['acquia-key'] = token.key;
              answers['acquia-secret'] = token.secret;
              return api.auth(answers['acquia-key'], answers['acquia-secret']).then(() => {
                return false;
              }).catch(err => {
                // Clear out token data and prompt user.
                answers['acquia-key'] = null;
                answers['acquia-secret'] = null;
                return true;
              });
            }
          }
          return showTokenEntry(answers.recipe, answers['acquia-auth'], lando.cache.get(acquiaTokenCache));
        },
        weight: 520,
      },
    },
    'acquia-secret': {
      hidden: true,
      interactive: {
        name: 'acquia-secret',
        type: 'password',
        message: 'Enter your Acquia API secret',
        when: answers => {
          return showTokenEntry(answers.recipe, answers['acquia-auth'], lando.cache.get(acquiaTokenCache));
        },
        validate: (input, answers) => {
          return api.auth(answers['acquia-key'], input).then(() => {
            let token = _.find(lando.cache.get(acquiaTokenCache), token => token.key === answers['acquia-key']);
            if (!token) {
              // Re-create the token as acli would so acli can use it in a container.
              token = {
                send_telemetry: false,
                key: answers['acquia-key'],
                secret: answers['acquia-secret'],
              };
              lando.cache.set(acquiaTokenCache, [token], {persist: true});
            }
            return true;
          }).catch(err => {
            return err;
          });
        },
        weight: 530,
      },
    },
    'acquia-app': {
      describe: 'An Acquia app uuid',
      string: true,
      interactive: {
        type: 'autocomplete',
        message: 'Which application?',
        source: (answers, input) => {
          return getAutoCompleteSites(answers, lando, input);
        },
        when: answers => answers.recipe === 'acquia',
        weight: 540,
      },
    },
    'acquia-env': {
      describe: 'An Acquia environment',
      string: true,
      interactive: {
        type: 'autocomplete',
        message: 'Which environment?',
        source: (answers, input) => {
          return getAutoCompleteEnvs(answers, lando, input);
        },
        when: answers => answers.recipe === 'acquia',
        weight: 540,
      },
    },
  }),
  overrides: {
    name: {
      when: answers => {
        answers.name = answers['acquia-app'];
        return false;
      },
    },
    webroot: {
      when: () => false,
    },
  },
  sources: [{
    name: 'acquia',
    label: 'acquia',
    build: (options, lando) => ([
      {name: 'get-git-url', func: (options, lando) => {
        // Set git url & branch from env
        const env = _.find(acquiaEnvs, item => item.id === options['acquia-env']);
        options['acquia-git-url'] = env.vcs.url;
        options['acquia-git-branch'] = env.vcs.path;
      }},
      {
        name: 'clone-repo',
        cmd: options =>
          `/helpers/get-remote-url.sh ${options['acquia-git-url']} "--branch ${options['acquia-git-branch']}"`,
        remove: 'true',
      },
    ]),
  }],
  build: (options, lando) => {
    return {
    };
  },
};
