import { ConfigAggregator, Logger, Messages, SfdxError } from '@salesforce/core';
import { AsyncCreatable, Duration, Env, sleep } from '@salesforce/kit';
import * as appInsights from 'applicationinsights';
import {
  EventTelemetry,
  ExceptionTelemetry,
  MetricTelemetry,
  TraceTelemetry
} from 'applicationinsights/out/Declarations/Contracts';
import { ChildProcess, fork } from 'child_process';
import * as os from 'os';
import * as path from 'path';

const MODULE_PATH = path.resolve(path.join(__dirname, './telemetryChildProcess.js'));

const DISABLE_TELEMETRY = 'disableTelemetry';

type Properties = {
  [key: string]: string;
};

type Measurements = {
  [key: string]: number;
};

type Attributes = {
  [key: string]: string | number | undefined;
};

type TelemetryData = EventTelemetry | ExceptionTelemetry | MetricTelemetry | TraceTelemetry;

enum TelemetryMethod {
  EVENT = 'trackEvent',
  EXCEPTION = 'trackException',
  METRIC = 'trackMetric',
  TRACE = 'trackTrace'
}

export interface TelemetryOptions {
  project: string;
  key: string;
  commonProperties?: Properties;
  contextTags?: Properties;
  env?: Env;
}

Messages.importMessagesDirectory(__dirname);

export class AppInsights extends AsyncCreatable<TelemetryOptions> {
  public static GDPR_HIDDEN = '<GDPR_HIDDEN>';
  private static ASIMOV_ENDPOINT = 'https://vortex.data.microsoft.com/collect/v1';
  public appInsightsClient: appInsights.TelemetryClient | undefined;
  private options: TelemetryOptions;
  private logger!: Logger;
  private env!: Env;
  private config!: ConfigAggregator;

  constructor(options: TelemetryOptions) {
    super(options);
    this.options = options;
  }

  public async init(): Promise<void> {
    this.logger = await Logger.child('AppInsights');
    this.env = this.options.env || new Env();
    this.config = await ConfigAggregator.create({});
    this.createAppInsightsClient();
  }

  /**
   * Publishes event to app insights dashboard
   * @param eventName {string} - name of the event you want published. Will be concatenated with this.options.project
   * @param attributes {Attributes} - map of properties to publish alongside the event.
   */
  public sendTelemetryEvent(eventName: string, attributes: Attributes = {}): void {
    const name = `${this.options.project}/${eventName}`;
    const { properties, measurements } = buildPropertiesAndMeasurements(attributes);
    this.sendTelemetry(TelemetryMethod.EVENT, name, { name, properties, measurements });
  }

  /**
   * Publishes exception to app insights dashboard
   * @param exception {Error} - exception you want published.
   * @param attributes {Attributes} - map of measurements to publish alongside the exception.
   */
  public sendTelemetryException(exception: Error, attributes: Attributes = {}): void {
    const { properties, measurements } = buildPropertiesAndMeasurements(attributes);
    this.sendTelemetry(TelemetryMethod.EXCEPTION, exception.message, { exception, properties, measurements });
  }

  /**
   * Publishes diagnostic information to app insights dashboard
   * @param message {string} - trace message to sen to app insights.
   * @param properties {Properties} - map of properties to publish alongside the event.
   */
  public sendTelemetryTrace(traceMessage: string, properties?: Properties): void {
    this.sendTelemetry(TelemetryMethod.TRACE, traceMessage, { message: traceMessage, properties });
  }

  /**
   * Publishes metric to app insights dashboard
   * @param name {string} - name of the metric you want published
   * @param value {number} - value of the metric
   * @param properties {Properties} - map of properties to publish alongside the event.
   */
  public sendTelemetryMetric(metricName: string, value: number, properties?: Properties): void {
    this.sendTelemetry(TelemetryMethod.METRIC, metricName, { name: metricName, value, properties });
  }

