/**
 * Nest Thermostat Skill.
 *
 * Controls Google Nest thermostat via the Smart Device Management (SDM) API.
 * Supports: status, temperature set, mode, eco, fan.
 */

import * as https from "https";
import type { SkillManifest, SkillProvider, SkillConfig, SkillFactory } from "../../src/skills/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface ThermostatStatus {
  deviceId: string;
  displayName: string;
  mode: string;
  ecoMode: string;
  ambientTemperatureC: number | null;
  heatSetpointC: number | null;
  coolSetpointC: number | null;
  ecoHeatC: number | null;
  ecoCoolC: number | null;
  fanStatus: string;
  fanTimerMode: string;
  humidity: number | null;
  connectivity: string;
}

// ---------------------------------------------------------------------------
// HTTPS helpers (no external deps)
// ---------------------------------------------------------------------------

function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body?: string
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, data: Buffer.concat(chunks).toString() });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Skill Implementation
// ---------------------------------------------------------------------------

class NestThermostatSkill implements SkillProvider {
  readonly manifest: SkillManifest;
  private projectId = "";
  private clientId = "";
  private clientSecret = "";
  private tokens: TokenSet = { accessToken: "", refreshToken: "", expiresAt: 0 };
  private deviceId: string | null = null;

  constructor(manifest: SkillManifest) {
    this.manifest = manifest;
  }

  async initialize(config: SkillConfig): Promise<void> {
    this.projectId = config.projectId as string;
    this.clientId = config.clientId as string;
    this.clientSecret = config.clientSecret as string;
    this.tokens = {
      accessToken: config.accessToken as string,
      refreshToken: config.refreshToken as string,
      expiresAt: Date.now() + 30 * 60 * 1000, // assume 30 min from now
    };
  }

  getCapability(name: string): ((...args: unknown[]) => Promise<unknown>) | null {
    const caps: Record<string, (...args: unknown[]) => Promise<unknown>> = {
      "thermostat-status": () => this.getStatus(),
      "thermostat-set-temperature": (heatC: unknown, coolC?: unknown) =>
        this.setTemperature(heatC as number, coolC as number | undefined),
      "thermostat-set-mode": (mode: unknown) => this.setMode(mode as string),
      "thermostat-set-eco": (eco: unknown) => this.setEco(eco as string),
      "thermostat-set-fan": (on: unknown, durationSec?: unknown) =>
        this.setFan(on as boolean, durationSec as number | undefined),
    };
    return caps[name] ?? null;
  }

  listCapabilities(): string[] {
    return ["thermostat-status", "thermostat-set-temperature", "thermostat-set-mode", "thermostat-set-eco", "thermostat-set-fan"];
  }

  async dispose(): Promise<void> {
    this.deviceId = null;
  }

