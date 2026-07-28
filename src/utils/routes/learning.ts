import { Router, Request, Response } from 'express'
import * as learning from '../../resources/learning/controller'

export const router = Router()
const use = (fn: (req: any, res: Response, next: any) => any) => async (req: Request, res: Response, next: any) => await Promise.resolve(fn(req, res, next)).catch(next)

/**
 * @openapi
 * /api/learning:
 *   get:
 *     summary: Get all learning entries for the authenticated user
 *     description: Retrieve all learning entries associated with the authenticated user, including facts, preferences, avoidances, moment_ids, and summary.
 *     tags: [Learning]
 *     responses:
 *       200:
 *         description: Successful response with an array of learning entries
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
 *                       user_id:
 *                         type: string
 *                       facts:
 *                         type: array
 *                         items:
 *                           type: string
 *                       preferences:
 *                         type: array
 *                         items:
 *                           type: string
 *                       avoidances:
 *                         type: array
 *                         items:
 *                           type: string
 *                       moment_ids:
 *                         type: array
 *                         items:
 *                           type: string
 *                       summary:
 *                         type: string
 *       401:
 *         description: Unauthorized access, user not authenticated
 *       500:
 *         description: Internal server error
 */
router.get('/', use(learning.getLearnings))

/**
 * @openapi
 * /api/learning/moment/{momentId}:
 *   get:
 *     summary: Get learning entries for a specific moment ID
 *     description: Retrieve learning entries associated with a specific moment ID for the authenticated user, including facts, preferences, avoidances, moment_ids, and summary.
 *     tags: [Learning]
 *     parameters:
 *       - in: path
 *         name: momentId
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the moment to retrieve learning entries for
 *     responses:
 *       200:
 *         description: Successful response with an array of learning entries for the specified moment ID
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
 *                       user_id:
 *                         type: string
 *                       facts:
 *                         type: array
 *                         items:
 *                           type: string
 *                       preferences:
 *                         type: array
 *                         items:
 *                           type: string
 *                       avoidances:
 *                         type: array
 *                         items:
 *                           type: string
 *                       moment_ids:
 *                         type: array
 *                         items:
 *                           type: string
 *                       summary:
 *                         type: string
 *       401:
 *         description: Unauthorized access, user not authenticated
 *       500:
 *         description: Internal server error
 */
router.get('/moment/:momentId', use(learning.getLearningsByMomentId))

/**
 * @openapi
 * /api/learning/{id}:
 *   get:
 *     summary: Get a specific learning entry by ID
 *     description: Retrieve a specific learning entry by its unique ID, including facts, preferences, avoidances, moment_ids, and summary.
 *     tags: [Learning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the learning entry to retrieve
 *     responses:
 *       200:
 *         description: Successful response with the requested learning entry
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
 *                     user_id:
 *                       type: string
 *                     facts:
 *                       type: array
 *                       items:
 *                         type: string
 *                     preferences:
 *                       type: array
 *                       items:
 *                         type: string
 *                     avoidances:
 *                       type: array
 *                       items:
 *                         type: string
 *                     moment_ids:
 *                       type: array
 *                       items:
 *                         type: string
 *                     summary:
 *                       type: string
 *       401:
 *         description: Unauthorized access, user not authenticated
 *       500:
 *         description: Internal server error
 */
router.get('/:id', use(learning.getLearningById))

/**
 * @openapi
 * /api/learning/{id}:
 *   patch:
 *     summary: Update a specific learning entry by ID
 *     description: Update a specific learning entry by its unique ID, including facts, preferences, avoidances, moment_ids, and summary.
 *     tags: [Learning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the learning entry to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               facts:
 *                 type: array
 *                 items:
 *                   type: string
 *               preferences:
 *                 type: array
 *                 items:
 *                   type: string
 *               avoidances:
 *                 type: array
 *                 items:
 *                   type: string
 *               moment_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               summary:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response with the updated learning entry
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
 *                     user_id:
 *                       type: string
 *                     facts:
 *                       type: array
 *                       items:
 *                         type: string
 *                     preferences:
 *                       type: array
 *                       items:
 *                         type: string
 *                     avoidances:
 *                       type: array
 *                       items:
 *                         type: string
 *                     moment_ids:
 *                       type: array
 *                       items:
 *                         type: string
 *                     summary:
 *                       type: string
 *       401:
 *         description: Unauthorized access, user not authenticated
 *       403:
 *         description: Forbidden, user does not have permission to update this learning
 *       500:
 *         description: Internal server error
 */
router.patch('/:id', use(learning.updateLearning))

/**
 * @openapi
 * /api/learning/{id}:
 *   delete:
 *     summary: Delete a specific learning entry by ID
 *     description: Delete a specific learning entry by its unique ID.
 *     tags: [Learning]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the learning entry to delete
 *     responses:
 *       200:
 *         description: Successful response confirming deletion of the learning entry
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized access, user not authenticated
 *       403:
 *         description: Forbidden, user does not have permission to delete this learning
 *       500:
 *         description: Internal server error
 */
router.delete('/:id', use(learning.deleteLearning))

export default router
