/**
 * Philips Hue Lights Skill.
 *
 * Controls Philips Hue lights via the Hue Remote API.
 * Supports: list, status, on/off, brightness, color (xy), color temp, alert, by ID or room.
 */

import * as https from "https";
import type { SkillManifest, SkillProvider, SkillConfig, SkillFactory } from "../../src/skills/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  expiresAt: number;
}

interface LightInfo {
  id: string;
  name: string;
  type: string;
  on: boolean;
  brightness: number;
  reachable: boolean;
  colorMode?: string;
  xy?: [number, number];
  ct?: number;
  room?: string;
}

interface LightStateUpdate {
  on?: boolean;
  bri?: number;
  xy?: [number, number];
  ct?: number;
  alert?: "none" | "select" | "lselect";
  transitiontime?: number;
}

// Room-to-light-ID mapping
const ROOM_LIGHTS: Record<string, number[]> = {
  "family room": [1, 2, 3],
  "ambiance": [12, 13, 14],
  "office": [24],
  "master bedroom": [8, 9],
  "dining": [25, 26, 27],
  "table": [18],
  "stairs": [19, 20, 21, 22, 23],
  "bathroom": [29, 30, 31],
  "all": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 29, 30, 31],
};

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

class HueLightsSkill implements SkillProvider {
  readonly manifest: SkillManifest;
  private tokens: TokenSet = { accessToken: "", refreshToken: "", clientId: "", clientSecret: "", expiresAt: 0 };

  constructor(manifest: SkillManifest) {
    this.manifest = manifest;
  }

  async initialize(config: SkillConfig): Promise<void> {
    this.tokens = {
      accessToken: config.accessToken as string,
      refreshToken: config.refreshToken as string,
      clientId: config.clientId as string,
      clientSecret: config.clientSecret as string,
      expiresAt: Date.now() + 30 * 60 * 1000,
    };
  }

  getCapability(name: string): ((...args: unknown[]) => Promise<unknown>) | null {
    const caps: Record<string, (...args: unknown[]) => Promise<unknown>> = {
      "lights-list": () => this.listLights(),
      "light-status": (id: unknown) => this.getLightStatus(id as string),
      "light-set-state": (id: unknown, state: unknown) =>
        this.setLightState(id as string, state as LightStateUpdate),
      "lights-set-room": (room: unknown, state: unknown) =>
        this.setRoomState(room as string, state as LightStateUpdate),
    };
    return caps[name] ?? null;
  }

  listCapabilities(): string[] {
    return ["lights-list", "light-status", "light-set-state", "lights-set-room"];
  }

  async dispose(): Promise<void> {}

  // ── Token refresh ─────────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    if (Date.now() < this.tokens.expiresAt - 60_000) {
      return this.tokens.accessToken;
    }
    const basicAuth = Buffer.from(`${this.tokens.clientId}:${this.tokens.clientSecret}`).toString("base64");
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.tokens.refreshToken)}`;

    const resp = await httpsRequest(
      "https://api.meethue.com/v2/oauth2/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body).toString(),
        },
      },
      body
    );

    if (resp.status !== 200) {
      throw new Error(`Hue token refresh failed (${resp.status}): ${resp.data}`);
    }
    const json = JSON.parse(resp.data);
    this.tokens.accessToken = json.access_token;
    this.tokens.expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    if (json.refresh_token) this.tokens.refreshToken = json.refresh_token;
    return this.tokens.accessToken;
  }

  // ── Hue API helpers ───────────────────────────────────────────

  private async hueGet(path: string): Promise<unknown> {
    const token = await this.ensureToken();
    const resp = await httpsRequest(
      `https://api.meethue.com/route/api/0${path}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } }
    );
    if (resp.status !== 200) {
      throw new Error(`Hue GET ${path} failed (${resp.status}): ${resp.data}`);
    }
    return JSON.parse(resp.data);
  }

  private async huePut(path: string, body: Record<string, unknown>): Promise<unknown> {
    const token = await this.ensureToken();
    const bodyStr = JSON.stringify(body);
    const resp = await httpsRequest(
      `https://api.meethue.com/route/api/0${path}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr).toString(),
        },
      },
      bodyStr
    );
    if (resp.status !== 200) {
      throw new Error(`Hue PUT ${path} failed (${resp.status}): ${resp.data}`);
    }
    return JSON.parse(resp.data);
  }

  // ── Capabilities ──────────────────────────────────────────────

  private async listLights(): Promise<LightInfo[]> {
    const data = await this.hueGet("/lights") as Record<string, {
      name: string;
      type: string;
      state: {
        on: boolean;
        bri: number;
        reachable: boolean;
        colormode?: string;
        xy?: [number, number];
        ct?: number;
      };
    }>;

    // Reverse-map IDs to rooms
    const idToRoom: Record<string, string> = {};
    for (const [room, ids] of Object.entries(ROOM_LIGHTS)) {
      if (room === "all") continue;
      for (const id of ids) idToRoom[String(id)] = room;
    }

    return Object.entries(data).map(([id, light]) => ({
      id,
      name: light.name,
      type: light.type,
      on: light.state.on,
      brightness: light.state.bri,
      reachable: light.state.reachable,
      colorMode: light.state.colormode,
      xy: light.state.xy,
      ct: light.state.ct,
      room: idToRoom[id],
    }));
  }

  private async getLightStatus(id: string): Promise<LightInfo> {
    const data = await this.hueGet(`/lights/${id}`) as {
      name: string;
      type: string;
      state: {
        on: boolean;
        bri: number;
        reachable: boolean;
        colormode?: string;
        xy?: [number, number];
        ct?: number;
      };
    };

    return {
      id,
      name: data.name,
      type: data.type,
      on: data.state.on,
      brightness: data.state.bri,
      reachable: data.state.reachable,
      colorMode: data.state.colormode,
      xy: data.state.xy,
      ct: data.state.ct,
    };
  }

  private async setLightState(id: string, state: LightStateUpdate): Promise<{ id: string; result: unknown }> {
    const result = await this.huePut(`/lights/${id}/state`, state as Record<string, unknown>);
    return { id, result };
  }

  private async setRoomState(room: string, state: LightStateUpdate): Promise<{ room: string; results: Array<{ id: string; result: unknown }> }> {
    const roomKey = room.toLowerCase();
    const ids = ROOM_LIGHTS[roomKey];
    if (!ids) {
      throw new Error(`Unknown room "${room}". Available: ${Object.keys(ROOM_LIGHTS).filter(r => r !== "all").join(", ")}`);
    }

    const results = await Promise.all(
      ids.map(async (id) => {
        const result = await this.huePut(`/lights/${id}/state`, state as Record<string, unknown>);
        return { id: String(id), result };
      })
    );

    return { room: roomKey, results };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const createSkill: SkillFactory = (manifest) => new HueLightsSkill(manifest);
export default createSkill;
export { createSkill, HueLightsSkill };
