# Cal Zero API v2 - Railway Environment Variables

Configure these environment variables in the Railway dashboard for each environment (staging/production).

## Required Variables

### Database
```
DATABASE_URL=postgresql://user:pass@host:5432/db?schema=public
DATABASE_READ_URL=postgresql://user:pass@host:5432/db?schema=public
DATABASE_WRITE_URL=postgresql://user:pass@host:5432/db?schema=public
DATABASE_DIRECT_URL=postgresql://user:pass@host:5432/db?schema=public
```
Note: `DATABASE_DIRECT_URL` should NOT use PgBouncer (remove `?pgbouncer=true`)

### Redis
```
REDIS_URL=redis://default:pass@host:6379
```

### Authentication
```
NEXTAUTH_SECRET=<generate with: openssl rand -hex 32>
JWT_SECRET=<generate with: openssl rand -hex 32>
```

### Ground Zero Integration
```
OPS_JWT_PUBLIC_KEY=<RS256 public key from Ground Zero - PEM format>
OPS_WEBHOOK_URL=https://staging.groundzero.com/api/calzero/v1/webhook
OPS_WEBHOOK_SECRET=<shared secret with Ground Zero>
GZERO_HMAC_SECRET=<shared secret with Ground Zero for HMAC verification>
```

### Application
```
API_URL=https://calzero-staging.railway.app
NODE_ENV=production
```
Note: `PORT` is set automatically by Railway - do not set it manually.

## Optional Variables

### Logging
```
LOG_LEVEL=info  # debug, info, warn, error
```

### Database Pool
```
DATABASE_READ_POOL_MAX=9
DATABASE_WRITE_POOL_MAX=7
USE_POOL=true
```

### Stripe (can be dummy values if not using billing)
```
STRIPE_API_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

## Railway-Specific

Railway automatically provides:
- `PORT` - The port Railway expects the app to listen on
- `RAILWAY_ENVIRONMENT` - The environment name (staging, production)

## Migration Release Command

Configure this as the release command in Railway:
```bash
yarn workspace @calcom/prisma prisma migrate deploy
```

This runs before the main service starts, ensuring migrations are applied.
