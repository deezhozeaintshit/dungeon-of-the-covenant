#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";
import readline from "readline";

const BLENDER_PATH = "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe";
const SCRIPT_PATH = path.resolve(import.meta.dirname || process.cwd(), "generate_3d_assets.py");

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    if (req.method === "initialize") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "blender-mcp-server", version: "5.2.0" }
        }
      }) + "\n");
    } else if (req.method === "tools/list") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          tools: [
            {
              name: "blender_generate_dungeon_glb_assets",
              description: "Run Blender 5.2 headless pipeline to generate 3D PBR GLB dungeon props, chests, and altars",
              inputSchema: { type: "object", properties: {} }
            }
          ]
        }
      }) + "\n");
    } else if (req.method === "tools/call") {
      const proc = spawn(BLENDER_PATH, ["-b", "-P", SCRIPT_PATH]);
      let out = "";
      proc.stdout.on("data", (d) => { out += d.toString(); });
      proc.stderr.on("data", (d) => { out += d.toString(); });
      proc.on("close", (code) => {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [{ type: "text", text: `Blender 5.2 exited with ${code}:\n${out}` }]
          }
        }) + "\n");
      });
    }
  } catch (err) {
    // Ignore non-JSON lines
  }
});
