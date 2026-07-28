import { Router, Request, Response } from 'express'
import { upload } from '../../middleware/multer'
import * as user from '../../resources/user/controller'
import * as media from '../../resources/media/controller'

export const router = Router()
const use = (fn: (req: any, res: Response, next: any) => any) => async (req: Request, res: Response, next: any) => await Promise.resolve(fn(req, res, next)).catch(next)

/**
 * @openapi
 * /api/user:
 *   get:
 *     summary: Get user profile
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Get user profile.
 *
 *       Response variants:
 *       - Self view (`user_target` omitted or equal to requester ID): returns `UserProfileSelf` with allowed private fields such as `email`, `phone`, `loc_latitude`, `loc_longitude`, `loc_address`, `loc_postal_code`, and `date_of_birth`.
 *       - Other-user view (`user_target` points to another user): returns `UserProfilePublic` with private contact data and precise location fields excluded. Public profile content includes `core_questions` and `core_answers`.
 *     tags: [User]
 *     parameters:
 *       - in: query
 *         name: user_target
 *         required: false
 *         schema:
 *           type: string
 *           description: The ID of the user to view. If not provided, defaults to the requester.
 *     responses:
 *       200:
 *         description: Returns user profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   oneOf:
 *                     - description: Returned when viewing your own profile.
 *                       allOf:
 *                         - $ref: '#/components/schemas/UserProfileSelf'
 *                     - description: Returned when viewing another user's profile.
 *                       allOf:
 *                         - $ref: '#/components/schemas/UserProfilePublic'
 *       500:
 *         description: Internal server error
 */
router.get('/', use(user.viewProfile))

