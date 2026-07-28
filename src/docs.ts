// docs.ts
/// <reference path="./types/swagger-jsdoc.d.ts" />
import swaggerJSDoc from 'swagger-jsdoc'
export const openapiSpec = swaggerJSDoc({
	definition: {
		openapi: '3.1.0',
		info: {
			title: 'Simmer API',
			description: `
## Simmer API documentation

### Authentication

Most endpoints require a Bearer token in the Authorization header.
You can obtain a token by signing up or signing in.

Example:
\`\`\`
Authorization: Bearer YOUR_JWT_TOKEN
\`\`\`

To get an authorization token, use the following endpoints:
- **POST /signup**: Create a new user account.
- **POST /signin**: Sign in with your username and password.

### Error Handling

Errors are returned with appropriate HTTP status codes and a JSON body containing an error message. 
Example:
\`\`\`json
{
  "error": "Invalid credentials"
} 
\`\`\`

### Endpoints Flow

1. **Sign up/Sign in**: Use POST /signup or POST /signin to get an authorization token.
2. **User Profile Update**: Use POST or PUT /api/user endpoint to update user profile information and preferences.
3. **Upload Profile Image**: POST /api/user/images Upload user image to generate an avatar.
4. **Explore Matches**: GET /api/user/explore Get a list of potential matches based on user preferences and affinity scores.
5. **Dating Meet Creation**: POST /api/user/meet Create a dating meet interaction between users.
6. **View Dating Meet**: GET /api/dating-meet/{id} View details of a specific dating meet interaction.
7. **Update Relationship Status**: PATCH /api/user/relationship Update relationship status with another user.

### Response Data Consistency

**User Object Shape in Moment/Date Endpoints** (POST /api/user/meet, GET/PATCH /api/moment):
- All endpoints return \`user_a\` and \`user_b\` with a consistent "fat" object structure
- Each user object includes: \`_id\`, \`first_name\`, \`avatar_url\`, \`image_url\` (presigned S3 URLs)
- This ensures frontend can always reference user data without additional lookups
- The structure is guaranteed even after updates to moments/dates
- See [API_AUDIT_ENDPOINT_CONSISTENCY.md](../API_AUDIT_ENDPOINT_CONSISTENCY.md) for detailed consistency verification

### Privacy & Security Notes
- All endpoints that require authentication will return a 401 Unauthorized error if the token is missing or invalid.
- Make sure to handle errors gracefully in your client application by checking the response status and error messages.
- **Response Privacy Hardening**: 
  - Sensitive user data (email, phone, location, preferences, core answers) is never included in API responses
  - Schema-level default field exclusion and response serializers prevent accidental PII exposure
  - Non-requester users (e.g., \`user_b\` in moment endpoints) are exposed with public data only
- Public profile responses are intentionally limited and do not include private contact information or precise location attributes.
- Account existence checks return a generic success response to reduce enumeration risk.
- All user data in responses is explicitly constructed with only necessary public fields (security by design, not filtering).

### Quick start
1. Sign up for a new account:
   - Endpoint: POST /signup
   - Body: { "username": "your_username", "password": "your_password" }
2. Sign in to get your token:
   - Endpoint: POST /signin
   - Body: { "username": "your_username", "password": "your_password" }
3. Use the token to access protected endpoints by including it in the Authorization header.
4. Explore potential matches using:
   - Endpoint: GET /api/user/explore
   - Include your auth token in the Authorization header.
5. Create a dating meet interaction: 
   - Endpoint: POST /api/user/meet
   - Query: { "target_user_id": "id_of_user_to_date" }
   - Include your auth token in the Authorization header.
6. View details of a dating meet:
   - Endpoint: GET /api/dating-meet/{id}
   - Include your auth token in the Authorization header.
7. Update relationship status with another user:
   - Endpoint: PATCH /api/user/relationship?target_user=id_of_user
   - Include your auth token in the Authorization header.
   - Body: { "status": "new_status", "stage": "new_stage" }
   `,
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'JWT',
				},
			},
			schemas: {
				UserProfilePublic: {
					type: 'object',
					properties: {
						_id: { type: 'string' },
						first_name: { type: 'string' },
						gender: { type: 'string' },
						genders_to_date: {
							type: 'array',
							items: { type: 'string' },
						},
						height: { type: 'number' },
						weight_lbs: { type: 'number', minimum: 50, maximum: 700 },
						have_kids: { type: 'string' },
						want_kids: { type: 'string' },
						smoking: { type: 'string' },
						cannabis: { type: 'string' },
						relationship_structure: { type: 'string' },
						pets: { type: 'string' },
						have_pets: { type: 'string' },
						faith_importance: { type: 'string' },
						location_radius: { type: 'number' },
						vaccination_stance: { type: 'string' },
						deal_break_lightning: {
							type: 'array',
							items: { type: 'string' },
						},
						loc_city: { type: 'string' },
						loc_state: { type: 'string' },
						loc_country: { type: 'string' },
						drinking: { type: 'string' },
						political_view: { type: 'string' },
						about: { type: 'string' },
						languages: {
							type: 'array',
							items: { type: 'string' },
						},
						exercise: { type: 'string' },
						culture: {
							type: 'array',
							items: { type: 'string' },
						},
						education: { type: 'string' },
						religion: { type: 'string' },
						activities: {
							type: 'array',
							items: { type: 'string' },
						},
						core_questions: {
							type: 'array',
							items: { type: 'string' },
						},
						core_answers: {
							type: 'array',
							items: { type: 'string' },
						},
						high_priority_values: {
							type: 'array',
							items: { type: 'string' },
						},
						in_relationship_with: { type: 'string', nullable: true },
						preferences: { type: 'object' },
						presignedUrl: { type: 'string' },
						presignedAvatarUrl: { type: 'string', nullable: true },
						age: { type: 'number', nullable: true },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
				UserProfileSelf: {
					allOf: [
						{ $ref: '#/components/schemas/UserProfilePublic' },
						{
							type: 'object',
							properties: {
								last_name: { type: 'string' },
								username: { type: 'string' },
								email: { type: 'string' },
								phone: { type: 'string' },
								is_phone_verified: { type: 'boolean' },
								is_email_verified: { type: 'boolean' },
								is_test_user: { type: 'boolean' },
								is_banned: { type: 'boolean' },
								loc_latitude: { type: 'number' },
								loc_longitude: { type: 'number' },
								loc_address: { type: 'string' },
								loc_postal_code: { type: 'string' },
								date_of_birth: { type: 'string', format: 'date' },
								education_school: { type: 'string' },
								job: { type: 'string' },
								born_location: { type: 'string' },
							},
						},
					],
				},
			},
		},
		security: [
			{
				bearerAuth: [], // Apply the BearerAuth scheme globally
			},
		],
	},
	apis: [
		'./src/**/*.ts', // all TypeScript files in src directory
		'./src/utils/router.ts', // specific file with JSDoc @openapi blocks
	], // files with JSDoc @openapi blocks
})
