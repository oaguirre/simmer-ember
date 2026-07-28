import { type Response } from 'express'
import Stripe from 'stripe'
import { User } from '../resources/user/model'
import { type Req } from './types'
import ApiError from './apiError'

const SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? ''
const stripeApi: any = new (Stripe as any)(SECRET_KEY)
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET

export const stripeWebhooks = async (req: Req, res: any, next: any) => {
  const sig = req.headers['stripe-signature']
  let event
  try {
    event = stripeApi.webhooks.constructEvent(req.body, sig as string, WEBHOOK_SECRET as string)
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  // Handle the event
  switch (event.type) {
    case 'charge.succeeded': {
      if (!event.data.object.metadata._id) {
        next(ApiError.badRequest('No _id in metadata', 'stripeWebhooks'))
        return
      }
      await User.findOneAndUpdate({ _id: event.data.object.metadata._id }, { plan: 'paid' }).lean()
      //   const email = event["data"]["object"]["receipt_email"]; // contains the email that will receive the receipt for the payment (users email usually)
      console.log(`PaymentIntent was successful for ${event.data.object.metadata}!`)
      break
    }
    default:
      // Unexpected event type
      return res.status(400).end()
  }

  // Return a 200 response to acknowledge receipt of the event
  res.json({ received: true })
}