/**
 * @openapi
 * /api/user:
 *   post:
 *     summary: Update user profile
 *     security:
 *       - bearerAuth: []
 *     description: Update user profile. Returns a sanitized self-view payload. Password is never returned.
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               username:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum:
 *                   - male
 *                   - female
 *                   - non-binary
 *                   - other
 *                   - prefer_not_to_say
 *               genders_to_date:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum:
 *                     - male
 *                     - female
 *                     - non-binary
 *                     - other
 *               is_test_user:
 *                 type: boolean
 *               is_banned:
 *                 type: boolean
 *               aesthetics:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Aesthetics score of the user (0-100)
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               have_kids:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - yes
 *                   - no
 *                   - prefer_not_to_say
 *               want_kids:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - yes
 *                   - no
 *                   - maybe
 *                   - prefer_not_to_say
 *               height:
 *                 type: number
 *                 description: Height in centimeters or imperial feet (values < 50 interpreted as feet and converted to cm)
 *               weight_lbs:
 *                 type: number
 *                 minimum: 50
 *                 maximum: 700
 *                 description: Weight in pounds (valid range 50-700)
 *               smoking:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - regularly
 *                   - socially
 *                   - rarely
 *                   - never
 *               cannabis:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - regularly
 *                   - socially
 *                   - rarely
 *                   - never
 *                   - sober
 *               relationship_structure:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - long_term_relationship
 *                   - short_term_relationship
 *                   - casual_dating
 *                   - new_friends
 *                   - prefer_not_to_say
 *               pets:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - love
 *                   - like
 *                   - prefer_no
 *                   - allergic
 *               have_pets:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - dog
 *                   - cat
 *                   - other
 *                   - none
 *               education:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - high_school
 *                   - some_college
 *                   - associate_degree
 *                   - bachelors_degree
 *                   - masters_degree
 *                   - doctorate
 *                   - trade_school
 *               education_school:
 *                 type: string
 *               job:
 *                 type: string
 *               religion:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - christian
 *                   - jewish
 *                   - muslim
 *                   - hindu
 *                   - buddhist
 *                   - spiritual
 *                   - agnostic
 *                   - athiest
 *                   - other
 *               faith_importance:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - not_important
 *                   - somewhat_important
 *                   - very_important
 *                   - extremely_important
 *               location_radius:
 *                 type: number
 *               vaccination_stance:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - pro_vaccination
 *                   - anti_vaccination
 *                   - some
 *                   - prefer_not_to_say
 *               deal_break_lightning:
 *                 type: array
 *                 items:
 *                   type: string
 *               loc_latitude:
 *                 type: number
 *               loc_longitude:
 *                 type: number
 *               loc_address:
 *                 type: string
 *               loc_city:
 *                 type: string
 *               loc_state:
 *                 type: string
 *               loc_country:
 *                 type: string
 *                 description: 2-letter country code (e.g., US, CA)
 *               loc_postal_code:
 *                 type: string
 *               drinking:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - regularly
 *                   - socially
 *                   - rarely
 *                   - never
 *                   - sober
 *               exercise:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - daily
 *                   - few_times_per_week
 *                   - once_per_week
 *                   - occasionally
 *                   - rarely
 *                   - never
 *               political_view:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - liberal
 *                   - conservative
 *                   - moderate
 *                   - libertarian
 *                   - apolitical
 *               about:
 *                 type: string
 *               languages:
 *                 type: array
 *                 items:
 *                   type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *                 description: Date of birth. Accepts common date string formats or epoch timestamp values. Must be a valid calendar date, cannot be in the future, and cannot be more than 100 years ago.
 *               born_location:
 *                 type: string
 *               high_priority_values:
 *                 type: array
 *                 items:
 *                   type: string
 *               in_relationship_with:
 *                 type: string
 *                 nullable: true
 *                 description: User ID of the partner the requester is currently in a relationship with. Set null to unset.
 *               core_questions:
 *                 type: array
 *                 items:
 *                   type: string
 *               core_answers:
 *                 type: array
 *                 items:
 *                   type: string
 *               preferences:
 *                 type: object
 *                 properties:
 *                   age_min:
 *                     type: number
 *                   age_max:
 *                     type: number
 *                   distance_max:
 *                     type: number
 *                   height_min:
 *                     type: number
 *                     description: Minimum preferred height (accepts centimeters or imperial feet; values < 50 interpreted as feet and converted to cm)
 *                   height_max:
 *                     type: number
 *                     description: Maximum preferred height (accepts centimeters or imperial feet; values < 50 interpreted as feet and converted to cm)
 *                   exercise:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - daily
 *                         - few_times_per_week
 *                         - once_per_week
 *                         - occasionally
 *                         - rarely
 *                         - never
 *                   have_kids:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - no
 *                         - yes
 *                         - prefer_not_to_say
 *                   smoking:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - regularly
 *                         - socially
 *                         - rarely
 *                         - never
 *                   cannabis:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - regularly
 *                         - socially
 *                         - rarely
 *                         - never
 *                         - sober
 *                   relationship_structure:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - long_term_relationship
 *                         - short_term_relationship
 *                         - casual_dating
 *                         - new_friends
 *                         - prefer_not_to_say
 *                   drinking:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - regularly
 *                         - socially
 *                         - rarely
 *                         - never
 *                         - sober
 *                   political_view:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - liberal
 *                         - conservative
 *                         - moderate
 *                         - libertarian
 *                         - apolitical
 *                   pets:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - dog
 *                         - cat
 *                         - other
 *                         - none
 *     responses:
 *       200:
 *         description: User profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/UserProfileSelf'
 *       500:
 *         description: Internal server error
 */
router.post('/', use(user.updateProfile))

