/**
 * Nest Camera Skill.
 *
 * Controls Google Nest cameras and doorbells via the Smart Device Management API.
 * Supports: list cameras, status, live stream URLs, event info (stub).
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

interface CameraInfo {
  deviceId: string;
  displayName: string;
  type: string;
  hasLiveStream: boolean;
  hasEventImage: boolean;
  protocols: string[];
  connectivity: string;
}

interface LiveStreamResult {
  deviceId: string;
  streamUrl: string;
  mediaSessionId: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// HTTPS helpers
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

class NestCameraSkill implements SkillProvider {
  readonly manifest: SkillManifest;
  private projectId = "";
  private clientId = "";
  private clientSecret = "";
  private tokens: TokenSet = { accessToken: "", refreshToken: "", expiresAt: 0 };
  private cameras: CameraInfo[] | null = null;

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
      expiresAt: Date.now() + 30 * 60 * 1000,
    };
  }

  getCapability(name: string): ((...args: unknown[]) => Promise<unknown>) | null {
    const caps: Record<string, (...args: unknown[]) => Promise<unknown>> = {
      "camera-list": () => this.listCameras(),
      "camera-status": (deviceId: unknown) => this.getCameraStatus(deviceId as string),
      "camera-livestream": (deviceId: unknown) => this.generateLiveStream(deviceId as string),
      "camera-events": (deviceId: unknown) => this.getRecentEvents(deviceId as string),
    };
    return caps[name] ?? null;
  }

  listCapabilities(): string[] {
    return ["camera-list", "camera-status", "camera-livestream", "camera-events"];
  }

  async dispose(): Promise<void> {
    this.cameras = null;
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

  private async sdmCommand(devicePath: string, command: string, params: Record<string, unknown> = {}): Promise<unknown> {
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

  // ── Capabilities ──────────────────────────────────────────────

  private async listCameras(): Promise<CameraInfo[]> {
    const result = await this.sdmGet("/devices") as {
      devices: Array<{
        name: string;
        type: string;
        traits: Record<string, Record<string, unknown>>;
        parentRelations?: Array<{ displayName: string }>;
      }>;
    };

    const cameraTypes = [
      "sdm.devices.types.CAMERA",
      "sdm.devices.types.DOORBELL",
      "sdm.devices.types.DISPLAY",
    ];

    this.cameras = result.devices
      .filter((d) => cameraTypes.includes(d.type))
      .map((d) => {
        const liveStream = d.traits["sdm.devices.traits.CameraLiveStream"];
        const protocols = (liveStream?.supportedProtocols as string[]) ?? [];
        return {
          deviceId: d.name,
          displayName: d.parentRelations?.[0]?.displayName ?? d.type.split(".").pop() ?? "Camera",
          type: d.type.split(".").pop() ?? "CAMERA",
          hasLiveStream: !!liveStream,
          hasEventImage: !!d.traits["sdm.devices.traits.CameraEventImage"],
          protocols,
          connectivity: (d.traits["sdm.devices.traits.Connectivity"]?.status as string) ?? "unknown",
        };
      });

    return this.cameras;
  }

  private async getCameraStatus(deviceId: string): Promise<CameraInfo> {
    const devicePath = deviceId.includes("/") ? deviceId.split("/").pop()! : deviceId;
    const device = await this.sdmGet(`/devices/${devicePath}`) as {
      name: string;
      type: string;
      traits: Record<string, Record<string, unknown>>;
      parentRelations?: Array<{ displayName: string }>;
    };

    const liveStream = device.traits["sdm.devices.traits.CameraLiveStream"];
    const protocols = (liveStream?.supportedProtocols as string[]) ?? [];
    return {
      deviceId: device.name,
      displayName: device.parentRelations?.[0]?.displayName ?? "Camera",
      type: device.type.split(".").pop() ?? "CAMERA",
      hasLiveStream: !!liveStream,
      hasEventImage: !!device.traits["sdm.devices.traits.CameraEventImage"],
      protocols,
      connectivity: (device.traits["sdm.devices.traits.Connectivity"]?.status as string) ?? "unknown",
    };
  }

  private async generateLiveStream(deviceId: string): Promise<LiveStreamResult> {
    const result = await this.sdmCommand(
      deviceId,
      "sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream",
      { offerSdp: "v=0\r\n" } // minimal SDP offer; real client provides full offer
    ) as {
      results: {
        answerSdp: string;
        mediaSessionId: string;
        expiresAt: string;
      };
    };

    return {
      deviceId,
      streamUrl: result.results.answerSdp,
      mediaSessionId: result.results.mediaSessionId,
      expiresAt: result.results.expiresAt,
    };
  }

  private async getRecentEvents(deviceId: string): Promise<{ deviceId: string; note: string }> {
    // Event subscription requires Pub/Sub setup - stub for demo
    return {
      deviceId,
      note: "Event subscription requires Google Cloud Pub/Sub configuration. " +
            "In production, subscribe to events via projects/{project}/subscriptions/{sub} " +
            "for person/motion/sound detection from cameras and doorbells.",
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const createSkill: SkillFactory = (manifest) => new NestCameraSkill(manifest);
export default createSkill;
export { createSkill, NestCameraSkill };
