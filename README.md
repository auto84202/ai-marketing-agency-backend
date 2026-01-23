# AI Marketing Agency - Backend API

A comprehensive NestJS-based backend API for an AI-powered marketing automation platform.

## 🚀 Features

### Core Features
- **User Management**: Registration, authentication, profile management
- **Admin System**: Role-based access control (RBAC), permissions, audit logs
- **AI Services**:
  - Content generation (blog posts, social media, ads)
  - Image generation (DALL-E integration)
  - SEO optimization
  - Chatbot creation and management
  - Predictive analytics
  - A/B testing
  - Budget optimization

### Integrations
- **Payment Processing**: Stripe integration
- **Social Media**: Facebook, Twitter, Instagram, LinkedIn
- **AI**: OpenAI (GPT-4, DALL-E)
- **Ads**: Google Ads integration
- **Email**: Nodemailer for notifications
- **OAuth**: Google and Facebook authentication

### Additional Features
- Campaign management
- Client management
- Real-time analytics and reporting
- Automated social media posting
- Invoice and billing management
- Queue-based job processing (BullMQ)
- File upload handling

## 🛠️ Tech Stack

- **Framework**: NestJS 10
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Passport.js (JWT, OAuth2)
- **API Documentation**: OpenAPI/Swagger
- **Queue**: BullMQ with Redis
- **Validation**: class-validator, class-transformer
- **Security**: Helmet, CORS
- **Logging**: Pino
- **Testing**: Jest

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v18.0.0 or higher)
- npm or yarn
- PostgreSQL (v14 or higher)
- Redis (v6 or higher)

## 🔧 Installation

1. **Clone the repository and navigate to backend**:
```bash
cd backend
```

2. **Install dependencies**:
```bash
npm install
```

3. **Set up environment variables**:
```bash
cp .env.example .env
```

Edit `.env` file with your actual credentials.

4. **Generate Prisma Client**:
```bash
npm run prisma:generate
```

5. **Run database migrations**:
```bash
npm run prisma:migrate
```

6. **Seed the database** (optional):
```bash
npm run seed
```

7. **Create admin user** (optional):
```bash
npm run seed:admin
```

## 🚦 Running the Application

### Development Mode
```bash
npm run dev
# or
npm run start:dev
```

The API will be available at `http://localhost:3001`

### Production Mode
```bash
# Build the application
npm run build

# Start the production server
npm run start:prod
```

## 📚 API Documentation

Once the server is running, access the API documentation at:
- Swagger UI: `http://localhost:3001/api/docs`
- OpenAPI JSON: `http://localhost:3001/api/docs-json`

## 🗄️ Database Management

### Prisma Commands
```bash
# Format Prisma schema
npm run prisma:format

# Generate Prisma Client
npm run prisma:generate

# Create a new migration
npm run prisma:migrate

# Deploy migrations to production
npm run prisma:deploy

# Open Prisma Studio (Database GUI)
npx prisma studio
```

### Seeding
```bash
# Seed database with sample data
npm run seed

# Create admin user
npm run seed:admin
```

## 📁 Project Structure

```
backend/
├── prisma/
│   ├── migrations/         # Database migrations
│   ├── schema.prisma      # Database schema
│   └── seed.ts            # Database seeding script
│
├── scripts/
│   ├── create-admin.ts    # Create admin user script
│   └── seed-admin.ts      # Seed admin data
│
├── src/
│   ├── admin/             # Admin management module
│   │   ├── decorators/    # Custom decorators
│   │   ├── dto/          # Data Transfer Objects
│   │   ├── guards/       # Authorization guards
│   │   └── interceptors/ # Request/Response interceptors
│   │
│   ├── ai/               # AI services module
│   │   ├── ab-testing/   # A/B testing functionality
│   │   ├── analytics/    # Predictive analytics
│   │   ├── budget-optimization/
│   │   ├── chatbot/      # Chatbot management
│   │   ├── content/      # Content generation
│   │   ├── images/       # Image generation
│   │   ├── seo/          # SEO optimization
│   │   └── social-media/ # Social media automation
│   │
│   ├── auth/             # Authentication module
│   │   ├── dto/          # Auth DTOs
│   │   ├── guards/       # Auth guards
│   │   └── strategies/   # Passport strategies
│   │
│   ├── billing/          # Payment & invoicing
│   ├── campaigns/        # Campaign management
│   ├── clients/          # Client management
│   ├── common/           # Shared utilities
│   ├── config/           # Configuration files
│   ├── integrations/     # Third-party integrations
│   ├── notifications/    # Email notifications
│   ├── prisma/           # Prisma service
│   ├── queue/            # Job queue management
│   ├── reports/          # Analytics & reporting
│   ├── stats/            # Statistics
│   ├── users/            # User management
│   ├── utils/            # Utility functions
│   │
│   ├── app.module.ts     # Root module
│   └── main.ts           # Application entry point
│
├── .dockerignore
├── .env.example          # Environment variables template
├── .gitignore
├── Dockerfile            # Docker configuration
├── cloudbuild.yaml       # Google Cloud Build config
├── package.json
├── tsconfig.json         # TypeScript configuration
└── README.md
```