/**
 * @openapi
 * /api/user:
 *   put:
 *     summary: Update user profile
 *     security:
 *       - bearerAuth: []
 *     description: Update user profile. Returns a sanitized self-view payload. Password is never returned.
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               username:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum:
 *                   - male
 *                   - female
 *                   - non-binary
 *                   - other
 *                   - prefer_not_to_say
 *               genders_to_date:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum:
 *                     - male
 *                     - female
 *                     - non-binary
 *                     - other
 *                     - prefer_not_to_say
 *               is_test_user:
 *                 type: boolean
 *               is_banned:
 *                 type: boolean
 *               aesthetics:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Aesthetics score of the user (0-100)
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               have_kids:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - yes
 *                   - no
 *                   - prefer_not_to_say
 *               want_kids:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - yes
 *                   - no
 *                   - prefer_not_to_say
 *               height:
 *                 type: number
 *                 description: Height in centimeters or imperial feet (values < 50 interpreted as feet and converted to cm)
 *               weight_lbs:
 *                 type: number
 *                 minimum: 50
 *                 maximum: 700
 *                 description: Weight in pounds (valid range 50-700)
 *               smoking:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - regularly
 *                   - socially
 *                   - rarely
 *                   - never
 *               cannabis:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - regularly
 *                   - socially
 *                   - rarely
 *                   - never
 *                   - sober
 *               relationship_structure:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - long_term_relationship
 *                   - short_term_relationship
 *                   - casual_dating
 *                   - new_friends
 *                   - prefer_not_to_say
 *               pets:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - love
 *                   - like
 *                   - prefer_no
 *                   - allergic
 *               have_pets:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - dog
 *                   - cat
 *                   - other
 *                   - none
 *               education:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - high_school
 *                   - some_college
 *                   - associate_degree
 *                   - bachelors_degree
 *                   - masters_degree
 *                   - doctorate
 *                   - trade_school
 *               education_school:
 *                 type: string
 *               job:
 *                 type: string
 *               religion:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - christian
 *                   - jewish
 *                   - muslim
 *                   - hindu
 *                   - buddhist
 *                   - spiritual
 *                   - agnostic
 *                   - athiest
 *                   - other
 *               faith_importance:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - not_important
 *                   - somewhat_important
 *                   - very_important
 *                   - extremely_important
 *               location_radius:
 *                 type: number
 *               vaccination_stance:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - pro_vaccination
 *                   - anti_vaccination
 *                   - some
 *                   - prefer_not_to_say
 *               deal_break_lightning:
 *                 type: array
 *                 items:
 *                   type: string
 *               loc_latitude:
 *                 type: number
 *               loc_longitude:
 *                 type: number
 *               loc_address:
 *                 type: string
 *               loc_city:
 *                 type: string
 *               loc_state:
 *                 type: string
 *               loc_country:
 *                 type: string
 *               loc_postal_code:
 *                 type: string
 *               drinking:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - regularly
 *                   - socially
 *                   - rarely
 *                   - never
 *                   - sober
 *               exercise:
 *                 type: string
 *                 enum:
 *                   - unanswered
 *                   - daily
 *                   - few_times_per_week
 *                   - once_per_week
 *                   - occasionally
 *                   - rarely
 *                   - never
 *               political_view:
 *                 type: string
 *                 enum:
 *                   - liberal
 *                   - conservative
 *                   - moderate
 *                   - libertarian
 *                   - apolitical
 *               about:
 *                 type: string
 *               languages:
 *                 type: array
 *                 items:
 *                   type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *                 description: Date of birth. Accepts common date string formats or epoch timestamp values. Must be a valid calendar date, cannot be in the future, and cannot be more than 100 years ago.
 *               born_location:
 *                 type: string
 *               high_priority_values:
 *                 type: array
 *                 items:
 *                   type: string
 *               in_relationship_with:
 *                 type: string
 *                 nullable: true
 *                 description: User ID of the partner the requester is currently in a relationship with. Set null to unset.
 *               core_questions:
 *                 type: array
 *                 items:
 *                   type: string
 *               core_answers:
 *                 type: array
 *                 items:
 *                   type: string
 *               preferences:
 *                 type: object
 *                 properties:
 *                   age_min:
 *                     type: number
 *                   age_max:
 *                     type: number
 *                   distance_max:
 *                     type: number
 *                   height_min:
 *                     type: number
 *                     description: Minimum preferred height (accepts centimeters or imperial feet; values < 50 interpreted as feet and converted to cm)
 *                   height_max:
 *                     type: number
 *                     description: Maximum preferred height (accepts centimeters or imperial feet; values < 50 interpreted as feet and converted to cm)
 *                   exercise:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - daily
 *                         - few_times_per_week
 *                         - once_per_week
 *                         - occasionally
 *                         - rarely
 *                         - never
 *                   have_kids:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - no
 *                         - yes
 *                         - prefer_not_to_say
 *                   smoking:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - regularly
 *                         - socially
 *                         - rarely
 *                         - never
 *                   cannabis:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - regularly
 *                         - socially
 *                         - rarely
 *                         - never
 *                         - sober
 *                   relationship_structure:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - long_term_relationship
 *                         - short_term_relationship
 *                         - casual_dating
 *                         - new_friends
 *                         - prefer_not_to_say
 *                   drinking:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - regularly
 *                         - socially
 *                         - rarely
 *                         - never
 *                         - sober
 *                   political_view:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - liberal
 *                         - conservative
 *                         - moderate
 *                         - libertarian
 *                         - apolitical
 *                   pets:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum:
 *                         - unanswered
 *                         - dog
 *                         - cat
 *                         - other
 *                         - none
 *     responses:
 *       200:
 *         description: User profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/UserProfileSelf'
 *       400:
 *         description: Bad request, missing required fields
 *       500:
 *         description: Internal server error
 */
