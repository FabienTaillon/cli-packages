# [forcedotcom](https://github.com/forcedotcom)/[cli-packages](https://github.com/forcedotcom/cli-packages)

# Description

This repository contains (or will contain) the core Salesforce CLI, the base command, and core plugins.

## Packages

Currently, we have the following packages:

### [@salesforce/command](https://www.npmjs.com/package/@salesforce/command) - The Salesforce CLI base command.

* Learn more in its [README](https://github.com/forcedotcom/cli-packages/blob/develop/packages/command/README.md).
* See the code at [packages/command](https://github.com/forcedotcom/cli-packages/blob/develop/packages/command).
* Read the [API docs](https://forcedotcom.github.io/cli-packages/command).

# Usage

## Contributing 

If you are interested in contributing, please take a look at the [CONTRIBUTING](https://github.com/forcedotcom/cli-packages/blob/develop/CONTRIBUTING.md) guide.

## Development 

If you are interested in building these packages locally, please take a look at the [DEVELOPING](https://github.com/forcedotcom/cli-packages/blob/develop/DEVELOPING.md) doc.

# Related Docs and Repositories

* @forcedotcom/cli-packages - Base Salesforce CLI command
* @forcedotcom/sfdx-plugin-generate - The generator plugin for building plugins for the Salesforce CLI

# [cli-packages](https://github.com/forcedotcom/cli-packages)/[packages](https://github.com/forcedotcom/cli-packages/tree/develop/packages)/command/

# Description

This is the base command class for Salesforce CLI. Extend this class for convenient access to common Salesforce CLI parameters, a logger, CLI output formatting, scratch orgs, and Dev Hubs. This class extends [@oclif/command](https://github.com/oclif/command) and is available within a plug-in generated by Salesforce Plug-In Generator.

# Usage

## Check Your Salesforce CLI Version

Commands that extend `SfdxCommand` can only be used with Salesforce CLI version 6.8.2 or later. To check your Salesforce CLI version:

```
`$ sfdx --version`
```

## Features

To learn more about the features of the Command Library see the **[Salesforce CLI Plug-In Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_plugins.meta/sfdx_cli_plugins/cli_plugins.htm) **

## Contributing 

If you are interested in contributing, please take a look at the [CONTRIBUTING](https://github.com/forcedotcom/cli-packages/blob/develop/CONTRIBUTING.md) guide.

# Related Docs and Repositories

* @forcedotcom/cli-packages - Base Salesforce CLI command
* @forcedotcom/sfdx-plugin-generate - The generator plugin for building plugins for the Salesforce CLI
* [@oclif/command](https://github.com/oclif/command) - Base command for oclif
