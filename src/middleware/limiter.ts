import { type Request } from 'express'
import rateLimit from 'express-rate-limit'
import Redis from 'ioredis-mock'
import RedisStore from 'rate-limit-redis'
import { config } from '../constants/config'

// Initialize Redis client
const redisClient = new Redis({
  host: config.redisHost,
  port: parseInt(config.redisPort)
})

redisClient.on('error', err => {
  console.error(`Error connecting to Redis: ${err.message}`)
})

redisClient.on('connect', () => {
  console.log(`Connected to Redis at ${config.redisHost}:${config.redisPort}`)
})

// Rate limiting middleware
export const limiter = (rateLimit as any)({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  keyGenerator: function (req: Request) {
    return (req as any).ip
  },
  store: new RedisStore({
    client: redisClient,
    retryStrategy: times => {
      if (times <= 3) {
        return 200 // wait 200ms before trying again
      }
    }
  } as any),
  skip: (function (req: Request) {
    const whitelist = process.env.IP_WHITELIST?.split(',')
    return whitelist?.includes((req as any).ip)
  }) as any,
  onLimitReached: function (req: Request, res: any, options: any) {
    console.log(`Rate limit exceeded for IP ${(req as any).ip}`)
    res.status(429).send('Too many requests, please try again later.')
  }
})
