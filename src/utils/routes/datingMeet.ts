import { Request, Response, Router } from 'express'
import * as moment from '../../resources/moment/controller'

export const router = Router()
const use = (fn: (req: any, res: Response, next: any) => any) => async (req: Request, res: Response, next: any) => await Promise.resolve(fn(req, res, next)).catch(next)

/**
 * @openapi
 * /api/dating-meet:
 *   get:
 *     summary: Get dating meet
 *     security:
 *       - bearerAuth: []
 *     description: Get dating meet(s). If a `user_target` query parameter is provided, it will filter dating meets involving that user. If not provided, it returns all dating meets involving the requester.
 *     tags: [Dating Meet]
 *     parameters:
 *       - in: query
 *         name: user_target
 *         required: false
 *         schema:
 *           type: string
 *         description: The ID of the user to filter dating meets. If not provided, returns all dating meets involving the requester.
 *       - in: query
 *         name: limit
 *         required: false
 *         default: 20
 *         schema:
 *           type: number
 *       - in: query
 *         name: skip
 *         required: false
 *         default: 0
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Returns dating meet
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       user_a:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           first_name:
 *                             type: string
 *                           avatar_url:
 *                             type: string
 *                             description: Presigned URL for accessing user_a's avatar image for 3600 seconds (1 hour)
 *                           image_url:
 *                             type: string
 *                             description: Presigned URL for accessing user_a's most recent profile image for 3600 seconds (1 hour)
 *                       user_b:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           first_name:
 *                             type: string
 *                           avatar_url:
 *                             type: string
 *                             description: Presigned URL for accessing user_b's avatar image for 3600 seconds (1 hour)
 *                           image_url:
 *                             type: string
 *                             description: Presigned URL for accessing user_b's most recent profile image for 3600 seconds (1 hour)
 *                       type:
 *                         type: string
 *                         enum:
 *                           - date
 *                           - text
 *                           - chat
 *                           - call
 *                           - gathering
 *                           - coaching
 *                       universe:
 *                         type: string
 *                         enum:
 *                           - simmer-world
 *                           - reality
 *                       source:
 *                         type: string
 *                         enum:
 *                           - user
 *                           - ai
 *                           - external
 *                       private_to_a:
 *                         type: boolean
 *                       image_urls:
 *                         type: array
 *                         items:
 *                           type: string
 *                       summary_a:
 *                         type: string
 *                       summary_b:
 *                         type: string
 *                       conversation:
 *                         type: string
 *                       location:
 *                         type: string
 *                       title:
 *                         type: string
 *                       items:
 *                         type: array
 *                         items:
 *                           type: string
 *                       mood:
 *                         type: string
 *                       scene:
 *                         type: string
 *                       opening_line:
 *                         type: string
 *                       ending_note:
 *                         type: string
 *                       moment:
 *                         type: string
 *                       final_why:
 *                         type: object
 *                         properties:
 *                           observations:
 *                             type: array
 *                             items:
 *                               type: string
 *                           insight:
 *                             type: string
 *                       tone_score:
 *                         type: string
 *                       match_score:
 *                         type: string
 *                       chemistry_signals:
 *                         type: string
 *                       chemistry_signals_score:
 *                         type: number
 *                       chemistry_signals_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       conversational_balance:
 *                         type: string
 *                       conversational_balance_score:
 *                         type: number
 *                       conversational_balance_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       conversation_flow:
 *                         type: string
 *                       conversation_flow_score:
 *                         type: number
 *                       conversation_flow_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       curiosity:
 *                         type: string
 *                       curiosity_score:
 *                         type: number
 *                       curiosity_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       energy_alignment:
 *                         type: string
 *                       energy_alignment_score:
 *                         type: number
 *                       energy_alignment_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       humor_alignment:
 *                         type: string
 *                       humor_alignment_score:
 *                         type: number
 *                       humor_alignment_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       listening_responsiveness:
 *                         type: string
 *                       listening_responsiveness_score:
 *                         type: number
 *                       listening_responsiveness_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       repair_attempts:
 *                         type: string
 *                       repair_attempts_score:
 *                         type: number
 *                       repair_attempts_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       responsiveness:
 *                         type: string
 *                       responsiveness_score:
 *                         type: number
 *                       responsiveness_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       shared_moments:
 *                         type: string
 *                       shared_moments_score:
 *                         type: number
 *                       shared_moments_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       tension_handling:
 *                         type: string
 *                       tension_handling_score:
 *                         type: number
 *                       tension_handling_level:
 *                         type: string
 *                         enum: [strong, mixed, strained, not-observed]
 *                       pay_attention_to:
 *                         type: array
 *                         items:
 *                           type: string
 *                       compatibility_penalty:
 *                         type: string
 *                       compatibility_penalty_points:
 *                         type: number
 *                       when:
 *                         type: string
 *                         format: date
 *                       tags:
 *                         type: array
 *                         items:
 *                           type: string
 *                       inputTokens:
 *                         type: number
 *                       outputTokens:
 *                         type: number
 *       500:
 *         description: Internal server error
 */
router.get('/', use(moment.viewMoment))