  // ── Token refresh ─────────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    if (Date.now() < this.tokens.expiresAt - 60_000) {
      return this.tokens.accessToken;
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.tokens.refreshToken,
      grant_type: "refresh_token",
    }).toString();

    const resp = await httpsRequest(
      "https://www.googleapis.com/oauth2/v4/token",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body).toString() } },
      body
    );

    if (resp.status !== 200) {
      throw new Error(`Token refresh failed (${resp.status}): ${resp.data}`);
    }
    const json = JSON.parse(resp.data);
    this.tokens.accessToken = json.access_token;
    this.tokens.expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    if (json.refresh_token) this.tokens.refreshToken = json.refresh_token;
    return this.tokens.accessToken;
  }

  // ── SDM API helpers ───────────────────────────────────────────

  private async sdmGet(path: string): Promise<unknown> {
    const token = await this.ensureToken();
    const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${this.projectId}${path}`;
    const resp = await httpsRequest(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status !== 200) {
      throw new Error(`SDM GET ${path} failed (${resp.status}): ${resp.data}`);
    }
    return JSON.parse(resp.data);
  }

  private async sdmCommand(devicePath: string, command: string, params: Record<string, unknown>): Promise<unknown> {
    const token = await this.ensureToken();
    const url = `https://smartdevicemanagement.googleapis.com/v1/${devicePath}:executeCommand`;
    const body = JSON.stringify({ command, params });
    const resp = await httpsRequest(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body).toString(),
      },
    }, body);
    if (resp.status !== 200) {
      throw new Error(`SDM command ${command} failed (${resp.status}): ${resp.data}`);
    }
    return JSON.parse(resp.data);
  }

  private async findThermostat(): Promise<string> {
    if (this.deviceId) return this.deviceId;
    const result = await this.sdmGet("/devices") as { devices: Array<{ name: string; type: string }> };
    const thermostat = result.devices.find((d) =>
      d.type === "sdm.devices.types.THERMOSTAT"
    );
    if (!thermostat) throw new Error("No thermostat found in SDM devices");
    this.deviceId = thermostat.name;
    return this.deviceId;
  }

  // ── Capabilities ──────────────────────────────────────────────

  private async getStatus(): Promise<ThermostatStatus> {
    const deviceName = await this.findThermostat();
    const device = await this.sdmGet(`/devices/${deviceName.split("/").pop()}`) as {
      name: string;
      traits: Record<string, Record<string, unknown>>;
      parentRelations?: Array<{ displayName: string }>;
    };
    const t = device.traits;

    return {
      deviceId: device.name,
      displayName: device.parentRelations?.[0]?.displayName ?? "Thermostat",
      mode: (t["sdm.devices.traits.ThermostatMode"]?.mode as string) ?? "unknown",
      ecoMode: (t["sdm.devices.traits.ThermostatEco"]?.mode as string) ?? "unknown",
      ambientTemperatureC: (t["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius as number) ?? null,
      heatSetpointC: (t["sdm.devices.traits.ThermostatTemperatureSetpoint"]?.heatCelsius as number) ?? null,
      coolSetpointC: (t["sdm.devices.traits.ThermostatTemperatureSetpoint"]?.coolCelsius as number) ?? null,
      ecoHeatC: (t["sdm.devices.traits.ThermostatEco"]?.heatCelsius as number) ?? null,
      ecoCoolC: (t["sdm.devices.traits.ThermostatEco"]?.coolCelsius as number) ?? null,
      fanStatus: (t["sdm.devices.traits.Fan"]?.timerMode as string) ?? "unknown",
      fanTimerMode: (t["sdm.devices.traits.Fan"]?.timerMode as string) ?? "OFF",
      humidity: (t["sdm.devices.traits.Humidity"]?.ambientHumidityPercent as number) ?? null,
      connectivity: (t["sdm.devices.traits.Connectivity"]?.status as string) ?? "unknown",
    };
  }

  private async setTemperature(heatC: number, coolC?: number): Promise<{ success: boolean; command: string }> {
    const deviceName = await this.findThermostat();
    if (coolC !== undefined) {
      await this.sdmCommand(deviceName, "sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange", {
        heatCelsius: heatC,
        coolCelsius: coolC,
      });
      return { success: true, command: `SetRange heat=${heatC}C cool=${coolC}C` };
    }
    await this.sdmCommand(deviceName, "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat", {
      heatCelsius: heatC,
    });
    return { success: true, command: `SetHeat ${heatC}C` };
  }

  private async setMode(mode: string): Promise<{ success: boolean; mode: string }> {
    const validModes = ["HEAT", "COOL", "HEATCOOL", "OFF"];
    const upper = mode.toUpperCase();
    if (!validModes.includes(upper)) {
      throw new Error(`Invalid mode "${mode}". Must be one of: ${validModes.join(", ")}`);
    }
    const deviceName = await this.findThermostat();
    await this.sdmCommand(deviceName, "sdm.devices.commands.ThermostatMode.SetMode", { mode: upper });
    return { success: true, mode: upper };
  }

  private async setEco(eco: string): Promise<{ success: boolean; eco: string }> {
    const validEco = ["MANUAL_ECO", "OFF"];
    const upper = eco.toUpperCase();
    if (!validEco.includes(upper)) {
      throw new Error(`Invalid eco mode "${eco}". Must be one of: ${validEco.join(", ")}`);
    }
    const deviceName = await this.findThermostat();
    await this.sdmCommand(deviceName, "sdm.devices.commands.ThermostatEco.SetMode", { mode: upper });
    return { success: true, eco: upper };
  }

  private async setFan(on: boolean, durationSec?: number): Promise<{ success: boolean; fan: string }> {
    const deviceName = await this.findThermostat();
    const timerMode = on ? "ON" : "OFF";
    const params: Record<string, unknown> = { timerMode };
    if (on && durationSec) {
      params.duration = `${durationSec}s`;
    }
    await this.sdmCommand(deviceName, "sdm.devices.commands.Fan.SetTimer", params);
    return { success: true, fan: timerMode };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const createSkill: SkillFactory = (manifest) => new NestThermostatSkill(manifest);
export default createSkill;
export { createSkill, NestThermostatSkill };
