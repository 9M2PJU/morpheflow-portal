# AutoMorph 1-Click Cloudflare Workers Deployer (Windows PowerShell)
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  AutoMorph 1-Click Cloudflare Deployer" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Error: Node.js is required but not installed. Please install Node.js from https://nodejs.org/"
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing required npm dependencies..." -ForegroundColor Yellow
    npm install --no-fund --no-audit
}

node scripts/deploy-cf.cjs $args
