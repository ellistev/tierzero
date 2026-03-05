/* eslint-disable @typescript-eslint/no-var-requires */
import fs from "fs";
import https from "https";
import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import cors from "cors";
import bodyParser from "body-parser";
const jsonParser = bodyParser.json;
import { createRequire } from "module";
const __require = createRequire(import.meta.url);
const rfs = __require("rotating-file-stream").createStream;
import {merge} from "./utils/index.js";

const DEFAULT_LIMIT = 5 * 1024 * 1024; // 5MB

/**
 * Initialize Web (REST-only, no GraphQL)
 * @param {Object} services Services registry
 * @param {Array} controllerFactories
 */
export async function initWeb(services, controllerFactories) {
  const {atexit, config, version, logger} = services;
  const {http: httpConfig} = config;
  if (!httpConfig) {
    throw new Error('Missing "http" config section.');
  }

  if (httpConfig.logPath) {
    await fs.promises.mkdir(path.resolve(httpConfig.logPath), {recursive: true});
  }

  const app = express();
  app.enable('trust proxy');
  
  if (httpConfig.accessLogFilename) {
    app.use(accessLogger({
      logPath: httpConfig.logPath,
      logFilename: httpConfig.accessLogFilename,
      logFormat: httpConfig.accessLogFormat
    }));
  }
  
  app.use(cors({origin: true, credentials: true}));
  app.use(cookieParser());
  app.use(jsonParser({limit: DEFAULT_LIMIT}));

  if (httpConfig.requestLogFilename) {
    app.use(requestLogger({
      logPath: httpConfig.logPath,
      logFilename: httpConfig.requestLogFilename
    }));
  }

  services.app = app;

  // Health/status endpoint
  if ("subscriber" in services) {
    const {subscriber} = services;
    let ready = subscriber.isLive();
    subscriber.once('catchUpCompleted', () => ready = true);
    app.get('/api/status', (req, res) => {
      res.status(200).json({
        ready,
        version
      });
    });
    app.use((req, res, next) => {
      if (!ready) return res.status(503).end('App is not ready.');
      next();
    });
  } else {
    app.get('/api/status', (req, res) => {
      res.status(200).json({
        ready: true,
        version
      });
    });
  }

  // Register all controllers
  for (const controllerFactory of controllerFactories) {
    controllerFactory(services);
  }

  // Error handler
  app.use((err, req, res, next) => {
    logger.error("Unhandled error in express routing:", err.stack);
    if (res.headersSent) {
      return next(err);
    }
    res.status(500).json({message: err.message});
  });

  function listening() {
    logger.info('App ready and listening on port', httpConfig.httpPort);
  }

  let server;
  if (httpConfig.useHttps) {
    const key = await fs.promises.readFile(httpConfig.keyFile);
    const cert = await fs.promises.readFile(httpConfig.certFile);
    server = https.createServer({
      key: key,
      cert: cert
    }, app).listen(httpConfig.httpPort, listening);
  } else {
    server = app.listen(httpConfig.httpPort, listening);
  }
  
  // Expose HTTP server on services so WebSocket servers can be attached
  services.server = server;
  
  atexit(async function() {
    logger.info("Closing web server...");
    await new Promise(resolve => server.close(resolve));
    logger.info("Web server closed.");
  });
}

function accessLogger(options = {}) {
  const logPath = options.logPath || "/tmp";
  const logFilename = options.logFilename || "access.log";
  const logFormat = options.logFormat || "common";
  const stream = rfs(logFilename, {path: logPath, interval: '1d'});
  return morgan(logFormat, {stream});
}

const keysToObfuscate = ["password", "refresh_token"];

function requestLogger(options = {}) {
  const logPath = options.logPath || "/tmp";
  const logFilename = options.logFilename || "requests.log";
  const stream = rfs(logFilename, {path: logPath, interval: '1d'});
  return function(req, res, next) {
    if (req.method !== 'POST') return next();
    const ts = new Date().toISOString();
    const request = JSON.stringify(req.body, (key, value) => keysToObfuscate.includes(key) ? "<obfuscated>" : value);
    const oldJson = res.json;
    const oldEnd = res.end;
    let logged = false;
    res.json = function(obj) {
      const response = JSON.stringify(obj, (key, value) => keysToObfuscate.includes(key) ? "<obfuscated>" : value);
      stream.write([ts, req.url, request, response].join(' ') + '\n');
      logged = true;
      oldJson.apply(res, arguments);
    };
    res.end = function() {
      if (!logged) {
        stream.write([ts, req.url, request, '<not json>'].join(' ') + '\n');
      }
      oldEnd.apply(res, arguments);
    };
    next();
  };
}

export default initWeb;
