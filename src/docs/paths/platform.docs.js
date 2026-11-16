/**
 * @openapi
 * tags:
 *   - name: Authentication
 *     description: Authentication and Account Management APIs
 */

/**
 * @openapi
 * /api/user:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Register a new user
 *     description: Creates a new user account.
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignupRequest'
 *
 *     responses:
 *       201:
 *         description: User created successfully.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: User created successfully
 *               data:
 *                 _id: 68824e0c9b5f3dbfd03ad123
 *                 name: Muhammad Patel
 *                 email: patel@gmail.com
 *                 role: User
 *
 *       400:
 *         description: Validation Error
 *
 *       409:
 *         description: User already exists
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/user/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Login User
 *     description: Authenticates the user and returns an access token.
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *
 *     responses:
 *       200:
 *         description: Login successful.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Login Successfully
 *               data:
 *                 token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 user:
 *                   _id: 68824e0c9b5f3dbfd03ad123
 *                   name: Muhammad Patel
 *                   email: patel@gmail.com
 *                   role: User
 *                   is_active: true
 *                   profilePic: ""
 *
 *       400:
 *         description: Validation Error
 *
 *       401:
 *         description: Invalid Email or Password
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/user/refresh-token:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Refresh Access Token
 *     description: Generates a new access token using the refresh token stored in cookies.
 *
 *     responses:
 *       200:
 *         description: Token refreshed successfully.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Token refreshed
 *               data:
 *                 token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *
 *       401:
 *         description: Invalid or expired refresh token
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/user/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Logout User
 *     description: Clears authentication cookies and logs out the current user.
 *
 *     responses:
 *       200:
 *         description: Logout successful.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Logged out successfully
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get all users
 *     description: Returns a list of all registered users.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Users retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: users found successfully
 *               data:
 *                 - _id: 68824e0c9b5f3dbfd03ad123
 *                   name: Muhammad Patel
 *                   email: patel@gmail.com
 *                   role: User
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/user/{id}:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get user by ID
 *     description: Returns a single user by ID.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *
 *     responses:
 *       200:
 *         description: User retrieved successfully.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: User found successfully
 *               data:
 *                 _id: 68824e0c9b5f3dbfd03ad123
 *                 name: Muhammad Patel
 *                 email: patel@gmail.com
 *                 role: User
 *
 *       404:
 *         description: User not found
 *
 *       500:
 *         description: Internal Server Error
 *
 *   put:
 *     tags:
 *       - Users
 *     summary: Update user
 *     description: Updates user information.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             name: Muhammad Patel
 *             email: patel@gmail.com
 *
 *     responses:
 *       200:
 *         description: User updated successfully.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: User updated successfully
 *               data:
 *                 _id: 68824e0c9b5f3dbfd03ad123
 *                 name: Muhammad Patel
 *                 email: patel@gmail.com
 *                 role: User
 *
 *       400:
 *         description: Validation Error
 *
 *       404:
 *         description: User not found
 *
 *       500:
 *         description: Internal Server Error
 *
 *   delete:
 *     tags:
 *       - Users
 *     summary: Delete user
 *     description: Deletes a user by ID.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *
 *     responses:
 *       200:
 *         description: User deleted successfully.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: User delete successfully
 *
 *       404:
 *         description: User not found
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/user/upload-profile/{id}:
 *   post:
 *     tags:
 *       - Users
 *     summary: Upload profile picture
 *     description: Uploads a profile image for the specified user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - profile
 *             properties:
 *               profile:
 *                 type: string
 *                 format: binary
 *
 *     responses:
 *       200:
 *         description: Profile image uploaded successfully.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Profile Image Uploaded Successfully
 *               data:
 *                 _id: 68824e0c9b5f3dbfd03ad123
 *                 profilePic: https://your-bucket.s3.amazonaws.com/profile.jpg
 *
 *       400:
 *         description: Invalid file
 *
 *       404:
 *         description: User not found
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * tags:
 *   - name: Categories
 *     description: Category Management APIs
 */

