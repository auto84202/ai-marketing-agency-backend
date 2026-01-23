# Keyword Monitoring System Setup Script for Windows PowerShell

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Keyword Monitoring System Setup" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the backend directory
if (-not (Test-Path "package.json")) {
    Write-Host "Error: Please run this script from the backend directory" -ForegroundColor Red
    exit 1
}

Write-Host "Step 1: Generating Prisma Client..." -ForegroundColor Yellow
npx prisma generate

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to generate Prisma client" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 2: Creating database migration..." -ForegroundColor Yellow
npx prisma migrate dev --name add_keyword_monitoring_system

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to create migration" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 3: Verifying setup..." -ForegroundColor Yellow

# Check if .env file exists
if (-not (Test-Path ".env")) {
    Write-Host "Warning: .env file not found. Creating from template..." -ForegroundColor Yellow
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "Please edit .env file with your API keys" -ForegroundColor Yellow
    } else {
        Write-Host "Error: No .env.example file found" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Ensure your .env file has the following keys:" -ForegroundColor White
Write-Host "   - OPENAI_API_KEY (required for AI engagement)" -ForegroundColor Gray
Write-Host "   - FACEBOOK_APP_ID, FACEBOOK_APP_SECRET" -ForegroundColor Gray
Write-Host "   - TWITTER_API_KEY, TWITTER_API_SECRET" -ForegroundColor Gray
Write-Host "   - LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Start the backend server:" -ForegroundColor White
Write-Host "   npm run start:dev" -ForegroundColor Gray
Write-Host ""
Write-Host "3. The keyword monitoring service will start automatically" -ForegroundColor White
Write-Host "   - Scans every 10 minutes" -ForegroundColor Gray
Write-Host "   - Engages every 5 minutes (when enabled)" -ForegroundColor Gray
Write-Host ""
Write-Host "4. API Documentation available at:" -ForegroundColor White
Write-Host "   See KEYWORD_MONITORING_SETUP.md" -ForegroundColor Gray
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan

