import { Router, Request, Response } from 'express'
import * as moment from '../../resources/moment/controller'

export const router = Router()
const use = (fn: (req: any, res: Response, next: any) => any) => async (req: Request, res: Response, next: any) => await Promise.resolve(fn(req, res, next)).catch(next)

/**
 * @openapi
 * /api/moment:
 *   get:
 *     summary: Get moments
 *     security:
 *       - bearerAuth: []
 *     description: Get moment(s). If a user_target query parameter is provided, it filters moments involving that user.
 *     tags: [Moment]
 *     parameters:
 *       - in: query
 *         name: user_target
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: number
 *           default: 20
 *       - in: query
 *         name: skip
 *         required: false
 *         schema:
 *           type: number
 *           default: 0
 *     responses:
 *       200:
 *         description: Returns moment(s)
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
 *                       user_b:
 *                         type: object
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
 *                       summary_a:
 *                         type: string
 *                       summary_b:
 *                         type: string
 *                       model:
 *                         type: string
 *                       provider:
 *                         type: string
 *                         enum: ['openai', 'claude', 'gemini', 'custom']
 *                       journal_a:
 *                         type: array
 *                         items:
 *                           type: string
 *                       journal_b:
 *                         type: array
 *                         items:
 *                           type: string
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
 *                       next_scenarios:
 *                         type: array
 *                         description: AI-generated next date scenario options.
 *                         items:
 *                           type: object
 *                           properties:
 *                             location:
 *                               type: string
 *                             scenario_type:
 *                               type: string
 *                               enum: [conversation_first, playful, collaborative, mild_tension]
 *                             description:
 *                               type: string
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
 *                       feedback:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             _id:
 *                               type: string
 *                             source:
 *                               type: string
 *                               enum:
 *                                 - user_a
 *                                 - user_b
 *                                 - ai
 *                                 - manager
 *                                 - external
 *                             target:
 *                               type: string
 *                               enum:
 *                                 - ember
 *                                 - simmie
 *                                 - relationship
 *                                 - personal
 *                             validation_score:
 *                               type: number
 *                             question:
 *                               type: string
 *                             answer:
 *                               type: string
 *                             comment:
 *                               type: string
 *                             title:
 *                               type: string
 *                             summary:
 *                               type: string
 *                             when:
 *                               type: string
 *                               format: date-time
 *                       when:
 *                         type: string
 *                         format: date
 *                       tags:
 *                         type: array
 *                         items:
 *                           type: string
 *                       image_urls:
 *                         type: array
 *                         items:
 *                           type: string
 *       500:
 *         description: Internal server error
 */
router.get('/', use(moment.viewMoment))

/**
 * @openapi
 * /api/moment/{moment_id}:
 *   get:
 *     tags: [Moment]
 *     summary: Get moment by ID
 *     operationId: getMomentById
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
 *         description: Returns moment
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
 *                     user_b:
 *                       type: object
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
 *                     summary_a:
 *                       type: string
 *                     summary_b:
 *                       type: string
 *                     model:
 *                       type: string
 *                     provider:
 *                       type: string
 *                       enum: ['openai', 'claude', 'gemini', 'custom']
 *                     journal_a:
 *                       type: array
 *                       items:
 *                         type: string
 *                     journal_b:
 *                       type: array
 *                       items:
 *                         type: string
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
 *                     next_scenarios:
 *                       type: array
 *                       description: AI-generated next date scenario options.
 *                       items:
 *                         type: object
 *                         properties:
 *                           location:
 *                             type: string
 *                           scenario_type:
 *                             type: string
 *                             enum: [conversation_first, playful, collaborative, mild_tension]
 *                           description:
 *                             type: string
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
 *                     feedback:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           source:
 *                             type: string
 *                             enum:
 *                               - user_a
 *                               - user_b
 *                               - ai
 *                               - manager
 *                               - external
 *                           target:
 *                             type: string
 *                             enum:
 *                               - ember
 *                               - simmie
 *                               - relationship
 *                               - personal
 *                           validation_score:
 *                             type: number
 *                           question:
 *                             type: string
 *                           answer:
 *                             type: string
 *                           comment:
 *                             type: string
 *                           title:
 *                             type: string
 *                           summary:
 *                             type: string
 *                           when:
 *                             type: string
 *                             format: date-time
 *                     when:
 *                       type: string
 *                       format: date
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *                     image_urls:
 *                       type: array
 *                       items:
 *                         type: string
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
 * /api/moment/{moment_id}/share:
 *   get:
 *     summary: Generate a shareable URL for a moment
 *     security:
 *       - bearerAuth: []
 *     description: Generate a shareable URL for a moment identified by its ID.
 *     tags: [Moment]
 *     parameters:
 *       - in: path
 *         name: moment_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the moment to generate a shareable URL for.
 *     responses:
 *       200:
 *         description: Returns a shareable URL for the specified moment
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
 *                       description: The shareable URL for the moment
 *       400:
 *         description: Bad request, missing or invalid moment_id parameter
 *       500:
 *         description: Internal server error
 */
