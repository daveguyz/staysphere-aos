# StaySphere AOS — Accommodation Operating System

> **Live auction + booking platform for Namibian and Southern African hospitality.**
> Spring Boot microservices backend · Shopify Liquid theme · Real-time WebSocket bidding · KYC · Stripe · Mux livestream

---

## What it is

StaySphere AOS combines accommodation booking with a full live-auction operating system inside a Shopify storefront. Operators can run English, Dutch, Reverse, and Sealed-bid auctions for properties with deposit-gating, Stripe Identity KYC, Claude AI fraud detection, and Mux HLS livestream — all in one platform.

## Architecture

```
Shopify Storefront (Liquid theme)  ←→  API Gateway :8080
                                         ├── auth-service          :8091
                                         ├── property-service      :8081
                                         ├── booking-engine        :8082
                                         ├── payment-service       :8083
                                         ├── auction-service       :8094  ← WebSocket + Redis
                                         ├── ai-service            :8084
                                         ├── pricing-engine        :8085
                                         ├── trust-service         :8086
                                         ├── notification-service  :8087  ← Email/SMS
                                         ├── search-service        :8088  ← Elasticsearch
                                         ├── analytics-service     :8092
                                         ├── messaging-service     :8093
                                         └── shopify-integration   :8090  ← OAuth + provisioning
                                     Kafka  ←── event bus
                                     Redis  ←── bid locks + presence
```

---

## Quick start (local dev)

### Prerequisites
- Java 21, Maven 3.9+
- Docker & Docker Compose
- Node.js 18+ (for Shopify CLI)

### 1. Clone and configure

```bash
git clone https://github.com/daveguyz/staysphere-aos.git
cd staysphere-aos
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and STRIPE_SECRET_KEY
```

### 2. Start infrastructure

```bash
docker compose up -d \
  postgres redis kafka zookeeper elasticsearch \
  service-discovery config-server
```

### 3. Build shared modules

```bash
./mvnw install -pl shared/common-dto,shared/common-events,shared/common-security -am -DskipTests
```

### 4. Start services

```bash
# Start all services (or pick individual ones)
./mvnw spring-boot:run -pl services/auth-service &
./mvnw spring-boot:run -pl services/property-service &
./mvnw spring-boot:run -pl services/auction-service &
# ... etc
./mvnw spring-boot:run -pl infrastructure/api-gateway
```

### 5. Connect the Shopify theme

```bash
# Install Shopify CLI
npm install -g @shopify/cli @shopify/theme

# Push theme to your dev store
git checkout theme
shopify theme push --store staysphere-aos.myshopify.com

# In Theme Customizer → API & Integration:
# Set API Gateway URL to http://localhost:8080
```

---

## Deployment (Railway)

### Prerequisites
- Railway account + project
- GitHub repo connected to Railway
- All secrets added to Railway environment

### Required environment variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Base64-encoded 256-bit secret (`openssl rand -base64 64`) |
| `STRIPE_SECRET_KEY` | Stripe live secret key (`sk_live_...`) |
| `STRIPE_KYC_WEBHOOK_SECRET` | Stripe Identity webhook secret |
| `ANTHROPIC_API_KEY` | Claude API key for AI fraud detection |
| `MUX_TOKEN_ID` | Mux Video token ID for livestreaming |
| `MUX_TOKEN_SECRET` | Mux Video token secret |
| `SHOPIFY_API_KEY` | App API key from Shopify Partners |
| `SHOPIFY_API_SECRET` | App API secret |
| `SHOPIFY_OAUTH_REDIRECT_URI` | `https://your-app.railway.app/oauth/shopify/callback` |
| `SHOPIFY_STORE_URL` | `https://your-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Admin API token |
| `SHOPIFY_WEBHOOK_SECRET` | Webhook HMAC secret |
| `API_GATEWAY_URL` | Public URL of api-gateway service |
| `FRONTEND_URL` | Shopify store URL |
| `KAFKA_SERVERS` | Managed Kafka broker URL |
| `REDIS_HOST` / `REDIS_PORT` | Managed Redis |
| `DB_URL` / `DB_USERNAME` / `DB_PASSWORD` | PostgreSQL per-service |

### Deploy steps

```bash
# 1. Install Railway CLI
npm install -g @railway/cli
railway login

# 2. Create project and link
railway init
railway link

# 3. Add a PostgreSQL instance per service that needs its own DB:
#    auth, property, booking, payment, auction, messaging, analytics,
#    notification, pricing, trust, shopify-integration

# 4. Add Redis + Kafka (Railway plugins or managed services)

# 5. Push — CI will build images and deploy automatically
git push origin main
```

### Activate the Shopify app

After services are deployed:

1. Go to Shopify Partners → Apps → Create app
2. Set App URL to `https://your-app.railway.app`
3. Set Redirect URL to `https://your-app.railway.app/oauth/shopify/callback`
4. Copy API key + secret to Railway env vars
5. Install app on your store: `https://your-app.railway.app/oauth/shopify/install?shop=your-store.myshopify.com`
6. The theme provisions automatically during install (~2 minutes)
7. Go to Shopify Admin → Online Store → Themes → Publish "StaySphere AOS"

---

## Enable features

All features default **OFF** — enable them progressively in Theme Customizer:

| Setting path | What it activates |
|-------------|-------------------|
| Feature Flags → **Payments enabled** | Stripe checkout |
| Auction OS → **Enable Auction OS** | Auction listing + room pages |
| Auction OS → **Enable live bidding** | WebSocket real-time bids |
| Auction OS → **Enable proxy bidding** | Auto-bid ceiling |
| Auction OS → **Enable Dutch auctions** | Dutch tab on listing page |
| Auction OS → **Enable deposit-gated bidding** | Stripe deposit before bid |
| Auction OS → **Enable KYC-gated bidding** | Stripe Identity verification |
| Auction OS → **Enable auction livestream** | Mux HLS in auction room |
| Auction OS → **Livestream provider** | MUX / YOUTUBE / NONE |

---

## Run tests

```bash
# All tests (requires Docker for Testcontainers)
./mvnw verify

# Auction service only (race condition + KYC + deposit + state machine)
./mvnw test -pl services/auction-service

# Booking engine only
./mvnw test -pl services/booking-engine
```

---

## Project structure

```
staysphere-aos/
├── shared/
│   ├── common-dto/         Shared request/response DTOs
│   ├── common-events/      Kafka event classes (17 events)
│   └── common-security/    JWT filter, security constants
├── infrastructure/
│   ├── api-gateway/        Spring Cloud Gateway :8080
│   ├── service-discovery/  Eureka Server :8761
│   └── config-server/      Spring Cloud Config :8888
├── services/
│   ├── auction-service/    ← Auction OS (Phase A–C)
│   ├── auth-service/       JWT auth, user management
│   ├── booking-engine/     Bookings, availability
│   ├── payment-service/    Stripe payments
│   ├── property-service/   Property CRUD + search
│   ├── ai-service/         Claude API integration
│   ├── pricing-engine/     Dynamic pricing
│   ├── trust-service/      Trust scores + reviews
│   ├── notification-service/ Email (Thymeleaf) + SMS
│   ├── search-service/     Elasticsearch
│   ├── analytics-service/  Platform analytics
│   └── messaging-service/  Real-time messaging + tickets
├── shopify-integration/    OAuth + theme provisioning
├── .github/workflows/
│   ├── ci.yml              Build + test + theme check
│   └── deploy.yml          Docker images + Railway deploy
└── docker-compose.yml      Full local stack
```

---

## License

Proprietary — StaySphere AOS. All rights reserved.