router.put('/', use(user.updateProfile))

/**
 * @openapi
 * /api/user:
 *   patch:
 *     summary: Partially update user profile
 *     security:
 *       - bearerAuth: []
 *     description: Partially update user profile fields, including setting or unsetting in_relationship_with.
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               is_banned:
 *                 type: boolean
 *               in_relationship_with:
 *                 type: string
 *                 nullable: true
 *                 description: User ID of the partner the requester is currently in a relationship with. Set null to unset.
 *     responses:
 *       200:
 *         description: User profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/UserProfileSelf'
 *       500:
 *         description: Internal server error
 */
router.patch('/', use(user.updateProfile))

/**
 * @openapi
 * /api/user/image:
 *   post:
 *     summary: Upload user images
 *     security:
 *       - bearerAuth: []
 *     description: Upload user image
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *     parameters:
 *       - in: query
 *         name: skip_avatar
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *       - in: query
 *         name: force_avatar
 *         required: false
 *         description: When true, forces avatar regeneration even if the image is a duplicate and an avatar already exists in S3.
 *         schema:
 *           type: boolean
 *           default: false
 *     responses:
 *       200:
 *         description: Image uploaded successfully
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
 *                     mediaId:
 *                       type: string
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     type:
 *                       type: string
 *                       enum:
 *                         - image
 *                         - video
 *                         - audio
 *                         - other
 *                     alias:
 *                       type: string
 *                     imagePath:
 *                       type: string
 *                       description: Path of the uploaded image in S3
 *                     presignedUrl:
 *                       type: string
 *                       description: Presigned URL for accessing the uploaded image for 3600 seconds (1 hour)
 *                     presignedAvatarUrl:
 *                       type: string
 *                       description: Presigned URL for accessing the user's avatar image for 3600 seconds (1 hour)
 *       500:
 *         description: Internal server error
 */
router.post('/image', upload.single('image'), use(media.imageUpload))

/**
 * @openapi
 * /api/user/avatar/recreate:
 *   post:
 *     summary: Recreate requester avatar from moment image or fallback media
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Recreates the requester's avatar.
 *       If `moment_id` is provided and the moment has `profile_image_media_id`, that media is used.
 *       Otherwise, the endpoint falls back to the requester's latest available image.
 *     tags: [User]
 *     parameters:
 *       - in: query
 *         name: moment_id
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional moment ID to source `profile_image_media_id` from.
 *     requestBody:
 *       required: false
 *     responses:
 *       200:
 *         description: Avatar recreated successfully
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
 *                     profile_image_media_id:
 *                       type: string
 *                     presignedAvatarUrl:
 *                       type: string
 *                     source:
 *                       type: string
 *                       enum:
 *                         - moment_profile_image_media_id
 *                         - any_available_image
 *       400:
 *         description: No image available to generate avatar
 *       404:
 *         description: User or moment not found
 *       500:
 *         description: Internal server error
 */
router.post('/avatar/recreate', use(user.recreateAvatar))

/**
 * @openapi
 * /api/user/image/{id}:
 *   delete:
 *     summary: Delete an existing user image
 *     security:
 *       - bearerAuth: []
 *     description: Deletes an existing user image
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the image to delete
 *     responses:
 *       200:
 *         description: Image deleted successfully
 *       500:
 *         description: Internal server error
 */
router.delete('/image/:id', use(media.imageDelete))