/**
 * @openapi
 * /api/dating-meet/{moment_id}:
 *   get:
 *     tags: [Dating Meet]
 *     summary: Get dating meet by ID
 *     operationId: getMomentById
 *     description: Returns a dating meet by ID. If `signature` is valid, request can be made without bearer token.
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: moment_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: signature
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Returns dating meet
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     user_a:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         first_name:
 *                           type: string
 *                         avatar_url:
 *                           type: string
 *                           description: Presigned URL for accessing user_a's avatar image for 3600 seconds (1 hour)
 *                         image_url:
 *                           type: string
 *                           description: Presigned URL for accessing user_a's most recent profile image for 3600 seconds (1 hour)
 *                     user_b:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         first_name:
 *                           type: string
 *                         avatar_url:
 *                           type: string
 *                           description: Presigned URL for accessing user_b's avatar image for 3600 seconds (1 hour)
 *                         image_url:
 *                           type: string
 *                           description: Presigned URL for accessing user_b's most recent profile image for 3600 seconds (1 hour)
 *                     type:
 *                       type: string
 *                       enum:
 *                         - date
 *                         - text
 *                         - chat
 *                         - call
 *                         - gathering
 *                         - coaching
 *                     universe:
 *                       type: string
 *                       enum:
 *                         - simmer-world
 *                         - reality
 *                     source:
 *                       type: string
 *                       enum:
 *                         - user
 *                         - ai
 *                         - external
 *                     private_to_a:
 *                       type: boolean
 *                     image_urls:
 *                       type: array
 *                       items:
 *                         type: string
 *                     summary_a:
 *                       type: string
 *                     summary_b:
 *                       type: string
 *                     conversation:
 *                       type: string
 *                     location:
 *                       type: string
 *                     title:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: string
 *                     mood:
 *                       type: string
 *                     scene:
 *                       type: string
 *                     opening_line:
 *                       type: string
 *                     ending_note:
 *                       type: string
 *                     moment:
 *                       type: string
 *                     final_why:
 *                       type: object
 *                       properties:
 *                         observations:
 *                           type: array
 *                           items:
 *                             type: string
 *                         insight:
 *                           type: string
 *                     tone_score:
 *                       type: string
 *                     match_score:
 *                       type: string
 *                     chemistry_signals:
 *                       type: string
 *                     chemistry_signals_score:
 *                       type: number
 *                     chemistry_signals_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     conversational_balance:
 *                       type: string
 *                     conversational_balance_score:
 *                       type: number
 *                     conversational_balance_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     conversation_flow:
 *                       type: string
 *                     conversation_flow_score:
 *                       type: number
 *                     conversation_flow_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     curiosity:
 *                       type: string
 *                     curiosity_score:
 *                       type: number
 *                     curiosity_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     energy_alignment:
 *                       type: string
 *                     energy_alignment_score:
 *                       type: number
 *                     energy_alignment_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     humor_alignment:
 *                       type: string
 *                     humor_alignment_score:
 *                       type: number
 *                     humor_alignment_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     listening_responsiveness:
 *                       type: string
 *                     listening_responsiveness_score:
 *                       type: number
 *                     listening_responsiveness_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     repair_attempts:
 *                       type: string
 *                     repair_attempts_score:
 *                       type: number
 *                     repair_attempts_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     responsiveness:
 *                       type: string
 *                     responsiveness_score:
 *                       type: number
 *                     responsiveness_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     shared_moments:
 *                       type: string
 *                     shared_moments_score:
 *                       type: number
 *                     shared_moments_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     tension_handling:
 *                       type: string
 *                     tension_handling_score:
 *                       type: number
 *                     tension_handling_level:
 *                       type: string
 *                       enum: [strong, mixed, strained, not-observed]
 *                     pay_attention_to:
 *                       type: array
 *                       items:
 *                         type: string
 *                     compatibility_penalty:
 *                       type: string
 *                     compatibility_penalty_points:
 *                       type: number
 *                     when:
 *                       type: string
 *                       format: date
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *                     inputTokens:
 *                       type: number
 *                     outputTokens:
 *                       type: number
 *       400:
 *         description: Invalid moment_id or signature
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         description: Internal server error
 */
router.get('/:moment_id', use(moment.viewMomentById))

/**
 * @openapi
 * /api/dating-meet/{moment_id}/share:
 *   get:
 *     summary: Generate a shareable URL for a dating meet
 *     security:
 *       - bearerAuth: []
 *     description: Generate a shareable URL for a dating meet identified by its ID.
 *     tags: [Dating Meet]
 *     parameters:
 *       - in: path
 *         name: moment_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the dating meet to generate a shareable URL for.
 *     responses:
 *       200:
 *         description: Returns a shareable URL for the specified dating meet
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       description: The shareable URL for the dating meet
 *       400:
 *         description: Bad request, missing or invalid moment_id parameter
 *       500:
 *         description: Internal server error
 */
router.get('/:moment_id/share', use(moment.shareMomentURL))

/**
 * @openapi
 * /api/dating-meet/{moment_id}:
 *   delete:
 *     summary: Delete dating meet by ID
 *     security:
 *       - bearerAuth: []
 *     description: Delete dating meet by ID
 *     tags: [Dating Meet]
 *     parameters:
 *       - in: path
 *         name: moment_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the dating meet to delete.
 *       - in: query
 *         name: hard_delete
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether to perform a hard delete (admin only). Defaults to false.
 *     responses:
 *       200:
 *         description: Dating meet deleted successfully
 *       400:
 *         description: Bad request, missing or invalid moment_id parameter
 *       500:
 *         description: Internal server error
 */
router.delete('/:moment_id', use(moment.deleteMoment))

export default router
