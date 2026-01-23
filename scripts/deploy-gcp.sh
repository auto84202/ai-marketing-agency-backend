#!/bin/bash

# AI Marketing Agency Backend - GCP Deployment Script
# This script deploys the application to Google Cloud Platform

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${PROJECT_ID:-"your-gcp-project-id"}
REGION=${REGION:-"us-central1"}
SERVICE_NAME="ai-marketing-agency-backend"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

echo -e "${BLUE}🚀 Starting GCP deployment for AI Marketing Agency Backend${NC}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo -e "${YELLOW}⚠️  You are not authenticated with gcloud. Please run 'gcloud auth login' first.${NC}"
    exit 1
fi

# Set the project
echo -e "${BLUE}📋 Setting project to $PROJECT_ID${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "${BLUE}🔧 Enabling required GCP APIs${NC}"
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable secretmanager.googleapis.com

# Create secrets if they don't exist
echo -e "${BLUE}🔐 Setting up secrets${NC}"

# Database URL secret
if ! gcloud secrets describe database-url &> /dev/null; then
    echo -e "${YELLOW}⚠️  Creating database-url secret. Please set the value manually.${NC}"
    echo "your-postgresql-connection-string" | gcloud secrets create database-url --data-file=-
fi

# OpenAI API Key secret
if ! gcloud secrets describe openai-api-key &> /dev/null; then
    echo -e "${YELLOW}⚠️  Creating openai-api-key secret. Please set the value manually.${NC}"
    echo "your-openai-api-key-here" | gcloud secrets create openai-api-key --data-file=-
fi

# Stripe Secret Key secret
if ! gcloud secrets describe stripe-secret-key &> /dev/null; then
    echo -e "${YELLOW}⚠️  Creating stripe-secret-key secret. Please set the value manually.${NC}"
    echo "your-stripe-secret-key-here" | gcloud secrets create stripe-secret-key --data-file=-
fi

# JWT Secret secret
if ! gcloud secrets describe jwt-secret &> /dev/null; then
    echo -e "${YELLOW}⚠️  Creating jwt-secret secret. Please set the value manually.${NC}"
    echo "your-jwt-secret-here" | gcloud secrets create jwt-secret --data-file=-
fi

# Build and deploy using Cloud Build
echo -e "${BLUE}🔨 Building and deploying with Cloud Build${NC}"
gcloud builds submit --config cloudbuild.yaml .

# Get the service URL
echo -e "${BLUE}🌐 Getting service URL${NC}"
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${GREEN}🌍 Service URL: $SERVICE_URL${NC}"
echo -e "${GREEN}📊 To view logs: gcloud run services logs tail $SERVICE_NAME --region=$REGION${NC}"
echo -e "${GREEN}🔧 To update secrets: gcloud secrets versions add <secret-name> --data-file=-${NC}"

# Display important notes
echo -e "${YELLOW}📝 Important Notes:${NC}"
echo -e "${YELLOW}   1. Update your database URL secret with the actual PostgreSQL connection string${NC}"
echo -e "${YELLOW}   2. Update your OpenAI API key secret with your actual API key${NC}"
echo -e "${YELLOW}   3. Update your Stripe secret key with your actual secret key${NC}"
echo -e "${YELLOW}   4. Run database migrations: gcloud run services proxy $SERVICE_NAME --region=$REGION${NC}"
echo -e "${YELLOW}   5. Configure your domain and SSL certificate${NC}"

echo -e "${BLUE}🎉 AI Marketing Agency Backend is now deployed on GCP!${NC}"
