// ====================================
// API SERVER STANDALONE
// File: api-server.js (taruh di root folder)
// ====================================

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json());

// ========== GOOGLE SHEETS SETUP ==========
// 🔒 Gunakan kredensial dari Environment Variable di Railway
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = "1jJdqZNmBdLqXoZeRTSmZvsM-HiKMs96hF5TSS-xWbXU";
const SHEET_NAME = "Whitelist Server";

// ========== HELPER FUNCTIONS ==========

/**
 * Membaca data whitelist dari Google Sheets
 */
async function getWhitelistFromSheets() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:E`,
    });

    const rows = response.data.values || [];

    const servers = rows.map((row) => ({
      ip: row[0] || "",
      owner: row[1] || "",
      addedBy: row[2] || "",
      addedAt: row[3] || new Date().toISOString(),
      status: row[4] || "active",
    }));

    return servers;
  } catch (error) {
    console.error("[SHEETS] Error reading whitelist:", error.message);
    return [];
  }
}

/**
 * Menyimpan data whitelist ke Google Sheets
 */
async function saveWhitelistToSheets(servers) {
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:E`,
    });

    const rows = servers.map((server) => [
      server.ip,
      server.owner,
      server.addedBy,
      server.addedAt,
      server.status,
    ]);

    if (rows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2`,
        valueInputOption: "RAW",
        resource: { values: rows },
      });
    }

    console.log("[SHEETS] Data saved successfully");
    return true;
  } catch (error) {
    console.error("[SHEETS] Error saving whitelist:", error.message);
    return false;
  }
}

// ========== API ENDPOINTS ==========

/**
 * GET /api/whitelist/check/:ip
 * Cek apakah IP ada di whitelist
 */
app.get("/api/whitelist/check/:ip", async (req, res) => {
  try {
    const { ip } = req.params;
    console.log(`[API] Whitelist check request for: ${ip}`);

    const servers = await getWhitelistFromSheets();
    const serverData = servers.find((s) => s.ip === ip && s.status === "active");
    const isWhitelisted = !!serverData;

    console.log(`[API] Result: ${isWhitelisted ? "WHITELISTED ✅" : "NOT WHITELISTED ❌"}`);

    // Log activity
    const logData = {
      ip: ip,
      action: "check",
      result: isWhitelisted,
      timestamp: new Date().toISOString(),
    };

    const logPath = path.join(__dirname, "data", "server_logs.json");
    let logs = [];
    if (fs.existsSync(logPath)) {
      logs = JSON.parse(fs.readFileSync(logPath, "utf8"));
    }
    logs.push(logData);
    if (logs.length > 1000) logs = logs.slice(-1000);
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));

    res.json({
      success: true,
      whitelisted: isWhitelisted,
      server: serverData || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] Error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/whitelist/list
 * Mendapatkan semua server di whitelist
 */
app.get("/api/whitelist/list", async (req, res) => {
  try {
    const servers = await getWhitelistFromSheets();
    const activeServers = servers.filter((s) => s.status === "active");

    res.json({
      success: true,
      count: activeServers.length,
      servers: activeServers,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] Error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/whitelist/add
 * Menambah server ke whitelist
 */
app.post("/api/whitelist/add", async (req, res) => {
  try {
    const { ip, owner, addedBy } = req.body;

    if (!ip || !owner || !addedBy) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: ip, owner, addedBy",
      });
    }

    console.log(`[API] Add whitelist request: ${ip} by ${addedBy}`);

    const servers = await getWhitelistFromSheets();

    if (servers.some((s) => s.ip === ip)) {
      return res.json({
        success: false,
        message: "Server sudah ada dalam whitelist!",
      });
    }

    const newServer = {
      ip: ip,
      owner: owner,
      addedBy: addedBy,
      addedAt: new Date().toISOString(),
      status: "active",
    };

    servers.push(newServer);

    if (await saveWhitelistToSheets(servers)) {
      console.log(`[API] Server ${ip} added successfully ✅`);
      res.json({
        success: true,
        message: "Server berhasil ditambahkan!",
        server: newServer,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Gagal menyimpan data",
      });
    }
  } catch (error) {
    console.error("[API] Error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/whitelist/remove
 * Menghapus server dari whitelist
 */
app.post("/api/whitelist/remove", async (req, res) => {
  try {
    const { ip } = req.body;

    if (!ip) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: ip",
      });
    }

    console.log(`[API] Remove whitelist request: ${ip}`);

    const servers = await getWhitelistFromSheets();
    const index = servers.findIndex((s) => s.ip === ip);

    if (index === -1) {
      return res.json({
        success: false,
        message: "Server tidak ditemukan!",
      });
    }

    const removedServer = servers[index];
    servers.splice(index, 1);

    if (await saveWhitelistToSheets(servers)) {
      console.log(`[API] Server ${ip} removed successfully ✅`);
      res.json({
        success: true,
        message: "Server berhasil dihapus!",
        server: removedServer,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Gagal menyimpan data",
      });
    }
  } catch (error) {
    console.error("[API] Error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/status
 * Health check
 */
app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "Whitelist API Server",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /
 * Default route (optional)
 */
app.get("/", (req, res) => {
  res.send("🟢 Whitelist API Server is running. Use /api/status to check health.");
});

// ========== START SERVER ==========
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   🚀 WHITELIST API SERVER ONLINE      ║`);
  console.log(`╠════════════════════════════════════════╣`);
  console.log(`║   Port: ${PORT}                           ║`);
  console.log(`║   Database: Google Sheets             ║`);
  console.log(`║   Status: 🟢 READY                    ║`);
  console.log(`╠════════════════════════════════════════╣`);
  console.log(`║   📡 Endpoints:                       ║`);
  console.log(`║   GET  /api/whitelist/check/:ip       ║`);
  console.log(`║   GET  /api/whitelist/list            ║`);
  console.log(`║   POST /api/whitelist/add             ║`);
  console.log(`║   POST /api/whitelist/remove          ║`);
  console.log(`║   GET  /api/status                    ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});

// ========== ERROR HANDLERS ==========
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Promise Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});