/**
 * @openapi
 * /api/category:
 *   post:
 *     tags:
 *       - Categories
 *     summary: Create category
 *     description: Creates a new category. Admin only.
 *     security:
 *       - bearerAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCategoryRequest'
 *
 *     responses:
 *       201:
 *         description: Category added successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Category added successfully
 *                 data:
 *                   $ref: '#/components/schemas/Category'
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/categories:
 *   get:
 *     tags:
 *       - Categories
 *     summary: Get all categories
 *     description: Returns all available categories.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Categories fetched successfully.
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Category'
 *
 *       401:
 *         description: Unauthorized
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * /api/category/{id}:
 *   get:
 *     tags:
 *       - Categories
 *     summary: Get category by ID
 *     description: Returns a category by its ID.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Category ID
 *
 *     responses:
 *       200:
 *         description: Category found successfully.
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
 *                   $ref: '#/components/schemas/Category'
 *
 *       401:
 *         description: Unauthorized
 *
 *       404:
 *         description: Category not found
 *
 *       500:
 *         description: Internal Server Error
 *
 *   delete:
 *     tags:
 *       - Categories
 *     summary: Delete category
 *     description: Deletes a category. Admin only.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Category ID
 *
 *     responses:
 *       200:
 *         description: Category deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Category deleted successfully
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden
 *
 *       404:
 *         description: Category not found
 *
 *       500:
 *         description: Internal Server Error
 */

/**
 * @openapi
 * tags:
 *   - name: AI
 *     description: AI-powered financial assistant APIs
 */

/**
 * @openapi
 * /api/ai/ask:
 *   post:
 *     tags:
 *       - AI
 *     summary: Ask the AI assistant
 *     description: Sends a financial question to the AI assistant.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AIChatRequest'
 *     responses:
 *       200:
 *         description: AI response generated successfully.
 */

/**
 * @openapi
 * /api/ai/expense-insights:
 *   get:
 *     tags:
 *       - AI
 *     summary: Get expense insights
 *     description: Generates AI-powered insights from the user's expense history.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Expense insights generated successfully.
 */

/**
 * @openapi
 * /api/ai/budget-plan:
 *   get:
 *     tags:
 *       - AI
 *     summary: Generate budget plan
 *     description: Generates a personalized budget plan.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Budget plan generated successfully.
 */

/**
 * @openapi
 * /api/ai/spending-risk:
 *   get:
 *     tags:
 *       - AI
 *     summary: Detect spending risk
 *     description: Analyzes current spending patterns and identifies potential overspending risks.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Spending risk generated successfully.
 */

/**
 * @openapi
 * /api/ai/financial-forecast:
 *   get:
 *     tags:
 *       - AI
 *     summary: Financial forecast
 *     description: Predicts future financial trends based on historical data.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Financial forecast generated successfully.
 */

/**
 * @openapi
 * /api/ai/saving-opportunities:
 *   get:
 *     tags:
 *       - AI
 *     summary: Detect saving opportunities
 *     description: Finds areas where the user can reduce spending and save more.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Saving opportunities generated successfully.
 */

/**
 * @openapi
 * /api/ai/financial-health:
 *   get:
 *     tags:
 *       - AI
 *     summary: Financial health score
 *     description: Calculates an overall financial health score for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Financial health score generated successfully.
 */

/**
 * @openapi
 * /api/ai/insights:
 *   get:
 *     tags:
 *       - AI
 *     summary: Get all AI insights
 *     description: Returns all AI-generated financial insights for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Insights fetched successfully.
 */

