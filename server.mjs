import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { z } from "zod";
import axios from "axios";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || "";

// 静态文件服务
app.use(BASE_PATH, express.static(join(__dirname, "dist")));

// API路由
app.get(`${BASE_PATH}/api/convert`, async (req, res) => {
  const toString = (value) => {
    if (Array.isArray(value)) return value[0];
    return value;
  };

  const querySchema = z.object({
    url: z.string().url(),
    target: z.enum(["clash", "surge"]).default("clash"),
    ua: z.string().optional(),
  });

  const parsed = querySchema.safeParse({
    url: toString(req.query?.url),
    target: toString(req.query?.target),
    ua: toString(req.query?.ua),
  });

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid query parameters",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { url, target } = parsed.data;
  const userAgent = parsed.data.ua || req.headers?.["user-agent"];

  try {
    const result = await convertFromSubscription(url, target, userAgent);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(result);
  } catch (error) {
    res.status(500).send(`${error}`);
  }
});

// SPA回退
app.get(`${BASE_PATH}/*`, (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// 核心转换逻辑（从 src/core/convert.ts 复制）
async function fetchConfig(url, userAgent) {
  const result = await axios({
    url,
    headers: {
      "User-Agent": userAgent || "clash.meta",
    },
  });
  return (result.data || null);
}

function getConfigType(config) {
  if (config.includes("[Proxy Group]")) {
    return "surge";
  }
  return "clash";
}

function parseClashConfig(config) {
  return YAML.parse(config);
}

async function convertFromSubscription(url, target, userAgent) {
  let configFile = await fetchConfig(url, userAgent);
  if (configFile === null) {
    throw new Error("Unable to get config");
  }
  let source = getConfigType(configFile);

  // Clash to Clash
  if (source === "clash" && target === "clash") {
    let config = parseClashConfig(configFile);
    if (config === null) {
      throw new Error("Unable to parse config");
    }
    if (config.proxies === undefined) {
      throw new Error("No proxies in this config");
    }
    return YAML.stringify({ proxies: config.proxies });
  }

  // Surge to Surge
  if (source === "surge" && target === "surge") {
    const lines = configFile.split(/\r?\n/);
    let inProxySection = false;
    const proxies = [];

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (line.startsWith("[")) {
        inProxySection = line === "[Proxy]";
        return;
      }

      if (!inProxySection) return;
      if (line.length === 0) return;
      if (line.startsWith("#") || line.startsWith(";")) return;

      proxies.push(line);
    });

    if (proxies.length === 0) {
      throw new Error("No proxies in this config");
    }
    return proxies.join("\n");
  }

  // Clash to Surge
  if (source === "clash" && target === "surge") {
    let config = parseClashConfig(configFile);
    if (config === null) {
      throw new Error("Unable to parse config");
    }
    if (config.proxies === undefined) {
      throw new Error("No proxies in this config");
    }
    const intermediates = config.proxies
      .map((p) => clashProxyToIntermediate(p))
      .filter((p) => p !== undefined);

    const surgeLines = intermediates
      .map((obj) => intermediateToSurgeLine(obj))
      .filter((s) => s !== undefined);
    if (surgeLines.length === 0) {
      throw new Error("No supported proxies after conversion");
    }
    return surgeLines.join("\n");
  }

  // Surge to Clash
  if (source === "surge" && target === "clash") {
    const lines = configFile.split(/\r?\n/);
    let inProxySection = false;
    const proxyLines = [];

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (line.startsWith("[")) {
        inProxySection = line === "[Proxy]";
        return;
      }
      if (!inProxySection) return;
      if (line.length === 0) return;
      if (line.startsWith("#") || line.startsWith(";")) return;
      proxyLines.push(line);
    });

    if (proxyLines.length === 0) {
      throw new Error("No proxies in this config");
    }

    const intermediates = proxyLines
      .map((line) => surgeLineToIntermediate(line))
      .filter((p) => p !== undefined);

    if (intermediates.length === 0) {
      throw new Error("No supported proxies after conversion");
    }

    const clashProxies = intermediates
      .map((obj) => intermediateToClashProxy(obj))
      .filter((o) => o !== undefined);

    return YAML.stringify({ proxies: clashProxies });
  }

  throw new Error("Unsupported conversion combination");
}

