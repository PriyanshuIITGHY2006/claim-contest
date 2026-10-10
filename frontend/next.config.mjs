import path from "node:path"
import { fileURLToPath } from "node:url"
import nextEnv from "@next/env"

// The repo keeps one .env at its root (see .env.example); load it so NEXT_PUBLIC_* reach the app.
// Next has already loaded env for frontend/ by now, so forceReload (4th arg) is required.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
nextEnv.loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", console, true)

/** @type {import('next').NextConfig} */
const nextConfig = {}

export default nextConfig