  private sendTelemetry(method: TelemetryMethod, message: string, data: TelemetryData): void {
    if (!isSfdxTelemetryEnabled(this.config)) return;

    if (this.appInsightsClient) {
      this.logger.debug(`Sending telemetry: ${message}`);
      try {
        switch (method) {
          case TelemetryMethod.EVENT: {
            this.appInsightsClient.trackEvent(data as EventTelemetry);
            break;
          }
          case TelemetryMethod.EXCEPTION: {
            this.appInsightsClient.trackException(data as ExceptionTelemetry);
            break;
          }
          case TelemetryMethod.METRIC: {
            this.appInsightsClient.trackMetric(data as MetricTelemetry);
            break;
          }
          case TelemetryMethod.TRACE: {
            this.appInsightsClient.trackTrace(data as TraceTelemetry);
            break;
          }
        }
        this.appInsightsClient.flush();
      } catch (e) {
        const messages = Messages.loadMessages('@salesforce/telemetry', 'telemetry');
        throw new SfdxError(messages.getMessage('unknownError'), 'unknownError', undefined, undefined, e);
      }
    } else {
      this.logger.warn('Failed to send telemetry data because the appInsightsClient does not exist');
      throw SfdxError.create('@salesforce/telemetry', 'telemetry', 'sendFailed');
    }
  }

  /**
   * Initiates the app insights client
   */
  private createAppInsightsClient(): void {
    logTelemetryStatus(this.logger, this.config);
    if (!isSfdxTelemetryEnabled(this.config)) return;

    this.logger.debug('creating appInsightsClient');

    appInsights
      .setup(this.options.key)
      .setAutoCollectRequests(false)
      .setAutoCollectPerformance(false)
      .setAutoCollectExceptions(false)
      .setAutoCollectDependencies(false)
      .setAutoDependencyCorrelation(false)
      .setAutoCollectConsole(false)
      .setUseDiskRetryCaching(false)
      .setInternalLogging(false, false)
      .start();

    this.appInsightsClient = appInsights.defaultClient;
    this.appInsightsClient.commonProperties = this.buildCommonProperties();
    this.appInsightsClient.context.tags = this.buildContextTags();

    if (isAsimovKey(this.options.key)) {
      this.appInsightsClient.config.endpointUrl = AppInsights.ASIMOV_ENDPOINT;
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
      'common.usertype': this.env.getString('SFDX_USER_TYPE') || 'normal'
    };
    return Object.assign(baseProperties, this.options.commonProperties);
  }

  /**
   * Builds the context tags for appInsightsClient
   * @return {Properties} map of tags to add to this.appInsightsClient.context.tags
   */
  private buildContextTags(): Properties {
    const currentTags = this.appInsightsClient ? this.appInsightsClient.context.tags : {};
    const cleanedTags = this.hideGDPRdata(currentTags);
    return Object.assign({}, cleanedTags, this.options.contextTags);
  }
  // filters out non-GDPR compliant tags
  private hideGDPRdata(tags: Properties) {
    const keys = new appInsights.Contracts.ContextTagKeys();
    const gdprSensitiveKeys = [keys.cloudRoleInstance];
    gdprSensitiveKeys.forEach(key => {
      tags[key] = AppInsights.GDPR_HIDDEN;
    });
    return tags;
  }
}

export class TelemetryReporter extends AsyncCreatable<TelemetryOptions> {
  public static SFDX_INSIGHTS_TIMEOUT = 'SFDX_INSIGHTS_TIMEOUT';
  public forkedProcess!: ChildProcess;
  private modulePath: string = MODULE_PATH;
  private options: TelemetryOptions;
  private logger!: Logger;
  private env!: Env;
  private config!: ConfigAggregator;

  constructor(options: TelemetryOptions) {
    super(options);
    this.options = options;
  }

  public async init(): Promise<void> {
    this.logger = await Logger.child('TelemetryReporter');
    this.env = this.options.env || new Env();
    this.config = await ConfigAggregator.create({});
    this.beginLifecycle();
    // This is used to ensure that the appInsightsClient is running before we start receiving events
    // It's necessary because applicationinsights does not proivide any way to wait for a connection
    // to be made.
    await sleep(Duration.milliseconds(500));
  }

  /**
   * Initializes the module at this.modulePath in a child process.
   */
  public start(): void {
    this.logger.debug('starting child process');
    const args = JSON.stringify(this.options);
    this.forkedProcess = fork(this.modulePath, [args]);
    this.logger.debug(`child process started at PID: ${this.forkedProcess.pid}`);
  }

