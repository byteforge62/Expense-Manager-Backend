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
module.exports = {};
