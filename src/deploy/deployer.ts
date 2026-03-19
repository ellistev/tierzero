export interface DeployConfig {
  strategy: 'direct' | 'blue-green' | 'canary';
  healthCheckUrl?: string;
  healthCheckTimeoutMs?: number;
  healthCheckIntervalMs?: number;
  healthCheckRetries?: number;
  rollbackOnFailure: boolean;
  preDeployHook?: string;
  postDeployHook?: string;
}

export interface DeployResult {
  success: boolean;
  deployId: string;
  version: string;
  environment: string;
  deployedAt: string;
  healthCheckPassed: boolean;
  rolledBack: boolean;
  error?: string;
  durationMs: number;
  logs: string[];
}

export interface DeployOptions {
  environment: string;
  version: string;
  config: DeployConfig;
}

export interface DeployStatus {
  environment: string;
  currentVersion: string;
  previousVersion: string;
  lastDeployedAt: string;
  healthy: boolean;
}

export interface Deployer {
  deploy(options: DeployOptions): Promise<DeployResult>;
  rollback(deployId: string): Promise<DeployResult>;
  status(environment: string): Promise<DeployStatus>;
  history(environment: string, limit?: number): Promise<DeployResult[]>;
}
