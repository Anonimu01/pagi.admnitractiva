const axios = require("axios");

const CORE_API_URL = process.env.CORE_API_URL || "";

async function proxyToCore(req, endpoint, options = {}) {
  if (!CORE_API_URL) return { ok: false, status: 500, data: { ok: false, msg: "Core no configurado" } };

  try {
    const url = CORE_API_URL + endpoint;
    const method = options.method || "GET";
    const body = options.body || {};
    const headers = options.headers || { "Content-Type": "application/json" };

    const response = await axios({ method, url, data: body, headers, validateStatus: () => true });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, data: response.data, headers: response.headers };
  } catch (err) {
    console.error("proxyToCore error:", err);
    return { ok: false, status: 500, data: { ok: false, msg: "Error proxy core", error: err.message } };
  }
}

module.exports = { proxyToCore, CORE_API_URL };