/**
 * @openapi
 * /api/financial-intelligence/overview:
 *   get:
 *     summary: Generate the authenticated user's financial intelligence overview
 *     tags:
 *       - Financial Intelligence
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Inclusive UTC calendar start day; defaults to 89 days before the current UTC day.
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Inclusive UTC calendar end day; defaults to the current UTC day. The inclusive period is limited to 366 days.
 *     responses:
 *       200:
 *         description: Consolidated financial metrics and analytical results.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, message, data]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Financial intelligence generated successfully
 *                 data:
 *                   type: object
 *                   required: [generatedAt, dataConfidence, metrics, behavior, anomalies, anomalySummary, financialHealth, recommendations, rules, ruleSummary]
 *                   properties:
 *                     generatedAt:
 *                       type: string
 *                       format: date-time
 *                     dataConfidence:
 *                       type: object
 *                       properties:
 *                         level:
 *                           type: string
 *                           enum: [low, medium, high]
 *                         samples:
 *                           type: object
 *                         limitations:
 *                           type: array
 *                           items:
 *                             type: string
 *                     metrics:
 *                       type: object
 *                       description: Selected-period totals, daily series, categories, obligations, and comparison.
 *                     behavior:
 *                       type: object
 *                       description: Evidence-based observations, weekday patterns, and consistency measures.
 *                     anomalies:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                           amount:
 *                             type: number
 *                           baseline:
 *                             type: number
 *                           deviation:
 *                             type: number
 *                           deviationPercent:
 *                             type: number
 *                             nullable: true
 *                           method:
 *                             type: string
 *                           severity:
 *                             type: string
 *                             enum: [medium, high]
 *                           reason:
 *                             type: string
 *                     anomalySummary:
 *                       type: object
 *                     financialHealth:
 *                       type: object
 *                       properties:
 *                         score:
 *                           type: number
 *                           nullable: true
 *                         label:
 *                           type: string
 *                         scoringWeights:
 *                           type: object
 *                         components:
 *                           type: object
 *                         missingData:
 *                           type: array
 *                           items:
 *                             type: string
 *                     recommendations:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [id, type, title, description, priority, evidence, method, estimatedFinancialImpact, confidenceLevel, nextStep]
 *                         properties:
 *                           id:
 *                             type: string
 *                           type:
 *                             type: string
 *                           title:
 *                             type: string
 *                           description:
 *                             type: string
 *                           priority:
 *                             type: string
 *                             enum: [critical, high, medium, low]
 *                           evidence:
 *                             type: object
 *                           method:
 *                             type: string
 *                           estimatedFinancialImpact:
 *                             type: object
 *                             nullable: true
 *                           confidenceLevel:
 *                             type: string
 *                             enum: [low, medium, high]
 *                           nextStep:
 *                             type: string
 *                     rules:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [ruleId, type, condition, threshold, severity, priority, status, triggered, explanation, evidence]
 *                         properties:
 *                           ruleId:
 *                             type: string
 *                           type:
 *                             type: string
 *                           condition:
 *                             type: string
 *                           threshold:
 *                             type: object
 *                             nullable: true
 *                           severity:
 *                             type: string
 *                           priority:
 *                             type: number
 *                           status:
 *                             type: string
 *                             enum: [triggered, clear, not-evaluated]
 *                           triggered:
 *                             type: boolean
 *                           explanation:
 *                             type: string
 *                           evidence:
 *                             nullable: true
 *                     ruleSummary:
 *                       type: object
 *       400:
 *         description: Invalid query parameters or reversed date range.
 *       401:
 *         description: Authentication is required.
 */

/**
 * @openapi
 * tags:
 *   - name: System Logs
 *     description: System activity log APIs
 */

/**
 * @openapi
 * /api/logs:
 *   get:
 *     tags:
 *       - System Logs
 *     summary: Get all system logs
 *     description: Returns all system log entries. Admin only.
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Logs fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Logs fetched successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SystemLog'
 *
 *       401:
 *         description: Unauthorized
 *
 *       403:
 *         description: Forbidden
 *
 *       500:
 *         description: Internal Server Error
 */
/**
 * @openapi
 * paths:
 *   /api/user/forgotpassword:
 *     post:
 *       tags:
 *         - Authentication
 *       summary: Request a password reset link
 *       description: >
 *         Always answers with the same generic message, whether or not the
 *         email belongs to an account. Rate limited per IP.
 *       requestBody:
 *         required: true
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [email]
 *               properties:
 *                 email:
 *                   type: string
 *                   format: email
 *       responses:
 *         '200':
 *           description: Request accepted (same response for known and unknown addresses).
 *         '400':
 *           description: Validation failed.
 *         '429':
 *           description: Too many password reset attempts.
 *   /api/user/resetpassword:
 *     post:
 *       tags:
 *         - Authentication
 *       summary: Complete a password reset
 *       description: >
 *         Redeems a single-use reset token, replaces the password and revokes
 *         every existing refresh session for the account.
 *       requestBody:
 *         required: true
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [token, password]
 *               properties:
 *                 token:
 *                   type: string
 *                 password:
 *                   type: string
 *                   format: password
 *       responses:
 *         '200':
 *           description: Password updated.
 *         '400':
 *           description: Invalid, expired or already-used token, or a policy failure.
 *         '429':
 *           description: Too many password reset attempts.
 */
module.exports = {};
