#!/bin/bash

echo "======================================"
echo "Keyword Monitoring System Setup"
echo "======================================"
echo ""

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo "Error: Please run this script from the backend directory"
    exit 1
fi

echo "Step 1: Generating Prisma Client..."
npx prisma generate

if [ $? -ne 0 ]; then
    echo "Error: Failed to generate Prisma client"
    exit 1
fi

echo ""
echo "Step 2: Creating database migration..."
npx prisma migrate dev --name add_keyword_monitoring_system

if [ $? -ne 0 ]; then
    echo "Error: Failed to create migration"
    exit 1
fi

echo ""
echo "Step 3: Verifying setup..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "Warning: .env file not found. Creating from template..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "Please edit .env file with your API keys"
    else
        echo "Error: No .env.example file found"
        exit 1
    fi
fi

echo ""
echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Ensure your .env file has the following keys:"
echo "   - OPENAI_API_KEY (required for AI engagement)"
echo "   - FACEBOOK_APP_ID, FACEBOOK_APP_SECRET"
echo "   - TWITTER_API_KEY, TWITTER_API_SECRET"
echo "   - LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET"
echo ""
echo "2. Start the backend server:"
echo "   npm run start:dev"
echo ""
echo "3. The keyword monitoring service will start automatically"
echo "   - Scans every 10 minutes"
echo "   - Engages every 5 minutes (when enabled)"
echo ""
echo "4. API Documentation available at:"
echo "   See KEYWORD_MONITORING_SETUP.md"
echo ""
echo "======================================"