/**
 * @openapi
 * /api/user/meet:
 *   post:
 *     summary: Create a date with another user
 *     security:
 *       - bearerAuth: []
 *     description: Create a date with another user
 *     tags: [User]
 *     parameters:
 *       - in: header
 *         name: Content-Type
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - application/json
 *       - in: query
 *         name: user_target
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user to create a date with.
 *       - in: query
 *         name: email
 *         required: false
 *         schema:
 *           type: string
 *         description: The email of the user to create a date with.
 *       - in: query
 *         name: skip_date_image
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Whether to skip generating a date image. Defaults to true.
 *       - in: query
 *         name: matchingPromptVersion
 *         required: false
 *         schema:
 *           type: string
 *         description: The version of the matching prompt used to filter dating meets. If not provided, uses latest. Available versions are v1, v2, v3, v3_1, v3_2.
 *       - in: query
 *         name: summaryPromptVersion
 *         required: false
 *         schema:
 *           type: string
 *         description: The version of the summary prompt used to filter dating meets. If not provided, uses latest. Available versions are v1, v2, v3, v3_2, v3_2_1, v3_2_3, v3_2_4, v4, v4_1, v5, v6, v7 and v7_1.
 *     requestBody:
 *       required: false
 *       description: Optional location data for the date for v3_2_4 and higher, which can be used in the date summary generation. If not provided, it will be taken from the users' profiles or set to a default value in the summary prompt.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               LOCATION:
 *                 type: string
 *                 enum:
 *                   - Coffee-Shop
 *                   - Wine Tasting
 *                   - Art Gallery
 *                   - Picnic
 *                   - Amusement Park
 *                   - Bowling
 *                   - Bookstore
 *                   - Farmer’s Market
 *                   - Arcade
 *                   - Trivia Night
 *                   - Mini Golf
 *                   - Pottery Painting
 *                   - Cooking Class
 *                   - Rock Climbing
 *                   - Horseback Riding
 *                   - Museum
 *                   - Escape Room
 *                   - Street Festival
 *                   - Hiking Trail
 *                   - Boat Ride
 *                   - Zoo
 *               SCENARIO_TYPE:
 *                 type: string
 *                 enum:
 *                   - conversation_first
 *                   - playful
 *                   - collaborative
 *                   - mild_tension
 *               QUESTIONS_FOR_DATE:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Additional questions to be answered for the date, which can be used in the date summary generation. If not provided, no additional questions will be added to the summary prompt.
 *               MY_ANSWERS_FOR_DATE:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: The user's answers to the additional questions for the date, which can be used in the date summary generation. Can be provided if QUESTIONS_FOR_DATE is provided.
 *     responses:
 *       200:
 *         description: Date created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       description: date meeting id
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
 *                        - date
 *                        - text
 *                        - chat
 *                        - call
 *                        - gathering
 *                        - coaching
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
 *                     when:
 *                       type: string
 *                       format: date-time
 *                     summary_a:
 *                       type: string
 *                       description: AI-generated summary of the date from user_a's perspective
 *                     summary_b:
 *                       type: string
 *                       description: AI-generated summary of the date from user_b's perspective
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
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: string
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
 *                     compatibility_penalty:
 *                       type: string
 *                     compatibility_penalty_points:
 *                       type: number
 *                     version:
 *                       type: string
 *                     location:
 *                       type: string
 *                     title:
 *                       type: string
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
 *                     pay_attention_to:
 *                       type: array
 *                       items:
 *                         type: string
 *                     final_why:
 *                       type: object
 *                       properties:
 *                         observations:
 *                           type: array
 *                           items:
 *                             type: string
 *                         insight:
 *                           type: string
 *                     tone_trend:
 *                       type: string
 *                     avg_match_score:
 *                       type: number
 *                     input_tokens:
 *                       type: number
 *                     output_tokens:
 *                       type: number
 *                     image_urls:
 *                       type: array
 *                       description: Presigned URLs for accessing the dating meet images for 3600 seconds (1 hour)
 *                       items:
 *                         type: string
 *       400:
 *         description: Bad request, missing required fields or user not found
 *       500:
 *         description: Internal server error
 */
router.post('/meet', use(user.createMomentWithUser))