function clashProxyToIntermediate(proxy) {
  if (!proxy || !proxy.type || !proxy.name || !proxy.server || !proxy.port) {
    return undefined;
  }
  if (!["ss", "vmess", "trojan"].includes(proxy.type)) {
    return undefined;
  }

  if (proxy.type === "ss") {
    if (proxy.plugin === "v2ray-plugin") return undefined;
    const base = {
      name: proxy.name,
      type: "ss",
      server: String(proxy.server),
      port: Number(proxy.port),
    };
    const extras = {
      cipher: proxy.cipher,
      password: proxy.password,
      udp: proxy.udp,
    };
    if (proxy.plugin === "obfs") {
      const mode = proxy?.["plugin-opts"]?.mode;
      const host = proxy?.["plugin-opts"]?.host;
      if (mode === "http" || mode === "tls") {
        extras.obfs = mode;
      }
      if (typeof host === "string" && host.length > 0) {
        extras.obfsHost = host;
      }
    }
    return { ...base, ...extras };
  }

  if (proxy.type === "vmess") {
    if (["h2", "http", "grpc"].includes(proxy.network)) return undefined;
    const base = {
      name: proxy.name,
      type: "vmess",
      server: String(proxy.server),
      port: Number(proxy.port),
    };
    const extras = {
      uuid: proxy.uuid,
      tls: Boolean(proxy.tls),
      serverName: proxy.servername,
      skipCertVerify: Boolean(proxy["skip-cert-verify"]),
      network: proxy.network === "ws" ? "ws" : "tcp",
      wsPath: proxy["ws-path"],
    };
    return { ...base, ...extras };
  }

  if (proxy.type === "trojan") {
    if (proxy.network && proxy.network !== "tcp") return undefined;
    const base = {
      name: proxy.name,
      type: "trojan",
      server: String(proxy.server),
      port: Number(proxy.port),
    };
    const extras = {
      password: proxy.password,
      sni: proxy.sni,
      skipCertVerify: Boolean(proxy["skip-cert-verify"]),
      network: "tcp",
    };
    return { ...base, ...extras };
  }

  return undefined;
}

function intermediateToSurgeLine(obj) {
  const common = `${obj.name} = ${obj.type}, ${obj.server}, ${obj.port}`;

  if (obj.type === "ss") {
    let result = `${common}, encrypt-method=${obj.cipher}, password=${obj.password}`;
    if (obj.obfs) {
      result = `${result}, obfs=${obj.obfs}`;
      if (obj.obfsHost) {
        result = `${result}, obfs-host=${obj.obfsHost}`;
      }
    }
    if (typeof obj.udp === "boolean") {
      result = `${result}, udp-relay=${obj.udp}`;
    }
    return result;
  }

  if (obj.type === "vmess") {
    let result = `${common}, username=${obj.uuid}`;
    if (typeof obj.skipCertVerify === "boolean") {
      result = `${result}, skip-cert-verify=${obj.skipCertVerify}`;
    }
    if (obj.serverName) {
      result = `${result}, sni=${obj.serverName}`;
    }
    if (typeof obj.tls === "boolean") {
      result = `${result}, tls=${obj.tls}`;
    }
    if (obj.network === "ws") {
      result = `${result}, ws=true`;
    }
    if (obj.wsPath) {
      result = `${result}, ws-path=${obj.wsPath}`;
    }
    return result;
  }

  if (obj.type === "trojan") {
    let result = `${common}, password=${obj.password}`;
    if (typeof obj.skipCertVerify === "boolean") {
      result = `${result}, skip-cert-verify=${obj.skipCertVerify}`;
    }
    if (obj.sni) {
      result = `${result}, sni=${obj.sni}`;
    }
    return result;
  }

  return undefined;
}