router.get('/:moment_id/share', use(moment.shareMomentURL))

/**
 * @openapi
 * /api/moment/{moment_id}:
 *   delete:
 *     summary: Delete moment by ID
 *     security:
 *       - bearerAuth: []
 *     description: Delete moment by ID
 *     tags: [Moment]
 *     parameters:
 *       - in: path
 *         name: moment_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the moment to delete.
 *       - in: query
 *         name: hard_delete
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether to perform a hard delete (admin only). Defaults to false.
 *     responses:
 *       200:
 *         description: Moment deleted successfully
 *       400:
 *         description: Bad request, missing or invalid moment_id parameter
 *       500:
 *         description: Internal server error
 */
router.delete('/:moment_id', use(moment.deleteMoment))

/**
 * @openapi
 * /api/moment/{moment_id}:
 *   patch:
 *     summary: Update a moment by ID
 *     security:
 *       - bearerAuth: []
 *     description: Update a moment by ID. Only the creator of the moment or an admin can perform this action.
 *     tags: [Moment]
 *     parameters:
 *       - in: path
 *         name: moment_id
 *         required: true
 *         description: The ID of the moment to update.
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *                feedback:
 *                  type: object
 *                  properties:
 *                    source:
 *                      type: string
 *                      enum:
 *                       - user_a
 *                       - user_b
 *                       - ai
 *                       - manager
 *                       - external
 *                      description: The source of the feedback. This indicates who is providing the feedback, which can be useful for understanding the perspective and context of the feedback. For example, feedback from user_a might reflect their personal experience and feelings about the moment, while feedback from an AI might provide an objective analysis based on the data. Including the source helps to humanize the feedback and allows users to better relate to it.
 *                    target:
 *                      type: string
 *                      enum:
 *                       - ember
 *                       - simmie
 *                       - relationship
 *                       - personal
 *                      description: The target of the feedback. This indicates what aspect of the moment the feedback is directed towards. For example, if the target is "relationship", the feedback might be about how the moment impacted the relationship between user_a and user_b. If the target is "personal", it might be about how the moment affected the individual's feelings or personal growth. Including the target helps to provide clarity and context for the feedback, making it more actionable and meaningful for users.
 *                    validation_score:
 *                      type: number
 *                      description: A score representing the validation of the feedback. This can be used to indicate how strongly the feedback is felt or how important it is. For example, a higher validation score might indicate that the feedback is particularly significant or resonates strongly with the person providing it. This can help users prioritize which feedback to pay attention to and reflect upon.
 *                    title:
 *                      type: string
 *                      description: A title for the feedback. This can be a brief summary or headline that captures the essence of the feedback. Providing a title can help users quickly understand the main point of the feedback and make it more engaging and memorable.
 *                    summary:
 *                      type: string
 *                      description: A summary of the feedback. This can provide a more detailed explanation or reflection on the feedback, allowing users to gain deeper insights and understanding. A well-written summary can help users connect with the feedback on a more emotional level and encourage them to reflect on it more thoughtfully.
 *                    question:
 *                      type: string
 *                    answer:
 *                      type: string
 *                    comment:
 *                      type: string
 *                    when:
 *                      type: string
 *                      format: date-time
 *     responses:
 *       200:
 *         description: Moment updated successfully
 *       400:
 *         description: Bad request, missing required fields or invalid moment_id
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         description: Internal server error
 */
router.patch('/:moment_id', use(moment.updateMoment))