/**
 * @openapi
 * /api/user/meet/image-only:
 *   post:
 *     summary: Add an image to an existing date with another user
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Add an image to an existing date with another user
 *       If `moment_id` is provided, `user_target` will be considered from meeting and the
 *       image will be added to that specific dating meet.
 *       If `moment_id` is not provided, but `user_target` is provided, the image will be added to
 *       the most recent dating meet involving the requester.
 *       If neither `moment_id` nor `user_target` are provided, an error will be returned.
 *     tags: [User]
 *     parameters:
 *       - in: query
 *         name: user_target
 *         required: false
 *         schema:
 *           type: string
 *         description: The ID of the user to create a date with. If not provided, it will be taken from the moment_id.
 *       - in: query
 *         name: moment_id
 *         required: false
 *         schema:
 *           type: string
 *         description: The ID of the dating meet to link the image to.
 *     requestBody:
 *       required: false
 *     responses:
 *       200:
 *         description: Date created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   description: Message indicating whether the image was created or updated successfully
 *                 data:
 *                    type: object
 *                    properties:
 *                      meeting_image:
 *                        type: object
 *                        properties:
 *                          dateMeetingPresignedUrl:
 *                            type: string
 *                          inputTokens:
 *                            type: number
 *                          outputTokens:
 *                            type: number
 *                          userApresignedUrl:
 *                            type: string
 *                          userBpresignedUrl:
 *                            type: string
 *                      moment:
 *                        type: object
 *                        properties:
 *                          _id:
 *                            description: date meeting id
 *                            type: string
 *                          user_a:
 *                            type: object
 *                            properties:
 *                              _id:
 *                                type: string
 *                              first_name:
 *                                type: string
 *                              avatar_url:
 *                                type: string
 *                                description: Presigned URL for accessing user_a's avatar image for 3600 seconds (1 hour)
 *                              image_url:
 *                                type: string
 *                                description: Presigned URL for accessing user_a's most recent profile image for 3600 seconds (1 hour)
 *                          user_b:
 *                            type: object
 *                            properties:
 *                              _id:
 *                                type: string
 *                              first_name:
 *                                type: string
 *                              avatar_url:
 *                                type: string
 *                                description: Presigned URL for accessing user_b's avatar image for 3600 seconds (1 hour)
 *                              image_url:
 *                                type: string
 *                                description: Presigned URL for accessing user_b's most recent profile image for 3600 seconds (1 hour)
 *                          universe:
 *                            type: string
 *                            enum:
 *                              - simmer-world
 *                              - reality
 *                          source:
 *                            type: string
 *                            enum:
 *                              - user
 *                              - ai
 *                              - external
 *                          private_to_a:
 *                            type: boolean
 *                          when:
 *                            type: string
 *                            format: date-time
 *                          summary_a:
 *                            type: string
 *                            description: AI-generated summary of the date from user_a's perspective
 *                          summary_b:
 *                            type: string
 *                            description: AI-generated summary of the date from user_b's perspective
 *                          tags:
 *                            type: array
 *                            items:
 *                              type: string
 *                          items:
 *                            type: array
 *                            items:
 *                              type: string
 *                          tone_score:
 *                            type: string
 *                          match_score:
 *                            type: string
 *                          chemistry_signals:
 *                            type: string
 *                          chemistry_signals_score:
 *                            type: number
 *                          chemistry_signals_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          conversational_balance:
 *                            type: string
 *                          conversational_balance_score:
 *                            type: number
 *                          conversational_balance_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          conversation_flow:
 *                            type: string
 *                          conversation_flow_score:
 *                            type: number
 *                          conversation_flow_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          curiosity:
 *                            type: string
 *                          curiosity_score:
 *                            type: number
 *                          curiosity_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          energy_alignment:
 *                            type: string
 *                          energy_alignment_score:
 *                            type: number
 *                          energy_alignment_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          humor_alignment:
 *                            type: string
 *                          humor_alignment_score:
 *                            type: number
 *                          humor_alignment_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          listening_responsiveness:
 *                            type: string
 *                          listening_responsiveness_score:
 *                            type: number
 *                          listening_responsiveness_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          repair_attempts:
 *                            type: string
 *                          repair_attempts_score:
 *                            type: number
 *                          repair_attempts_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          responsiveness:
 *                            type: string
 *                          responsiveness_score:
 *                            type: number
 *                          responsiveness_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          shared_moments:
 *                            type: string
 *                          shared_moments_score:
 *                            type: number
 *                          shared_moments_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          tension_handling:
 *                            type: string
 *                          tension_handling_score:
 *                            type: number
 *                          tension_handling_level:
 *                            type: string
 *                            enum: [strong, mixed, strained, not-observed]
 *                          compatibility_penalty:
 *                            type: string
 *                          compatibility_penalty_points:
 *                            type: number
 *                          version:
 *                            type: string
 *                          location:
 *                            type: string
 *                          title:
 *                            type: string
 *                          mood:
 *                            type: string
 *                          scene:
 *                            type: string
 *                          opening_line:
 *                            type: string
 *                          ending_note:
 *                            type: string
 *                          moment:
 *                            type: string
 *                          pay_attention_to:
 *                            type: array
 *                            items:
 *                              type: string
 *                          next_scenarios:
 *                            type: array
 *                            description: AI-generated next date scenario options.
 *                            items:
 *                              type: object
 *                              properties:
 *                                location:
 *                                  type: string
 *                                scenario_type:
 *                                  type: string
 *                                  enum: [conversation_first, playful, collaborative, mild_tension]
 *                                description:
 *                                  type: string
 *                          final_why:
 *                            type: object
 *                            properties:
 *                              observations:
 *                                type: array
 *                                items:
 *                                  type: string
 *                              insight:
 *                                type: string
 *                          input_tokens:
 *                            type: number
 *                          output_tokens:
 *                            type: number
 *                          image_urls:
 *                            type: array
 *                            description: Presigned URLs for accessing the dating meet images for 3600 seconds (1 hour)
 *                            items:
 *                              type: string
 *       400:
 *         description: Bad request, missing required fields or user not found
 *       500:
 *         description: Internal server error
 */
