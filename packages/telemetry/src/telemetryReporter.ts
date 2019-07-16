'use strict';

import { Logger } from '@salesforce/core';
import { AsyncCreatable } from '@salesforce/kit';
import * as appInsights from 'applicationinsights';
import * as _ from 'lodash';
import * as os from 'os';
import * as process from 'process';

type Properties = {
  [key: string]: string;
};

type Measurements = {
  [key: string]: number;
};

type Attributes = {
  [key: string]: string | number | undefined;
};

export interface TelemetryOptions {
  project: string;
  key: string;
  commonProperties?: Properties;
  contextTags?: Properties;
}

export default class TelemetryReporter extends AsyncCreatable<TelemetryOptions> {
  private static ASIMOV_ENDPOINT = 'https://vortex.data.microsoft.com/collect/v1';
  public appInsightsClient: appInsights.TelemetryClient | undefined;
  private options: TelemetryOptions;
  private logger!: Logger;

  constructor(options: TelemetryOptions) {
    super(options);
    this.options = options;
  }

  public async init(): Promise<void> {
    this.logger = await Logger.child('telemetry');
    this.createAppInsightsClient();
  }

  /**
   * Publishes event to app insights dashboard
   * @param eventName {string} - name of the event you want published. Will be concatenated with this.options.project
   * @param attributes {Attributes} - map of properties to publish alongside the event.
   */
  public sendTelemetryEvent(eventName: string, attributes: Attributes = {}): void {
    if (this.appInsightsClient) {
      const name = `${this.options.project}/${eventName}`;
      const { properties, measurements } = buildPropertiesAndMeasurements(attributes);
      this.logger.debug(`Sending telemetry event: ${name}`);
      this.appInsightsClient.trackEvent({ name, properties, measurements });
      this.appInsightsClient.flush();
    } else {
      this.logger.warn('Failed to send telemetry event because appInsightsClient does not exist');
    }
  }

  /**
   * Initiates the app insights client
   */
  private createAppInsightsClient(): void {
    if (appInsights.defaultClient) {
      this.logger.debug('appInsightsClient already exists');
      this.appInsightsClient = new appInsights.TelemetryClient(this.options.key);
      this.appInsightsClient.channel.setUseDiskRetryCaching(true);
    } else {
      this.logger.debug('creating appInsightsClient');
      appInsights
        .setup(this.options.key)
        .setAutoCollectRequests(false)
        .setAutoCollectPerformance(false)
        .setAutoCollectExceptions(false)
        .setAutoCollectDependencies(false)
        .setAutoDependencyCorrelation(false)
        .setAutoCollectConsole(false)
        .setUseDiskRetryCaching(true)
        .start();
      this.appInsightsClient = appInsights.defaultClient;
    }

    this.appInsightsClient.commonProperties = this.buildCommonProperties();
    this.appInsightsClient.context.tags = this.buildContextTags();

    if (isAsimovKey(this.options.key)) {
      this.appInsightsClient.config.endpointUrl = TelemetryReporter.ASIMOV_ENDPOINT;
    }
  }

  /**
   * Builds the properties to send with every event
   * @return {Properties} map of base properites and properties provided when class was created
   */
  private buildCommonProperties(): Properties {
    const baseProperties: Properties = {
      'common.cpus': getCpus(),
      'common.os': os.platform(),
      'common.platformversion': getPlatformVersion(),
      'common.systemmemory': getSystemMemory(),
      'common.usertype': process.env['USER_TYPE'] || 'normal'
    };
    return Object.assign(baseProperties, this.options.commonProperties);
  }

  /**
   * Builds the context tags for appInsightsClient
   * @return {Properties} map of tags to add to this.appInsightsClient.context.tags
   */
  private buildContextTags(): Properties {
    const currentTags = this.appInsightsClient ? this.appInsightsClient.context.tags : {};
    return Object.assign({}, currentTags, this.options.contextTags);
  }
}

export function buildPropertiesAndMeasurements(attributes: Attributes) {
  const properties: Properties = {};
  const measurements: Measurements = {};
  _.forEach(attributes, (value, key) => {
    if (typeof value === 'string') {
      properties[key] = value;
    } else if (typeof value === 'number') {
      measurements[key] = value;
    }
  });
  return { properties, measurements };
}

function getPlatformVersion(): string {
  return (os.release() || '').replace(/^(\d+)(\.\d+)?(\.\d+)?(.*)/, '$1$2$3');
}

function getCpus(): string {
  const cpus = os.cpus();
  if (cpus && cpus.length > 0) {
    return `${cpus[0].model}(${cpus.length} x ${cpus[0].speed})`;
  } else {
    return '';
  }
}

function getSystemMemory(): string {
  return `${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isAsimovKey(key: string): boolean {
  return !!(key && key.indexOf('AIF-') === 0);
}
