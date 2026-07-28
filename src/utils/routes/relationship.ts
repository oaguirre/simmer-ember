import { Router, Request, Response } from 'express'
import * as relationship from '../../resources/relationship/controller'

export const router = Router()
const use = (fn: (req: any, res: Response, next: any) => any) => async (req: Request, res: Response, next: any) => await Promise.resolve(fn(req, res, next)).catch(next)

/**
 * @openapi
 * /api/relationship/count:
 *   get:
 *     summary: Get all relationships available or with a target user
 *     security:
 *       - bearerAuth: []
 *     description: Get all relationships available or with a target user. If a `user_target` query parameter is provided, it will filter relationships involving that user. If not provided, it returns all relationships involving the requester.
 *     tags: [Relationship]
 *     parameters:
 *       - in: query
 *         name: user_target
 *         required: false
 *         description: The ID of the user to filter relationships. If not provided, returns all relationships involving the requester.
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         required: false
 *         description: The maximum number of relationships to return. Defaults to 10 if not provided.
 *         schema:
 *           type: integer
 *       - in: query
 *         name: skip
 *         required: false
 *         description: The number of relationships to skip. Defaults to 0 if not provided.
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Successful response
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
 *                         description: relationship ID
 *                       user_a:
 *                         type: string
 *                       user_b:
 *                         type: string
 *                       stage:
 *                         type: string
 *                         enum:
 *                           - initial
 *                           - presented
 *                           - matched
 *                           - talking
 *                           - friends
 *                           - dating
 *                           - exclusive
 *                           - serious_relationship
 *                           - engaged
 *                           - married
 *                           - separated
 *                           - ended
 *                       status:
 *                         type: string
 *                         enum:
 *                           - initial
 *                           - ongoing
 *                           - not_interested
 *                           - blocked
 *                           - removed_by_a
 *                           - removed_by_b
 *                           - suspended
 *                       anniversary_date:
 *                         type: string
 *                         format: date-time
 *                       user:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           first_name:
 *                             type: string
 *                           presignedAvatarUrl:
 *                             type: string
 *       400:
 *         description: Bad request, missing required fields
 *       500:
 *         description: Internal server error
 */
router.get('/count', use(relationship.getMomentsCountPerRelationship))

/**
 * @openapi
 * /api/relationship:
 *   get:
 *     summary: Get all relationships available or with a target user
 *     security:
 *       - bearerAuth: []
 *     description: Get all relationships available or with a target user. If a `user_target` query parameter is provided, it will filter relationships involving that user. If not provided, it returns all relationships involving the requester.
 *     tags: [Relationship]
 *     parameters:
 *       - in: query
 *         name: user_target
 *         required: false
 *         description: The ID of the user to filter relationships. If not provided, returns all relationships involving the requester.
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         required: false
 *         description: The maximum number of relationships to return. Defaults to 10 if not provided.
 *         schema:
 *           type: integer
 *       - in: query
 *         name: skip
 *         required: false
 *         description: The number of relationships to skip. Defaults to 0 if not provided.
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Successful response
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
 *                         type: string
 *                       user_b:
 *                         type: string
 *                       stage:
 *                         type: string
 *                         enum:
 *                           - initial
 *                           - presented
 *                           - matched
 *                           - talking
 *                           - friends
 *                           - dating
 *                           - exclusive
 *                           - serious_relationship
 *                           - engaged
 *                           - married
 *                           - separated
 *                           - ended
 *                       status:
 *                         type: string
 *                         enum:
 *                           - initial
 *                           - ongoing
 *                           - not_interested
 *                           - blocked
 *                           - removed_by_a
 *                           - removed_by_b
 *                           - suspended
 *                       anniversary_date:
 *                         type: string
 *                         format: date-time
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *       400:
 *         description: Bad request, missing required fields
 *       500:
 *         description: Internal server error
 */
router.get('/', use(relationship.getRelationships))

/**
 * @openapi
 * /api/relationship/{id}:
 *   get:
 *     summary: Get relationship status with another user
 *     security:
 *       - bearerAuth: []
 *     description: Get relationship status with another user
 *     tags: [Relationship]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: The ID of the relationship to check.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response
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
 *                     stage:
 *                       type: string
 *                       enum:
 *                         - initial
 *                         - presented
 *                         - matched
 *                         - talking
 *                         - friends
 *                         - dating
 *                         - exclusive
 *                         - serious_relationship
 *                         - engaged
 *                         - married
 *                         - separated
 *                         - ended
 *                     status:
 *                       type: string
 *                       enum:
 *                         - initial
 *                         - ongoing
 *                         - not_interested
 *                         - blocked
 *                         - removed_by_a
 *                         - removed_by_b
 *                         - suspended
 *                     anniversary_date:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Bad request, missing required fields
 *       500:
 *         description: Internal server error
 */
