import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('package exports', () => {
  it('exports all core orchestrator classes', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.TaskRouter, 'function');
    assert.equal(typeof mod.AgentRegistry, 'function');
    assert.equal(typeof mod.AgentSupervisor, 'function');
  });

  it('exports agent classes', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.ClaudeCodeAgent, 'function');
    assert.equal(typeof mod.ManagedClaudeCodeAgent, 'function');
    assert.equal(typeof mod.ManagedCodexAgent, 'function');
  });

  it('exports all connector classes', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.GitHubConnector, 'function');
    assert.equal(typeof mod.JiraConnector, 'function');
    assert.equal(typeof mod.ServiceNowConnector, 'function');
    assert.equal(typeof mod.GitLabConnector, 'function');
    assert.equal(typeof mod.FreshdeskConnector, 'function');
    assert.equal(typeof mod.ZendeskConnector, 'function');
  });

  it('exports communication classes', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.NotificationManager, 'function');
    assert.equal(typeof mod.SlackChannel, 'function');
    assert.equal(typeof mod.EmailChannel, 'function');
    assert.equal(typeof mod.DiscordChannel, 'function');
    assert.equal(typeof mod.WebhookChannel, 'function');
    assert.equal(typeof mod.TelegramChannel, 'function');
  });

  it('exports deploy classes', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.SSHDeployer, 'function');
    assert.equal(typeof mod.HealthChecker, 'function');
  });

  it('exports knowledge classes', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.InMemoryKnowledgeStore, 'function');
    assert.equal(typeof mod.ChromaKnowledgeStore, 'function');
    assert.equal(typeof mod.createKnowledgeStore, 'function');
    assert.equal(typeof mod.LLMKnowledgeExtractor, 'function');
  });

  it('exports monitoring classes', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.HealthAggregator, 'function');
    assert.equal(typeof mod.AlertEngine, 'function');
    assert.equal(typeof mod.MetricsCollector, 'function');
  });

  it('exports scheduler', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.Scheduler, 'function');
  });

  it('exports infrastructure', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.EventBus, 'function');
  });

  it('exports PR reviewer', async () => {
    const mod = await import('./index');
    assert.equal(typeof mod.PRReviewer, 'function');
  });
});