## 🔐 Environment Variables

Key environment variables (see `.env.example` for complete list):

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `JWT_SECRET` | Secret key for JWT tokens | ✅ |
| `OPENAI_API_KEY` | OpenAI API key | ✅ |
| `STRIPE_SECRET_KEY` | Stripe secret key | For payments |
| `REDIS_URL` | Redis connection string | For queues |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | For OAuth |
| `FACEBOOK_APP_ID` | Facebook OAuth app ID | For OAuth |
| `EMAIL_PROVIDER` | Email provider: console/gmail/sendgrid/smtp | For emails |
| `EMAIL_USER` | Email account username | For SMTP |
| `EMAIL_PASSWORD` | Email account password | For SMTP |
| `EMAIL_HOST` | SMTP host | For SMTP |
| `EMAIL_PORT` | SMTP port | For SMTP |
| `FRONTEND_URL` | Frontend URL for password reset links | For auth |
| `ALERT_EMAILS` | Comma separated list of email recipients for workflow alerts | Optional |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook for workflow notifications | Optional |

## 🧪 Testing

```bash
# Run unit tests
npm run test

# Run e2e tests
npm run test:e2e

# Run tests with coverage
npm run test:cov
```

## 📦 Deployment

### Docker
```bash
# Build Docker image
docker build -t ai-marketing-backend .

# Run container
docker run -p 3001:3001 ai-marketing-backend
```

### Vercel
```bash
vercel --prod
```

### Google Cloud Platform
```bash
gcloud builds submit --config cloudbuild.yaml
```

## 🔒 Security Best Practices

- Never commit `.env` files
- Use strong JWT secrets
- Enable CORS only for trusted domains
- Keep dependencies updated
- Use HTTPS in production
- Implement rate limiting
- Validate all user inputs
- Use parameterized queries (Prisma handles this)

## 📝 API Endpoints

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user
- `POST /auth/refresh` - Refresh access token
- `GET /auth/google` - Google OAuth
- `GET /auth/facebook` - Facebook OAuth

### Users
- `GET /users/profile` - Get user profile
- `PATCH /users/profile` - Update profile
- `DELETE /users/account` - Delete account

### AI Services
- `POST /ai/content/generate` - Generate content
- `POST /ai/images/generate` - Generate images
- `POST /ai/chatbot/create` - Create chatbot
- `POST /ai/seo/optimize` - Optimize SEO

### Campaigns
- `GET /campaigns` - List campaigns
- `POST /campaigns` - Create campaign
- `GET /campaigns/:id` - Get campaign
- `PATCH /campaigns/:id` - Update campaign
- `DELETE /campaigns/:id` - Delete campaign

### Admin
- `GET /admin/users` - List all users
- `GET /admin/stats` - Platform statistics
- `GET /admin/audit-logs` - View audit logs

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Write/update tests
4. Submit a pull request

## 📄 License

ISC

## 👨‍💻 Support

For support, email aimarketingagencyhelp@gmail.com or create an issue in the repository.

## 🔄 Version History

- **v1.0.0** - Initial release with core features
  - User authentication
  - AI content generation
  - Campaign management
  - Admin panel