router.get('/:id', use(relationship.getRelationship))

/**
 * @openapi
 * /api/relationship/{id}:
 *   patch:
 *     tags: [Relationship]
 *     summary: Update relationship by relationship ID
 *     operationId: updateRelationshipById
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Relationship updated
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */

/**
 * @openapi
 * /api/relationship/{id}:
 *   delete:
 *     tags: [Relationship]
 *     summary: Delete relationship by relationship ID
 *     operationId: deleteRelationshipById
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stage:
 *                 type: string
 *                 enum:
 *                   - initial
 *                   - presented
 *                   - matched
 *                   - talking
 *                   - friends
 *                   - dating
 *                   - exclusive
 *                   - serious_relationship
 *                   - engaged
 *                   - married
 *                   - separated
 *                   - ended
 *               status:
 *                 type: string
 *                 enum:
 *                   - initial
 *                   - ongoing
 *                   - not_interested
 *                   - blocked
 *                   - removed_by_a
 *                   - removed_by_b
 *                   - suspended
 *               anniversary_date:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Successful response
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
 *                       type: string
 *                     user_b:
 *                       type: string
 *                     stage:
 *                       type: string
 *                       enum:
 *                         - initial
 *                         - presented
 *                         - matched
 *                         - talking
 *                         - friends
 *                         - dating
 *                         - exclusive
 *                         - serious_relationship
 *                         - engaged
 *                         - married
 *                         - separated
 *                         - ended
 *                     status:
 *                       type: string
 *                       enum:
 *                         - initial
 *                         - ongoing
 *                         - not_interested
 *                         - blocked
 *                         - removed_by_a
 *                         - removed_by_b
 *                         - suspended
 *                     anniversary_date:
 *                       type: string
 *                       format: date-time
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Bad request, missing required fields or relationship not found
 *       500:
 *         description: Internal server error
 */
router.patch('/:id', use(relationship.updateRelationship))

/**
 * @openapi
 * /api/relationship/{id}:
 *   patch:
 *     summary: Update relationship status with another user
 *     security:
 *       - bearerAuth: []
 *     description: Update relationship status with another user. The relationship can be identified either by its ID or by the target user ID. If both are provided, the ID will be used.
 *     tags: [Relationship]
 *     parameters:
 *       - in: query
 *         name: user_target
 *         required: false
 *         description: The ID of the target user to identify the relationship with. If not provided, it will be identified by the id parameter.
 *         schema:
 *           type: string
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stage:
 *                 type: string
 *                 enum:
 *                   - initial
 *                   - presented
 *                   - matched
 *                   - talking
 *                   - friends
 *                   - dating
 *                   - exclusive
 *                   - serious_relationship
 *                   - engaged
 *                   - married
 *                   - separated
 *                   - ended
 *               status:
 *                 type: string
 *                 enum:
 *                   - initial
 *                   - ongoing
 *                   - not_interested
 *                   - blocked
 *                   - removed_by_a
 *                   - removed_by_b
 *                   - suspended
 *               anniversary_date:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Successful response
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
 *                       type: string
 *                     user_b:
 *                       type: string
 *                     stage:
 *                       type: string
 *                       enum:
 *                         - initial
 *                         - presented
 *                         - matched
 *                         - talking
 *                         - friends
 *                         - dating
 *                         - exclusive
 *                         - serious_relationship
 *                         - engaged
 *                         - married
 *                         - separated
 *                         - ended
 *                     status:
 *                       type: string
 *                       enum:
 *                         - initial
 *                         - ongoing
 *                         - not_interested
 *                         - blocked
 *                         - removed_by_a
 *                         - removed_by_b
 *                         - suspended
 *                     anniversary_date:
 *                       type: string
 *                       format: date-time
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Bad request, missing required fields or relationship not found
 *       500:
 *         description: Internal server error
 */
router.patch('/:id', use(relationship.updateRelationship))
router.patch('/', use(relationship.updateRelationship))

/**
 * @openapi
 * /api/relationship/{id}:
 *   delete:
 *     summary: Delete a relationship with another user
 *     security:
 *       - bearerAuth: []
 *     description: Delete a relationship with another user. The relationship can be identified either by its ID or by the target user ID. If both are provided, the ID will be used.
 *     tags: [Relationship]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: false
 *         description: The ID of the relationship to delete. If not provided, it will be identified by the user_target parameter.
 *         schema:
 *           type: string
 *       - in: query
 *         name: user_target
 *         required: false
 *         description: The ID of the target user to identify the relationship with. If not provided, it will be identified by the id parameter.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response indicating the relationship was deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   description: Message indicating the relationship was deleted successfully
 *       400:
 *         description: Bad request, missing required fields or relationship not found
 *       500:
 *         description: Internal server error
 */
router.delete('/:id', use(relationship.deleteRelationship))

export default router
