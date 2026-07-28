import { Router, Request, Response } from 'express'
import { countProfiles } from '../../resources/user/controller'

export const router = Router()
const use = (fn: (req: any, res: Response, next: any) => any) => async (req: Request, res: Response, next: any) => await Promise.resolve(fn(req, res, next)).catch(next)

/**
 * @openapi
 * /db/count:
 *   get:
 *     summary: Get database collections count
 *     description: Retrieve the count of documents in each collection in the database.
 *     tags: [Database]
 *     responses:
 *       200:
 *         description: Successful response with collection counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *             examples:
 *               example-1:
 *                 value:
 *                   success: true
 *                   data:
 *                     user_count: 1500
 */
router.get('/db/count', use(countProfiles))