router.post('/meet/image-only', use(user.createMomentImageOnly))

/**
 * @openapi
 * /api/user:
 *   delete:
 *     summary: Delete user account
 *     security:
 *       - bearerAuth: []
 *     description: Delete user account
 *     tags: [User]
 *     responses:
 *       200:
 *         description: User account deleted successfully
 *       500:
 *         description: Internal server error
 */
router.delete('/', use(user.deleteAccount))

/**
 * @openapi
 * /api/user/explore-dates:
 *   get:
 *     summary: Get potential user dates
 *     security:
 *       - bearerAuth: []
 *     description: Get potential user dates based on the requester's preferences and existing dates.
 *     tags: [User]
 *     parameters:
 *       - in: query
 *         name: offset
 *         required: false
 *         schema:
 *           type: integer
 *           default: 0
 *         description: The number of items to skip before starting to collect the result set.
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 10
 *         description: The number of items to return.
 *       - in: query
 *         name: test_users_only
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Whether to include only test users in the results. Defaults to true.
 *       - in: query
 *         name: include_test_users
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether to include test users in the results. Defaults to false.
 *       - in: query
 *         name: use_preference_scoring
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Whether to use preference scoring in the results. Defaults to true.
 *     responses:
 *       200:
 *         description: Returns a list of potential user dates
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
 *                       _affinity:
 *                         type: number
 *                       first_name:
 *                         type: string
 *                       loc_city:
 *                         type: string
 *                       loc_state:
 *                         type: string
 *                       presignedAvatarUrl:
 *                         type: string
 *                       distanceMiles:
 *                         type: number
 *       400:
 *         description: Bad request, missing required fields
 *       500:
 *         description: Internal server error
 */
router.get('/explore-dates', use(user.getExploreUserDates))

/**
 * @openapi
 * /api/user/{user_target}:
 *   get:
 *     summary: Get user profile by ID
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Get user profile by ID.
 *
 *       Response variants:
 *       - Self view (user_target matches requester ID): returns `UserProfileSelf` with allowed private fields.
 *       - Other-user view: returns `UserProfilePublic` with private contact data and precise location fields excluded. Public profile content includes `core_questions` and `core_answers`.
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: user_target
 *         required: true
 *         description: The ID of the user to view.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Returns user profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   oneOf:
 *                     - description: Returned when viewing your own profile.
 *                       allOf:
 *                         - $ref: '#/components/schemas/UserProfileSelf'
 *                     - description: Returned when viewing another user's profile.
 *                       allOf:
 *                         - $ref: '#/components/schemas/UserProfilePublic'
 *       500:
 *         description: Internal server error
 */
router.get('/:user_target', use(user.viewProfile))

export default router