/**
 * @openapi
 * /api/moment:
 *   post:
 *     summary: Create a new moment
 *     security:
 *       - bearerAuth: []
 *     description: Create a new moment with the provided details.
 *     tags: [Moment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum:
 *                   - date
 *                   - text
 *                   - chat
 *                   - call
 *                   - gathering
 *                   - coaching
 *                 description: The type of the moment.
 *                 default: date
 *               universe:
 *                 type: string
 *                 enum:
 *                   - simmer-world
 *                   - reality
 *                 default: simmer-world
 *                 description: The universe in which the moment takes place.
 *               private_to_a:
 *                 type: boolean
 *                 description: Whether the moment is private to user_a. Defaults to false.
 *               source:
 *                 type: string
 *                 enum:
 *                   - user
 *                   - ai
 *                   - external
 *                 default: ai
 *                 description: The source of the moment.
 *               summary_a:
 *                 type: string
 *                 description: A brief summary of the moment.
 *               summary_b:
 *                 type: string
 *                 description: An additional summary of the moment.
 *               conversation:
 *                 type: string
 *                 description: Full conversation transcript or text content for this moment.
 *               location:
 *                 type: string
 *                 description: The location where the moment took place.
 *               title:
 *                 type: string
 *                 description: A title for the moment.
 *               items:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: A list of items associated with the moment (e.g., topics discussed, activities done).
 *               mood:
 *                 type: string
 *                 description: The overall mood of the moment.
 *               final_why:
 *                 type: object
 *                 description: A final reflection on why the moment was significant or what was learned from it.
 *                 properties:
 *                   observations:
 *                     type: array
 *                     items:
 *                       type: string
 *                   insight:
 *                     type: string
 *               next_scenarios:
 *                 type: array
 *                 description: AI-generated next date scenario options.
 *                 items:
 *                   type: object
 *                   properties:
 *                     location:
 *                       type: string
 *                     scenario_type:
 *                       type: string
 *                       enum: [conversation_first, playful, collaborative, mild_tension]
 *                     description:
 *                       type: string
 *               tone_score:
 *                 type: number
 *                 description: A score representing the overall tone of the moment.
 *               match_score:
 *                 type: number
 *                 description: A score representing the overall match of the moment.
 *               chemistry_signals:
 *                 type: string
 *                 description: A description of the chemistry signals of the moment.
 *               chemistry_signals_score:
 *                 type: number
 *                 description: A score representing chemistry signals in the moment.
 *               chemistry_signals_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               conversational_balance:
 *                 type: string
 *                 description: A description of the conversational balance observed in the moment.
 *               conversational_balance_score:
 *                 type: number
 *                 description: A score representing conversational balance in the moment.
 *               conversational_balance_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               conversation_flow:
 *                 type: string
 *                 description: A description of the conversation flow of the moment.
 *               conversation_flow_score:
 *                 type: number
 *                 description: A score representing the overall conversation flow of the moment.
 *               conversation_flow_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               curiosity:
 *                 type: string
 *                 description: A description of the curiosity shown during the moment.
 *               curiosity_score:
 *                 type: number
 *                 description: A score representing curiosity in the moment.
 *               curiosity_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               energy_alignment:
 *                 type: string
 *                 description: A description of the energy alignment between participants.
 *               energy_alignment_score:
 *                 type: number
 *                 description: A score representing energy alignment in the moment.
 *               energy_alignment_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               humor_alignment:
 *                 type: string
 *                 description: A description of how humor was aligned between participants.
 *               humor_alignment_score:
 *                 type: number
 *                 description: A score representing humor alignment in the moment.
 *               humor_alignment_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               listening_responsiveness:
 *                 type: string
 *                 description: A description of the listening and responsiveness during the moment.
 *               listening_responsiveness_score:
 *                 type: number
 *                 description: A score representing listening responsiveness in the moment.
 *               listening_responsiveness_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               repair_attempts:
 *                 type: string
 *                 description: A description of any repair attempts made during the moment.
 *               repair_attempts_score:
 *                 type: number
 *                 description: A score representing repair attempts in the moment.
 *               repair_attempts_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               responsiveness:
 *                 type: string
 *                 description: A description of the responsiveness of the moment.
 *               responsiveness_score:
 *                 type: number
 *                 description: A score representing the overall responsiveness of the moment.
 *               responsiveness_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               shared_moments:
 *                 type: string
 *                 description: A description of the shared moments of the moment.
 *               shared_moments_score:
 *                 type: number
 *                 description: A score representing the overall shared moments of the moment.
 *               shared_moments_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               tension_handling:
 *                 type: string
 *                 description: A description of the tension handling of the moment.
 *               tension_handling_score:
 *                 type: number
 *                 description: A score representing the overall tension handling of the moment.
 *               tension_handling_level:
 *                 type: string
 *                 enum:
 *                   - Strong
 *                   - Mixed
 *                   - Strained
 *               pay_attention_to:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: A list of things to pay attention to from this moment.
 *               compatibility_penalty:
 *                 type: string
 *                 description: A description of any compatibility penalties observed in the moment.
 *               compatibility_penalty_points:
 *                 type: number
 *                 description: A score representing the points deducted for compatibility penalties in the moment.
 *               when:
 *                 type: string
 *                 format: date
 *                 description: The date and time when the moment took place.
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: A list of tags associated with the moment for categorization and search purposes.
 *               journal_a:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: A list of journal entries or reflections associated with the moment.
 *               journal_b:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: An additional list of journal entries or reflections associated with the moment.
 *               feedback:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     question:
 *                       type: string
 *                     answer:
 *                       type: string
 *                     comment:
 *                       type: string
 *                     when:
 *                       type: string
 *                       format: date-time
 *                     source:
 *                       type: string
 *                       enum:
 *                         - ai
 *                         - manager
 *                         - external
 *                       description: The source of the feedback. This indicates who is providing the feedback, which can be useful for understanding the perspective and context of the feedback. For example, feedback from user_a might reflect their personal experience and feelings about the moment, while feedback from an AI might provide an objective analysis based on the data. Including the source helps to humanize the feedback and allows users to better relate to it.
 *                     target:
 *                       type: string
 *                       enum:
 *                         - ember
 *                         - simmie
 *                         - relationship
 *                         - personal
 *                     validation_score:
 *                       type: number
 *                       description: A score representing the validation of the feedback.
 *                     title:
 *                       type: string
 *                       description: A title for the feedback.
 *                     summary:
 *                       type: string
 *                       description: A summary of the feedback.
 *     responses:
 *       201:
 *         description: Moment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   description: The ID of the created moment.
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     moment:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                           description: The ID of the created moment.
 *                         user_a:
 *                           type: string
 *                           description: The ID of user A associated with the moment.
 *                         user_b:
 *                           type: string
 *                           description: The ID of user B associated with the moment.
 *                         type:
 *                           type: string
 *                           description: The type of the moment (e.g., date, chat, call).
 *                           enum:
 *                             - date
 *                             - text
 *                             - chat
 *                             - call
 *                             - gathering
 *                             - coaching
 *                         universe:
 *                           type: string
 *                           description: The universe associated with the moment.
 *                         source:
 *                           type: string
 *                           description: The source of the moment.
 *                         private_to_a:
 *                           type: boolean
 *                         summary_a:
 *                           type: string
 *                           description: A brief summary of the moment.
 *                         summary_b:
 *                           type: string
 *                           description: An additional summary of the moment.
 *                         conversation:
 *                           type: string
 *                           description: Full conversation transcript or text content for this moment.
 *                         location:
 *                           type: string
 *                           description: The location where the moment took place.
 *                         title:
 *                           type: string
 *                           description: A title for the moment.
 *                         items:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: A list of items associated with the moment (e.g., topics discussed, activities done).
 *                         mood:
 *                           type: string
 *                           description: The overall mood of the moment.
 *                         final_why:
 *                           type: object
 *                           description: The final reason or explanation for the moment.
 *                           properties:
 *                             observations:
 *                               type: array
 *                               items:
 *                                 type: string
 *                             insight:
 *                               type: string
 *                         next_scenarios:
 *                           type: array
 *                           description: AI-generated next date scenario options.
 *                           items:
 *                             type: object
 *                             properties:
 *                               location:
 *                                 type: string
 *                               scenario_type:
 *                                 type: string
 *                                 enum: [conversation_first, playful, collaborative, mild_tension]
 *                               description:
 *                                 type: string
 *                         tone_score:
 *                           type: number
 *                           description: The tone score of the moment.
 *                         match_score:
 *                           type: number
 *                           description: The match score of the moment.
 *                         chemistry_signals:
 *                           type: string
 *                           description: A description of chemistry signals observed in the moment.
 *                         chemistry_signals_score:
 *                           type: number
 *                           description: The chemistry signals score of the moment.
 *                         chemistry_signals_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         conversational_balance:
 *                           type: string
 *                           description: A description of the conversational balance observed in the moment.
 *                         conversational_balance_score:
 *                           type: number
 *                           description: The conversational balance score of the moment.
 *                         conversational_balance_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         conversation_flow:
 *                           type: string
 *                           description: A description of conversation flow observed in the moment.
 *                         conversation_flow_score:
 *                           type: number
 *                           description: The conversation flow score of the moment.
 *                         conversation_flow_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         curiosity:
 *                           type: string
 *                           description: A description of the curiosity shown during the moment.
 *                         curiosity_score:
 *                           type: number
 *                           description: The curiosity score of the moment.
 *                         curiosity_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         energy_alignment:
 *                           type: string
 *                           description: A description of the energy alignment between participants.
 *                         energy_alignment_score:
 *                           type: number
 *                           description: The energy alignment score of the moment.
 *                         energy_alignment_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         humor_alignment:
 *                           type: string
 *                           description: A description of how humor was aligned between participants.
 *                         humor_alignment_score:
 *                           type: number
 *                           description: The humor alignment score of the moment.
 *                         humor_alignment_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         listening_responsiveness:
 *                           type: string
 *                           description: A description of the listening and responsiveness during the moment.
 *                         listening_responsiveness_score:
 *                           type: number
 *                           description: The listening responsiveness score of the moment.
 *                         listening_responsiveness_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         repair_attempts:
 *                           type: string
 *                           description: A description of any repair attempts made during the moment.
 *                         repair_attempts_score:
 *                           type: number
 *                           description: The repair attempts score of the moment.
 *                         repair_attempts_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         responsiveness:
 *                           type: string
 *                           description: A description of responsiveness during the moment.
 *                         responsiveness_score:
 *                           type: number
 *                           description: The responsiveness score of the moment.
 *                         responsiveness_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         shared_moments:
 *                           type: string
 *                           description: A description of shared moments during the interaction.
 *                         shared_moments_score:
 *                           type: number
 *                           description: The shared moments score of the moment.
 *                         shared_moments_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         tension_handling:
 *                           type: string
 *                           description: A description of tension handling during the moment.
 *                         tension_handling_score:
 *                           type: number
 *                           description: The tension handling score of the moment.
 *                         tension_handling_level:
 *                           type: string
 *                           enum: [strong, mixed, strained, not-observed]
 *                         pay_attention_to:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: A list of things to pay attention to from this moment.
 *                         feedback:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                               title:
 *                                 type: string
 *                               summary:
 *                                 type: string
 *                               question:
 *                                 type: string
 *                               answer:
 *                                 type: string
 *                               comment:
 *                                 type: string
 *                               when:
 *                                 type: string
 *                                 format: date-time
 *                               source:
 *                                 type: string
 *                                 enum:
 *                                   - user_a
 *                                   - user_b
 *                                   - ai
 *                                   - manager
 *                                   - external
 *                               target:
 *                                 type: string
 *                                 enum:
 *                                   - ember
 *                                   - simmie
 *                                   - relationship
 *                                   - personal
 *                               validation_score:
 *                                 type: number
 *                                 description: A score representing the validation of the feedback.
 *                     learning:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         user_id:
 *                           type: string
 *                         moment_ids:
 *                           type: array
 *                           items:
 *                             type: string
 *                         facts:
 *                           type: array
 *                           items:
 *                             type: string
 *                         preferences:
 *                           type: array
 *                           items:
 *                             type: string
 *                         avoidances:
 *                           type: array
 *                           items:
 *                             type: string
 *                         summary:
 *                           type: string
 *                         insights:
 *                           type: array
 *                           items:
 *                             type: string
 *                         hypotheses:
 *                           type: array
 *                           items:
 *                             type: string
 *       400:
 *         description: Bad request, missing required fields or invalid data
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         description: Internal server error
 */
router.post('/', use(moment.createMoment))

export default router
