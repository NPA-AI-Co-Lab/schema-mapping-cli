#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { basePath, setupCliSigintHandler } from "./utils/index.js";
import { setupCliProgram } from "./cli/index.js";
import path from "path";

const nodeVersion = process.versions.node;
const majorVersion = parseInt(nodeVersion.split(".")[0], 10);

if (majorVersion < 18) {
  console.error(`❌ Node.js version ${nodeVersion} is not supported.`);
  console.error("This application requires Node.js version 18 or higher.");
  console.error("Please upgrade your Node.js installation and try again.");
  process.exit(1);
}

const pkg = JSON.parse(
  readFileSync(path.join(basePath, "package.json"), "utf-8")
);

const program = new Command();

setupCliSigintHandler();

setupCliProgram(program, pkg);

program.parse();