function surgeLineToIntermediate(line) {
  const eqIndex = line.indexOf("=");
  if (eqIndex === -1) return undefined;
  const name = line.slice(0, eqIndex).trim();
  const rest = line.slice(eqIndex + 1).trim();
  const parts = rest
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 3) return undefined;
  const type = parts[0];
  if (!["ss", "vmess", "trojan"].includes(type)) return undefined;
  const server = parts[1];
  const port = Number(parts[2]);
  if (!server || Number.isNaN(port)) return undefined;

  const kv = {};
  for (let i = 3; i < parts.length; i++) {
    const p = parts[i];
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    kv[k] = v;
  }

  if (type === "ss") {
    const cipher = kv["encrypt-method"];
    const password = kv["password"];
    if (!cipher || !password) return undefined;
    const obj = {
      name,
      type: "ss",
      server,
      port,
      cipher,
      password,
      udp: kv["udp-relay"]
        ? kv["udp-relay"].toLowerCase() === "true"
        : undefined,
      obfs: kv["obfs"],
      obfsHost: kv["obfs-host"],
    };
    return obj;
  }

  if (type === "vmess") {
    const uuid = kv["username"];
    if (!uuid) return undefined;
    const obj = {
      name,
      type: "vmess",
      server,
      port,
      uuid,
      tls: kv["tls"] ? kv["tls"].toLowerCase() === "true" : undefined,
      serverName: kv["sni"],
      skipCertVerify: kv["skip-cert-verify"]
        ? kv["skip-cert-verify"].toLowerCase() === "true"
        : undefined,
      network: kv["ws"] && kv["ws"].toLowerCase() === "true" ? "ws" : "tcp",
      wsPath: kv["ws-path"],
    };
    return obj;
  }

  if (type === "trojan") {
    const password = kv["password"];
    if (!password) return undefined;
    const obj = {
      name,
      type: "trojan",
      server,
      port,
      password,
      sni: kv["sni"],
      skipCertVerify: kv["skip-cert-verify"]
        ? kv["skip-cert-verify"].toLowerCase() === "true"
        : undefined,
      network: "tcp",
    };
    return obj;
  }

  return undefined;
}

function intermediateToClashProxy(obj) {
  if (obj.type === "ss") {
    const clash = {
      name: obj.name,
      type: "ss",
      server: obj.server,
      port: obj.port,
      cipher: obj.cipher,
      password: obj.password,
    };
    if (typeof obj.udp === "boolean") {
      clash.udp = obj.udp;
    }
    if (obj.obfs) {
      clash.plugin = "obfs";
      clash["plugin-opts"] = {
        mode: obj.obfs,
        host: obj.obfsHost,
      };
    }
    return clash;
  }

  if (obj.type === "vmess") {
    const clash = {
      name: obj.name,
      type: "vmess",
      server: obj.server,
      port: obj.port,
      uuid: obj.uuid,
    };
    if (typeof obj.tls === "boolean") clash.tls = obj.tls;
    if (obj.serverName) clash.servername = obj.serverName;
    if (typeof obj.skipCertVerify === "boolean")
      clash["skip-cert-verify"] = obj.skipCertVerify;
    if (obj.network === "ws") {
      clash.network = "ws";
      if (obj.wsPath) clash["ws-path"] = obj.wsPath;
    }
    return clash;
  }

  if (obj.type === "trojan") {
    const clash = {
      name: obj.name,
      type: "trojan",
      server: obj.server,
      port: obj.port,
      password: obj.password,
    };
    if (obj.sni) clash.sni = obj.sni;
    if (typeof obj.skipCertVerify === "boolean")
      clash["skip-cert-verify"] = obj.skipCertVerify;
    return clash;
  }

  return undefined;
}
