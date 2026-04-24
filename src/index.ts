// Core - Orchestrator
export { TaskRouter } from './orchestrator/task-router';
export type { TaskRouterConfig } from './orchestrator/task-router';
export { AgentRegistry } from './orchestrator/agent-registry';
export type { NormalizedTask, TaskResult, TaskSource, AgentDefinition, AgentUtilization } from './orchestrator/agent-registry';
export { AgentSupervisor } from './orchestrator/supervisor';
export type { AgentHeartbeat, AgentContext, ManagedAgent, AgentProcess, SupervisorConfig } from './orchestrator/supervisor';

// Agents
export { ClaudeCodeAgent } from './workflows/claude-code-agent';
export type { ClaudeCodeAgentConfig } from './workflows/claude-code-agent';
export { ManagedClaudeCodeAgent } from './workflows/managed-claude-code-agent';
export type { ManagedClaudeCodeAgentConfig } from './workflows/managed-claude-code-agent';
export { ManagedCodexAgent } from './workflows/managed-codex-agent';
export type { ManagedCodexAgentConfig } from './workflows/managed-codex-agent';

// Workflows
export type { AutoDeployConfig, PipelineConfig, PipelineLogger, PipelineResult, CodeAgent, IssueContext, CodeAgentResult } from './workflows/issue-pipeline';
export { PRReviewer } from './workflows/pr-reviewer';
export type { PRReviewResult, PRReviewConfig } from './workflows/pr-reviewer';
export type { ReviewFinding, ReviewRule, DiffFile, DiffLine } from './workflows/review-rules';

// Connectors
export { GitHubConnector } from './connectors/github';
export type { GitHubConfig } from './connectors/github';
export { JiraConnector } from './connectors/jira';
export type { JiraConfig } from './connectors/jira';
export { ServiceNowConnector } from './connectors/servicenow';
export type { ServiceNowConfig } from './connectors/servicenow';
export { GitLabConnector } from './connectors/gitlab';
export type { GitLabConfig } from './connectors/gitlab';
export { FreshdeskConnector } from './connectors/freshdesk';
export type { FreshdeskConfig } from './connectors/freshdesk';
export { ZendeskConnector } from './connectors/zendesk';
export type { ZendeskConfig } from './connectors/zendesk';
export type { Ticket, TicketStatus, TicketPriority, TicketType, TicketUser, TicketComment, TicketAttachment, UpdateTicketFields } from './connectors/types';
export type { TicketConnector, HealthCheckResult as ConnectorHealthCheckResult, ListTicketsOptions, ListTicketsResult, AddCommentOptions } from './connectors/connector';

// Communication
export { NotificationManager } from './comms/notification-manager';
export type { NotificationRule, NotificationRecord } from './comms/notification-manager';
export type { CommChannel, CommMessage, CommAttachment, CommResult } from './comms/channel';
export { SlackChannel } from './comms/channels/slack';
export type { SlackChannelConfig } from './comms/channels/slack';
export { EmailChannel } from './comms/channels/email';
export type { EmailChannelConfig } from './comms/channels/email';
export { DiscordChannel } from './comms/channels/discord';
export type { DiscordChannelConfig } from './comms/channels/discord';
export { WebhookChannel } from './comms/channels/webhook';
export type { WebhookChannelConfig } from './comms/channels/webhook';
export { TelegramChannel } from './comms/channels/telegram';
export type { TelegramChannelConfig } from './comms/channels/telegram';

// Deploy
export { SSHDeployer } from './deploy/strategies/ssh';
export { HealthChecker } from './deploy/health-checker';
export type { HealthCheckOptions, WaitOptions, HealthCheckResult as DeployHealthCheckResult, HealthCheckFetcher } from './deploy/health-checker';
export type { Deployer, DeployConfig, DeployResult, DeployOptions, DeployStatus } from './deploy/deployer';

// Knowledge
export { InMemoryKnowledgeStore } from './knowledge/in-memory-store';
export { ChromaKnowledgeStore } from './knowledge/chroma-store';
export { createKnowledgeStore } from './knowledge/factory';
export type { KnowledgeStore, KnowledgeEntry, KnowledgeScope, SearchOptions, KnowledgeStats } from './knowledge/store';
export type { KnowledgeStoreConfig } from './knowledge/factory';
export { LLMKnowledgeExtractor } from './knowledge/extractor';
export type { ExtractionContext, KnowledgeExtractor } from './knowledge/extractor';
export { createKnowledgeExtractor } from './knowledge/extractor-factory';
export type { KnowledgeExtractorFactoryConfig } from './knowledge/extractor-factory';

// Monitoring
export { HealthAggregator } from './monitoring/health-aggregator';
export type { ComponentHealth, SystemHealth, ComponentChecker, HealthAggregatorDeps } from './monitoring/health-aggregator';
export { AlertEngine } from './monitoring/alert-engine';
export type { ActiveAlert, AlertRule, AlertCondition } from './monitoring/alert-engine';
export { MetricsCollector } from './monitoring/metrics';
export type { MetricDataPoint, MetricQueryOptions } from './monitoring/metrics';

// Scheduler
export { Scheduler } from './scheduler/scheduler';
export type { ScheduledJob, JobInput } from './scheduler/scheduler';

// Infrastructure
export { EventBus } from './infra/event-bus';