  /**
   * Immediately kills the child process.
   */
  public stop(): void {
    this.logger.debug('stopping child process');
    this.forkedProcess.kill();
  }

  /**
   * Sends message to child process.
   * @param eventName {string} - name of the event you want published.
   * @param attributes {Attributes} - map of properties to publish alongside the event.
   */
  public sendTelemetryEvent(eventName: string, attributes: Attributes = {}): void {
    this.logger.debug('Received telemetry event');
    if (this.forkedProcess) {
      this.logger.debug('Sending telemetry event to forked process');
      this.forkedProcess.send({ type: 'event', eventName, attributes });
    }
  }

  /**
   * Sends exception to child process.
   * @param exception {Error} - exception you want published.
   * @param measurements {Measurements} - map of measurements to publish alongside the event.
   */
  public sendTelemetryException(exception: Error, attributes: Attributes = {}): void {
    if (this.forkedProcess) {
      this.logger.debug('Sending telemetry exception to forked process');
      this.forkedProcess.send({ type: 'exception', exception, attributes });
    }
  }

  /**
   * Publishes diagnostic information to app insights dashboard
   * @param message {string} - trace message to sen to app insights.
   * @param properties {Properties} - map of properties to publish alongside the event.
   */
  public sendTelemetryTrace(traceMessage: string, properties?: Properties): void {
    if (this.forkedProcess) {
      this.logger.debug('Sending telemetry trace to forked process');
      this.forkedProcess.send({ type: 'trace', traceMessage, properties });
    }
  }

  /**
   * Publishes metric to app insights dashboard
   * @param name {string} - name of the metric you want published
   * @param value {number} - value of the metric
   * @param properties {Properties} - map of properties to publish alongside the event.
   */
  public sendTelemetryMetric(metricName: string, value: number, properties?: Properties): void {
    if (this.forkedProcess) {
      this.logger.debug('Sending telemetry metric to forked process');
      this.forkedProcess.send({ type: 'metric', metricName, value, properties });
    }
  }

  /**
   * Starts the child process, waits, and then stops the child process.
   */
  private beginLifecycle(): void {
    logTelemetryStatus(this.logger, this.config);
    if (!isSfdxTelemetryEnabled(this.config)) return;

    this.start();
    const insightsTimeout =
      Number(this.env.getString(TelemetryReporter.SFDX_INSIGHTS_TIMEOUT)) || Duration.seconds(3).milliseconds;
    this.logger.debug(`Waiting ${insightsTimeout} ms to stop child process`);
    setTimeout(() => {
      this.stop();
      this.logger.debug('Stopped child process');
    }, insightsTimeout);
  }
}

/**
 * Determine if the telemetry event should be logged.
 * Setting the disableTelemetry config var to true will disable insights for errors and diagnostics.
 */
function isSfdxTelemetryEnabled(config: ConfigAggregator): boolean {
  const sfdxDisableInsights = config.getPropertyValue(DISABLE_TELEMETRY);
  const isEnabled = !sfdxDisableInsights;
  return isEnabled;
}

function logTelemetryStatus(logger: Logger, config: ConfigAggregator): void {
  const isEnabled = isSfdxTelemetryEnabled(config);
  if (isEnabled) {
    logger.warn(
      `Telemetry is enabled. This can be disabled by running sfdx force:config:set ${DISABLE_TELEMETRY}=true`
    );
  } else {
    logger.warn(
      `Telemetry is disabled. This can be enabled by running sfdx force:config:set ${DISABLE_TELEMETRY}=false`
    );
  }
}

export function buildPropertiesAndMeasurements(attributes: Attributes) {
  const properties: Properties = {};
  const measurements: Measurements = {};
  Object.keys(attributes).forEach(key => {
    const value = attributes[key];
    if (typeof value === 'string') {
      properties[key] = value;
    } else if (typeof value === 'number') {
      measurements[key] = value;
    }
  });
  return { properties, measurements };
}

export function getPlatformVersion(): string {
  return (os.release() || '').replace(/^(\d+)(\.\d+)?(\.\d+)?(.*)/, '$1$2$3');
}

export function getCpus(): string {
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
